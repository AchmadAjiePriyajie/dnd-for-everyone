import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Member, Principal } from '#shared/access';
import type { Id } from '#shared/contracts';
import type { GridSettings, SceneView, Token } from '#shared/scenes';
import { forbidden } from '../../common/domain-error.js';
import { DatabaseService } from '../../db/database.service.js';
import { ProjectionService } from '../../realtime/projection.js';
import { CampaignsService } from '../campaigns/service.js';
import { ScenesService, type TokenRow } from './service.js';

/**
 * Projection scene per peserta. Player hanya menerima scene yang dibagikan dan token yang tidak
 * tersembunyi, tanpa HP/monsterId; data itu tidak pernah dibangun untuk player.
 */
@Injectable()
export class ScenesProjection implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly campaigns: CampaignsService,
    private readonly scenes: ScenesService,
    private readonly projection: ProjectionService,
  ) {}

  onModuleInit(): void {
    this.projection.registerSection('scenes', (db, member) => ({
      scenes: this.scenes
        .scenes(db, member.campaignId)
        .filter((scene) => member.role === 'dm' || scene.shared)
        .map((scene) => ({ id: scene.id, name: scene.name, ...(member.role === 'dm' ? { shared: Boolean(scene.shared) } : {}) })),
    }));
  }

  /** Ruling: campaignId ikut sebagai parameter karena ID scene unik per campaign. */
  projectScene(principal: Principal, campaignId: Id, sceneId: Id): SceneView {
    const member = this.campaigns.requireMember(principal, campaignId);
    const db = this.database.getHandle();
    const scene = this.scenes.scene(db, campaignId, sceneId);
    if (!scene || (member.role !== 'dm' && !scene.shared)) throw forbidden();
    const revision = db.prepare('SELECT revision FROM entity_revisions WHERE campaign_id = ? AND target_id = ?').get(campaignId, scene.id) as { revision: number } | undefined;
    return {
      id: scene.id,
      name: scene.name,
      assetId: scene.asset_id,
      grid: JSON.parse(scene.grid) as GridSettings,
      tokens: this.scenes
        .tokens(db, campaignId, scene.id)
        .filter((token) => member.role === 'dm' || !token.hidden)
        .map((token) => this.token(token, member)),
      revision: revision?.revision ?? 0,
      ...(member.role === 'dm' ? { shared: Boolean(scene.shared) } : {}),
    };
  }

  private token(row: TokenRow, member: Member): Token {
    const token: Token = {
      id: row.id,
      sceneId: row.scene_id,
      label: row.label,
      kind: row.kind,
      x: row.x,
      y: row.y,
      size: row.size,
      ownerAccountId: row.owner_account_id,
      characterId: row.character_id,
    };
    if (member.role === 'dm') {
      token.hidden = Boolean(row.hidden);
      if (row.hp) token.hp = JSON.parse(row.hp) as { current: number; max: number };
      if (row.monster_id) token.monsterId = row.monster_id;
    }
    return token;
  }
}
