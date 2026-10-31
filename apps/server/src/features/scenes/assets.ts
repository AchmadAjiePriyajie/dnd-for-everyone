import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { DatabaseSync } from 'node:sqlite';
import type { Principal } from '#shared/access';
import type { Id } from '#shared/contracts';
import { type Asset, type AssetMime, type AssetUpload, MAX_ASSET_BYTES, MAX_ASSET_PIXELS } from '#shared/scenes';
import { APP_OPTIONS, type AppOptions } from '../../app-options.js';
import { DomainError, forbidden } from '../../common/domain-error.js';
import { DatabaseService } from '../../db/database.service.js';
import { CampaignsService } from '../campaigns/service.js';

/** ID asset dibuat server (UUID); apa pun selain bentuk ini ditolak sebelum menyentuh disk. */
const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EXTENSIONS: Record<AssetMime, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

interface AssetRow {
  id: Id;
  campaign_id: Id;
  name: string;
  mime: AssetMime;
  width: number;
  height: number;
  bytes: number;
  visibility: Asset['visibility'];
}

/** Tipe dan dimensi dari isi file (signature), bukan dari header Content-Type atau nama file. */
export function sniffImage(bytes: Buffer): { mime: AssetMime; width: number; height: number } | null {
  if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.readUInt32BE(4) === 0x0d0a1a0a && bytes.toString('ascii', 12, 16) === 'IHDR') {
    return { mime: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    // Telusuri marker JPEG sampai frame header SOFn (bukan DHT/JPG/DAC).
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = bytes.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mime: 'image/jpeg', height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      }
      if (length < 2) return null;
      offset += 2 + length;
    }
    return null;
  }
  if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = bytes.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { mime: 'image/webp', width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
    if (chunk === 'VP8 ') return { mime: 'image/webp', width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21);
      return { mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

/**
 * Asset campaign: gambar diperiksa signature/ukuran/dimensinya, disimpan di direktori asset host
 * dengan nama buatan server, dan hanya dibaca lewat API yang memeriksa membership + visibility.
 */
@Injectable()
export class AssetsService {
  constructor(
    @Inject(APP_OPTIONS) private readonly options: AppOptions,
    private readonly database: DatabaseService,
    private readonly campaigns: CampaignsService,
  ) {}

  async storeAsset(principal: Principal, campaignId: Id, upload: AssetUpload): Promise<Asset> {
    this.campaigns.requireDm(principal, campaignId);
    // Parser Fastify sudah menolak body > 20 MiB; pemeriksaan ini menjaga pemanggil lain.
    if (upload.bytes.length > MAX_ASSET_BYTES) throw new DomainError('ASSET_TOO_LARGE', 413, { maxBytes: MAX_ASSET_BYTES });
    const image = sniffImage(upload.bytes);
    if (!image || image.mime !== upload.declaredMime || image.width < 1 || image.height < 1) throw new DomainError('ASSET_INVALID', 415);
    if (image.width * image.height > MAX_ASSET_PIXELS) throw new DomainError('ASSET_TOO_LARGE', 413, { maxPixels: MAX_ASSET_PIXELS });

    const id = randomUUID();
    const directory = join(this.options.dataDir, 'assets', campaignId);
    await mkdir(directory, { recursive: true });
    const file = join(directory, `${id}.${EXTENSIONS[image.mime]}`);
    // Tulis ke file sementara lalu rename: tidak ada file setengah jadi bila proses berhenti.
    await writeFile(`${file}.tmp`, upload.bytes, { flag: 'wx' });
    await rename(`${file}.tmp`, file);
    const asset: Asset = { id, campaignId, name: upload.name, mime: image.mime, width: image.width, height: image.height, bytes: upload.bytes.length, visibility: upload.visibility };
    this.database
      .getHandle()
      .prepare('INSERT INTO assets (id, campaign_id, name, mime, width, height, bytes, visibility, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, campaignId, asset.name, asset.mime, asset.width, asset.height, asset.bytes, asset.visibility, new Date().toISOString());
    return asset;
  }

  /** Isi asset untuk peserta yang berhak; tidak ada/rahasia/salah campaign sama-sama FORBIDDEN. */
  async readAsset(principal: Principal, campaignId: Id, assetId: Id): Promise<{ asset: Asset; bytes: Buffer }> {
    const member = this.campaigns.requireMember(principal, campaignId);
    if (!ASSET_ID.test(assetId)) throw forbidden();
    const row = this.row(this.database.getHandle(), campaignId, assetId);
    if (!row || (row.visibility === 'dm' && member.role !== 'dm')) throw forbidden();
    const bytes = await readFile(join(this.options.dataDir, 'assets', campaignId, `${row.id}.${EXTENSIONS[row.mime]}`));
    return { asset: this.toAsset(row), bytes };
  }

  /** Asset campaign (untuk validasi latar scene). */
  find(db: DatabaseSync, campaignId: Id, assetId: Id): Asset | null {
    const row = ASSET_ID.test(assetId) ? this.row(db, campaignId, assetId) : undefined;
    return row ? this.toAsset(row) : null;
  }

  list(principal: Principal, campaignId: Id): Asset[] {
    const member = this.campaigns.requireMember(principal, campaignId);
    const rows = this.database.getHandle().prepare('SELECT * FROM assets WHERE campaign_id = ? ORDER BY created_at, id').all(campaignId) as unknown as AssetRow[];
    return rows.filter((row) => member.role === 'dm' || row.visibility === 'party').map((row) => this.toAsset(row));
  }

  private row(db: DatabaseSync, campaignId: Id, assetId: Id): AssetRow | undefined {
    return db.prepare('SELECT * FROM assets WHERE campaign_id = ? AND id = ?').get(campaignId, assetId) as unknown as AssetRow | undefined;
  }

  private toAsset(row: AssetRow): Asset {
    return { id: row.id, campaignId: row.campaign_id, name: row.name, mime: row.mime, width: row.width, height: row.height, bytes: row.bytes, visibility: row.visibility };
  }
}
