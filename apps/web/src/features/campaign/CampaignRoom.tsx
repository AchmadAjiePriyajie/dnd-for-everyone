import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiError, CreatedInvite, MemberView } from '#shared/access';
import type { Id } from '#shared/contracts';
import { api } from '../../app/api';
import { Link, routePath } from '../../app/router';
import { refreshRoom, useRoomEntry } from '../../app/room-store';
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
      <section className="card">
        {entry?.error ? (
          <>
            <h1>{t('room.noAccess')}</h1>
            <ErrorMessage error={entry.error} />
          </>
        ) : (
          <p className="muted">{t('room.loading')}</p>
        )}
        <Link href={routePath.lobby()}>{t('room.back')}</Link>
      </section>
    );
  }

  const isDm = snapshot.you.role === 'dm';
  const roleName = (role: 'dm' | 'player') => (role === 'dm' ? t('lobby.roleDm') : t('lobby.rolePlayer'));
  const dateFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="room">
      <header className="room-header">
        <Link href={routePath.lobby()} className="small">
          ← {t('room.back')}
        </Link>
        <h1>{snapshot.campaign.title}</h1>
        <p className="muted">
          {t('room.youAre', { role: roleName(snapshot.you.role) })} · {t('lobby.ruleset', { ruleset: snapshot.campaign.ruleset })}
        </p>
        {entry.error && <ErrorMessage error={entry.error} />}
        <ErrorMessage error={actionError} />
      </header>

      <div className="room-grid">
        <section className="card" aria-labelledby="party-heading">
          <h2 id="party-heading">{t('room.members')}</h2>
          <ul className="member-list">
            {snapshot.members.map((member) => (
              <li key={member.accountId}>
                <span className="member-name">
                  {member.username}
                  {member.accountId === snapshot.you.accountId && <span className="muted"> ({t('room.you')})</span>}
                </span>
                <span className={`badge badge-${member.role}`}>{roleName(member.role)}</span>
                {isDm && member.role === 'player' && (
                  <button type="button" className="danger small" disabled={busy} onClick={() => setRemoving(member)}>
                    {t('room.remove')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        {isDm && snapshot.dm && (
          <section className="card" aria-labelledby="invites-heading">
            <h2 id="invites-heading">{t('room.invites')}</h2>
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
              {t('room.createInvite')}
            </button>
            {snapshot.dm.invites.length === 0 ? (
              <p className="muted">{t('room.noInvites')}</p>
            ) : (
              <ul className="invite-list">
                {snapshot.dm.invites.map((invite) => (
                  <li key={invite.id}>
                    <span>{t('room.inviteCreatedAt', { date: dateFormat.format(new Date(invite.createdAt)) })}</span>
                    {invite.revoked ? (
                      <span className="badge">{t('room.inviteRevoked')}</span>
                    ) : (
                      <button
                        type="button"
                        className="small"
                        disabled={busy}
                        onClick={() => void run(() => api.revokeInvite(campaignId, invite.id))}
                      >
                        {t('room.revoke')}
                      </button>
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
                className="danger"
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
            className="invite-code"
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
