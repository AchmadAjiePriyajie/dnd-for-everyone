import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Principal } from '#shared/access';
import { type Asset, assetVisibilitySchema, type SceneView } from '#shared/scenes';
import { DomainError } from '../../common/domain-error.js';
import { SchemaValidationPipe } from '../../common/schema-validation.pipe.js';
import { CurrentPrincipal } from '../auth/principal.js';
import { SessionGuard } from '../auth/session.guard.js';
import { AssetsService } from './assets.js';
import { ScenesProjection } from './projection.js';

const campaignParams = z.strictObject({ campaignId: z.string().min(1).max(100) });
const entryParams = z.strictObject({ campaignId: z.string().min(1).max(100), id: z.string().min(1).max(100) });
const uploadQuery = z.strictObject({ visibility: assetVisibilitySchema, name: z.string().trim().min(1).max(120) });
/** Gambar disajikan tanpa izin menjalankan apa pun, walau browser salah menebak tipenya. */
const ASSET_CSP = "default-src 'none'";

/** Asset lewat API berizin (bukan path static) dan projection scene per peserta. */
@Controller('campaigns/:campaignId')
@UseGuards(SessionGuard)
export class ScenesController {
  constructor(
    private readonly assets: AssetsService,
    private readonly scenes: ScenesProjection,
  ) {}

  @Post('assets')
  @HttpCode(201)
  upload(
    @CurrentPrincipal() principal: Principal,
    @Param(new SchemaValidationPipe(campaignParams)) input: z.infer<typeof campaignParams>,
    @Query(new SchemaValidationPipe(uploadQuery)) query: z.infer<typeof uploadQuery>,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
  ): Promise<Asset> {
    if (!Buffer.isBuffer(body)) throw new DomainError('ASSET_INVALID', 415);
    const declaredMime = (contentType ?? '').split(';')[0]!.trim();
    return this.assets.storeAsset(principal, input.campaignId, { bytes: body, declaredMime, name: query.name, visibility: query.visibility });
  }

  @Get('assets')
  list(@CurrentPrincipal() principal: Principal, @Param(new SchemaValidationPipe(campaignParams)) input: z.infer<typeof campaignParams>): Asset[] {
    return this.assets.list(principal, input.campaignId);
  }

  @Get('assets/:id')
  async download(
    @CurrentPrincipal() principal: Principal,
    @Param(new SchemaValidationPipe(entryParams)) input: z.infer<typeof entryParams>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const { asset, bytes } = await this.assets.readAsset(principal, input.campaignId, input.id);
    reply.header('content-type', asset.mime);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('cache-control', 'private, max-age=3600');
    reply.header('content-security-policy', ASSET_CSP);
    return bytes;
  }

  @Get('scenes/:id')
  scene(@CurrentPrincipal() principal: Principal, @Param(new SchemaValidationPipe(entryParams)) input: z.infer<typeof entryParams>): SceneView {
    return this.scenes.projectScene(principal, input.campaignId, input.id);
  }
}
