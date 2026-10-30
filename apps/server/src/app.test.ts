import { execFile, spawn } from 'node:child_process';
import { copyFile, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { makeDataDir, removeDataDir, startTestServer, type TestServer } from '../../../tests/helpers/server.js';
import { DatabaseService } from './db/database.service.js';
import { MIGRATIONS_DIR } from './db/migrate.js';
import { DATABASE_FILE } from './db/database.js';

const repoRoot = resolve(import.meta.dirname, '../../..');
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

async function tracked(server: Promise<TestServer>): Promise<TestServer> {
  const s = await server;
  cleanup.push(() => s.close());
  return s;
}

async function tempDir(): Promise<string> {
  const dir = await makeDataDir();
  cleanup.unshift(() => removeDataDir(dir));
  return dir;
}

/** Folder migrasi uji: semua migrasi asli ditambah file SQL tambahan bernomor tinggi. */
async function migrationsWith(extra: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dnd-migrations-'));
  cleanup.unshift(() => removeDataDir(dir));
  for (const file of await readdir(MIGRATIONS_DIR)) await copyFile(join(MIGRATIONS_DIR, file), join(dir, file));
  for (const [name, sql] of Object.entries(extra)) await writeFile(join(dir, name), sql);
  return dir;
}

function readOnly<T>(dbPath: string, fn: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function tableNames(dbPath: string): string[] {
  return readOnly(dbPath, (db) =>
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(
      (r) => r.name,
    ),
  );
}

async function health(server: TestServer) {
  const res = await server.app.inject({ method: 'GET', url: '/api/health' });
  expect(res.statusCode).toBe(200);
  return { raw: res.body, body: res.json() as Record<string, unknown> };
}

describe('persistent application host', () => {
  it('keeps_host_identity_after_reopen', async () => {
    const dataDir = await tempDir();
    const first = await startTestServer({ dataDir });
    const firstHealth = await health(first);
    await first.close();

    const reopened = await tracked(startTestServer({ dataDir }));
    const reopenedHealth = await health(reopened);

    expect(typeof firstHealth.body.hostId).toBe('string');
    expect((firstHealth.body.hostId as string).length).toBeGreaterThanOrEqual(16);
    expect(reopenedHealth.body.hostId).toBe(firstHealth.body.hostId);
    // Health hanya status + identitas; tidak mengungkap path, konfigurasi atau secret.
    expect(Object.keys(reopenedHealth.body).sort()).toEqual(['hostId', 'status']);
    expect(reopenedHealth.raw).not.toContain(dataDir);
    expect(reopenedHealth.raw.toLowerCase()).not.toContain('sqlite');
  });

  it('boots_nested_injected_providers', async () => {
    @Injectable()
    class Leaf {
      readonly value = 'leaf';
    }
    @Injectable()
    class Branch {
      constructor(readonly leaf: Leaf) {}
    }
    @Injectable()
    class Root {
      constructor(readonly branch: Branch) {}
    }
    const moduleRef = await Test.createTestingModule({ providers: [Leaf, Branch, Root] }).compile();
    // Tanpa decorator metadata dari transform test, Nest tidak tahu tipe parameter constructor.
    expect(moduleRef.get(Root).branch.leaf.value).toBe('leaf');

    const server = await tracked(startTestServer({ dataDir: await tempDir() }));
    expect(server.app.get(DatabaseService).getHandle().isOpen).toBe(true);
  });

  it('boots_nested_injected_providers_from_build', async () => {
    await promisify(execFile)('npm run build:server', { cwd: repoRoot, shell: true, timeout: 120_000 } as never);
    const dataDir = await tempDir();
    const child = spawn(process.execPath, ['dist/apps/server/src/index.js'], {
      cwd: repoRoot,
      env: { ...process.env, DATA_DIR: dataDir, HOST: '127.0.0.1', PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    cleanup.push(async () => {
      if (child.exitCode !== null) return;
      const exited = new Promise((r) => child.once('exit', r));
      child.kill();
      await exited;
    });
    const url = await new Promise<string>((resolveUrl, reject) => {
      let out = '';
      let err = '';
      const timer = setTimeout(() => reject(new Error(`built server not ready: ${out}${err}`)), 30_000);
      child.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString();
        const match = /READY (http:\/\/\S+)/.exec(out);
        if (match) {
          clearTimeout(timer);
          resolveUrl(match[1]!);
        }
      });
      child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`built server exited ${code}: ${out}${err}`));
      });
    });
    const res = await fetch(`${url}/api/health`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('ok');
  }, 150_000);

  it('rolls_back_failed_migration_without_half_schema', async () => {
    const dataDir = await tempDir();
    const migrationsDir = await migrationsWith({
      '900-broken.sql': 'CREATE TABLE half_installed (x INTEGER);\nINSERT INTO table_that_does_not_exist VALUES (1);\n',
    });
    await expect(startTestServer({ dataDir, migrationsDir })).rejects.toThrow();

    const dbPath = join(dataDir, DATABASE_FILE);
    expect(tableNames(dbPath)).not.toContain('half_installed');
    const versions = readOnly(
      dbPath,
      (db) => db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[],
    );
    expect(versions.map((v) => v.version)).not.toContain(900);
    expect(versions.map((v) => v.version)).toContain(1);
  });

  it('backs_up_existing_database_before_migrating', async () => {
    const dataDir = await tempDir();
    const first = await startTestServer({ dataDir });
    const { body } = await health(first);
    await first.close();

    const migrationsDir = await migrationsWith({ '900-extra.sql': 'CREATE TABLE extra_feature (x INTEGER);\n' });
    await tracked(startTestServer({ dataDir, migrationsDir }));

    const backups = await readdir(join(dataDir, 'backups'));
    expect(backups).toHaveLength(1);
    const backupPath = join(dataDir, 'backups', backups[0]!);
    expect(tableNames(backupPath)).not.toContain('extra_feature');
    expect(tableNames(join(dataDir, DATABASE_FILE))).toContain('extra_feature');
    const hostId = readOnly(
      backupPath,
      (db) => (db.prepare("SELECT value FROM host_meta WHERE key = 'host_id'").get() as { value: string }).value,
    );
    expect(hostId).toBe(body.hostId);
  });

  it('refuses_to_start_when_pre_migration_backup_fails', async () => {
    const dataDir = await tempDir();
    await (await startTestServer({ dataDir })).close();
    // File biasa bernama "backups" membuat pembuatan folder backup gagal.
    await writeFile(join(dataDir, 'backups'), 'not a directory');

    const migrationsDir = await migrationsWith({ '900-extra.sql': 'CREATE TABLE extra_feature (x INTEGER);\n' });
    await expect(startTestServer({ dataDir, migrationsDir })).rejects.toThrow();
    expect(tableNames(join(dataDir, DATABASE_FILE))).not.toContain('extra_feature');
  });

  it('refuses_database_from_newer_app_version', async () => {
    const dataDir = await tempDir();
    const migrationsDir = await migrationsWith({ '900-extra.sql': 'CREATE TABLE extra_feature (x INTEGER);\n' });
    await (await startTestServer({ dataDir, migrationsDir })).close();
    // Aplikasi "lama" tidak mengenal 900; database sudah memilikinya.
    await expect(startTestServer({ dataDir })).rejects.toThrow(/unknown to this application/);
  });

  it('skips_backup_when_nothing_to_migrate', async () => {
    const dataDir = await tempDir();
    await (await startTestServer({ dataDir })).close();
    await tracked(startTestServer({ dataDir }));
    expect(existsSync(join(dataDir, 'backups'))).toBe(false);
  });

  it('returns_json_404_for_unknown_api_route', async () => {
    const server = await tracked(startTestServer({ dataDir: await tempDir() }));
    const res = await server.app.inject({ method: 'GET', url: '/api/unknown' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.json()).toEqual({ code: 'NOT_FOUND', params: {} });
  });

  it('closes_database_on_shutdown', async () => {
    const server = await startTestServer({ dataDir: await tempDir() });
    const handle = server.app.get(DatabaseService).getHandle();
    expect(handle.isOpen).toBe(true);
    await server.close();
    expect(handle.isOpen).toBe(false);
  });
});
