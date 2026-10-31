import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Member, Principal } from '#shared/access';
import type { Id } from '#shared/contracts';
import type { AreaMarker, FogState, GridSettings, SceneView, Token } from '#shared/scenes';
import { forbidden } from '../../common/domain-error.js';
import { DatabaseService } from '../../db/database.service.js';
import { ProjectionService } from '../../realtime/projection.js';
import { CampaignsService } from '../campaigns/service.js';
import { CombatService } from '../combat/service.js';
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
    private readonly combat: CombatService,
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
    const fog = JSON.parse(scene.fog) as FogState;
    const markers = (
      db.prepare('SELECT id, owner_account_id, marker FROM map_markers WHERE campaign_id = ? AND scene_id = ? ORDER BY created_at, id').all(campaignId, scene.id) as Array<{
        id: Id;
        owner_account_id: Id;
        marker: string;
      }>
    ).map((row) => ({ ...(JSON.parse(row.marker) as Omit<AreaMarker, 'id' | 'ownerAccountId'>), id: row.id, ownerAccountId: row.owner_account_id }));
    return {
      id: scene.id,
      name: scene.name,
      assetId: scene.asset_id,
      grid: JSON.parse(scene.grid) as GridSettings,
      tokens: this.scenes
        .tokens(db, campaignId, scene.id)
        .filter((token) => this.scenes.seenBy(token, member, fog))
        .map((token) => this.token(token, member)),
      markers,
      fog,
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
      const linkedHp = this.combat.tokenHitPoints(this.database.getHandle(), member.campaignId, row.id);
      if (linkedHp) token.hp = { current: linkedHp.current, max: linkedHp.max };
      if (row.monster_id) token.monsterId = row.monster_id;
    }
    return token;
  }
}
