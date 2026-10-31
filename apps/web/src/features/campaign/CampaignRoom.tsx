import { type CSSProperties, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiError, CreatedInvite, MemberView } from '#shared/access';
import type { Id } from '#shared/contracts';
import { api } from '../../app/api';
import { DmCheatSheet } from '../notes/DmCheatSheet';
import { Icon, initials } from '../../app/icons';
import { Link, navigate, routePath } from '../../app/router';
import { refreshRoom, sendCommand, useConnectionStatus, useRoomEntry } from '../../app/room-store';
import { Dialog, ErrorMessage, toApiError, useSession } from '../../app/ui';

/** Room campaign: party, peran kamu, dan (khusus DM) undangan serta pengelolaan anggota. */
export function CampaignRoom({ campaignId }: { campaignId: Id }) {
  const { t, i18n } = useTranslation();
  const session = useSession();
  const entry = useRoomEntry(campaignId);
  const snapshot = entry?.snapshot;
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [removing, setRemoving] = useState<MemberView | null>(null);
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const connection = useConnectionStatus();

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      await refreshRoom(campaignId);
      return true;
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.code === 'UNAUTHENTICATED') session.expire();
      setActionError(apiError);
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!snapshot) {
    return (
      <div className="room">
        <Link href={routePath.lobby()} className="back-link">
          <Icon name="arrowLeft" />
          {t('room.back')}
        </Link>
        {entry?.error ? (
          <section className="card empty-state">
            <Icon name="shield" className="empty-icon" />
            <h1 className="empty-title">{t('room.noAccess')}</h1>
            <ErrorMessage error={entry.error} />
          </section>
        ) : (
          <div className="room-banner skeleton" aria-busy="true">
            <p className="muted">{t('room.loading')}</p>
          </div>
        )}
      </div>
    );
  }

  const isDm = snapshot.you.role === 'dm';
  const roleName = (role: 'dm' | 'player') => (role === 'dm' ? t('lobby.roleDm') : t('lobby.rolePlayer'));
  const dateFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  const activeInvites = snapshot.dm?.invites.filter((invite) => !invite.revoked) ?? [];
  const pastInvites = snapshot.dm?.invites.filter((invite) => invite.revoked) ?? [];
  const orderedInvites = [...activeInvites, ...pastInvites];

  return (
    <div className="room">
      <Link href={routePath.lobby()} className="back-link">
        <Icon name="arrowLeft" />
        {t('room.back')}
      </Link>
      <header className="room-banner page-banner">
        <span className="sigil sigil-lg" aria-hidden="true">
          {initials(snapshot.campaign.title)}
        </span>
        <div className="room-heading">
          <h1>{snapshot.campaign.title}</h1>
          <p className="room-meta">
            <span className={`badge badge-${snapshot.you.role}`}>
              <Icon name={isDm ? 'crown' : 'user'} />
              {t('room.youAre', { role: roleName(snapshot.you.role) })}
            </span>
            <span className="muted small">{t('lobby.ruleset', { ruleset: snapshot.campaign.ruleset })}</span>
          </p>
        </div>
        <div className="banner-actions">
          <Link href={routePath.combat(campaignId)} className="button-link">
            <Icon name="shield" />{t('combat.open')}
          </Link>
          <Link href={routePath.scenes(campaignId)} className="button-link">
            <Icon name="globe" />
            {t('scenes.open')}
          </Link>
          <Link href={routePath.notes(campaignId)} className="button-link">
            <Icon name="eye" />
            {t('notes.open')}
          </Link>
          {isDm && (
            <Link href={routePath.encounters(campaignId)} className="button-link">
              <Icon name="shield" />
              {t('encounters.open')}
            </Link>
          )}
          <Link href={routePath.homebrew(campaignId)} className="button-link">
            <Icon name="plus" />
            {t('homebrew.open')}
          </Link>
          <Link href={routePath.reference(campaignId)} className="button-link">
            <Icon name="scroll" />
            {t('room.openReference')}
          </Link>
        </div>
      </header>
      {entry.error && <ErrorMessage error={entry.error} />}
      <ErrorMessage error={actionError} />

      {isDm && <DmCheatSheet rows={snapshot.dm?.cheatSheet ?? []} />}
      <div className="room-grid">
        <section className="card" aria-labelledby="party-heading">
          <h2 id="party-heading">
            <Icon name="users" />
            {t('room.members')}
            <span className="count" aria-hidden="true">
              {snapshot.members.length}
            </span>
          </h2>
          <ul className="member-list">
            {snapshot.members.map((member) => (
              <li key={member.accountId}>
                <span className="avatar" aria-hidden="true" style={{ '--hue': hue(member.username) } as CSSProperties}>
                  {initials(member.username)}
                </span>
                <span className="member-name">
                  {member.username}
                  {member.accountId === snapshot.you.accountId && <span className="muted"> ({t('room.you')})</span>}
                </span>
                <span className={`badge badge-${member.role}`}>
                  <Icon name={member.role === 'dm' ? 'crown' : 'user'} />
                  {roleName(member.role)}
                </span>
                {isDm && member.role === 'player' && (
                  <button type="button" className="danger small" disabled={busy} onClick={() => setRemoving(member)}>
                    {t('room.remove')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="card" aria-labelledby="characters-heading">
          <h2 id="characters-heading">
            <Icon name="user" />
            {t('room.characters')}
          </h2>
          {(snapshot.characters ?? []).length === 0 ? (
            <p className="muted">{t('room.noCharacters')}</p>
          ) : (
            <ul className="member-list">
              {(snapshot.characters ?? []).map((character) => {
                const owner = snapshot.members.find((member) => member.accountId === character.ownerAccountId);
                const visible = isDm || character.ownerAccountId === snapshot.you.accountId;
                return (
                  <li key={character.id}>
                    <span className="avatar" aria-hidden="true" style={{ '--hue': hue(character.name || character.id) } as CSSProperties}>
                      {initials(character.name || '?')}
                    </span>
                    <span className="member-name">
                      {visible ? (
                        <Link href={routePath.character(campaignId, character.id)}>{character.name || t('character.unnamed')}</Link>
                      ) : (
                        character.name || t('character.unnamed')
                      )}
                      {owner && <span className="muted small"> · {owner.username}</span>}
                    </span>
                    <span className="badge">{character.status === 'final' ? t('character.level', { level: character.level }) : t('character.statusDraft')}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            className="primary"
            disabled={busy || connection !== 'connected'}
            onClick={() =>
              void run(async () => {
                const characterId = `char-${globalThis.crypto.randomUUID()}`;
                await sendCommand({ requestId: globalThis.crypto.randomUUID(), campaignId, targetId: characterId, kind: 'character.create', payload: {} });
                navigate(routePath.character(campaignId, characterId));
              })
            }
          >
            <Icon name="plus" />
            {t('room.createCharacter')}
          </button>
        </section>

        {isDm && snapshot.dm && (
          <section className="card dm-tools" aria-labelledby="invites-heading">
            <p className="eyebrow">
              <Icon name="crown" />
              {t('room.dmTools')}
            </p>
            <h2 id="invites-heading">
              <Icon name="ticket" />
              {t('room.invites')}
            </h2>
            <p className="muted">{t('room.invitesIntro')}</p>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setCopied(false);
                  setCreated(await api.createInvite(campaignId));
                })
              }
            >
              <Icon name="plus" />
              {t('room.createInvite')}
            </button>
            {orderedInvites.length === 0 ? (
              <p className="muted">{t('room.noInvites')}</p>
            ) : (
              <ul className="invite-list">
                {orderedInvites.map((invite) => (
                  <li key={invite.id} className={invite.revoked ? 'is-revoked' : undefined}>
                    <span className="invite-date">
                      {t('room.inviteCreatedAt', { date: dateFormat.format(new Date(invite.createdAt)) })}
                    </span>
                    {invite.revoked ? (
                      <span className="badge">{t('room.inviteRevoked')}</span>
                    ) : (
                      <>
                        <span className="badge badge-ok">{t('room.inviteActive')}</span>
                        <button
                          type="button"
                          className="small"
                          disabled={busy}
                          onClick={() => void run(() => api.revokeInvite(campaignId, invite.id))}
                        >
                          {t('room.revoke')}
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      {removing && (
        <Dialog
          title={t('room.removeTitle', { username: removing.username })}
          onClose={() => setRemoving(null)}
          actions={
            <>
              <button type="button" data-autofocus onClick={() => setRemoving(null)}>
                {t('room.cancel')}
              </button>
              <button
                type="button"
                className="danger solid"
                disabled={busy}
                onClick={async () => {
                  if (await run(() => api.removeMember(campaignId, removing.accountId))) setRemoving(null);
                }}
              >
                {t('room.removeConfirm')}
              </button>
            </>
          }
        >
          <p>{t('room.removeBody')}</p>
        </Dialog>
      )}

      {created && (
        <Dialog
          title={t('room.newInvite')}
          onClose={() => setCreated(null)}
          actions={
            <>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(created.code);
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                <Icon name={copied ? 'check' : 'copy'} />
                {copied ? t('room.copied') : t('room.copy')}
              </button>
              <button type="button" className="primary" onClick={() => setCreated(null)}>
                {t('room.close')}
              </button>
            </>
          }
        >
          <p>{t('room.newInviteHelp')}</p>
          <input
            className="invite-code mono"
            readOnly
            value={created.code}
            aria-label={t('room.newInvite')}
            data-autofocus
            onFocus={(e) => e.currentTarget.select()}
          />
        </Dialog>
      )}
    </div>
  );
}

/** Warna avatar stabil per nama (hanya dekorasi; nama tetap ditulis). */
function hue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
