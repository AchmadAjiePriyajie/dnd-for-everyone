import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MemberView } from '#shared/access';
import type { Id } from '#shared/contracts';
import { type Asset, type AssetVisibility, ASSET_MIME_TYPES, type GridSettings, type SceneView, TOKEN_KINDS } from '#shared/scenes';
import { api } from '../../app/api';
import { Icon } from '../../app/icons';
import { toApiError, useErrorText } from '../../app/ui';

type Send = (kind: string, targetId: Id, payload: Record<string, unknown>, expectedRevision?: number) => Promise<boolean>;

interface Props {
  campaignId: Id;
  scene: SceneView | null;
  assets: Asset[];
  members: MemberView[];
  selected: Id | null;
  onSelect(tokenId: Id | null): void;
  send: Send;
  onSceneCreated(sceneId: Id): void;
  onAssetsChanged(): void;
}

const defaultGrid = (): GridSettings => ({ columns: 20, rows: 15, cellPixels: 50, offsetX: 0, offsetY: 0, feetPerCell: 5 });

/** Alat DM: peta (upload, kalibrasi grid, bagikan) dan token (tambah, sembunyikan, gerak, hapus). */
export function TokenPanel({ campaignId, scene, assets, members, selected, onSelect, send, onSceneCreated, onAssetsChanged }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const errorText = useErrorText();
  const [name, setName] = useState(scene?.name ?? '');
  const [grid, setGrid] = useState<GridSettings>(scene?.grid ?? defaultGrid());
  const [assetId, setAssetId] = useState<Id | ''>(scene?.assetId ?? '');
  const [creating, setCreating] = useState(!scene);
  const [uploadVisibility, setUploadVisibility] = useState<AssetVisibility>('party');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [token, setToken] = useState({ label: '', kind: 'monster' as (typeof TOKEN_KINDS)[number], ownerAccountId: '', size: 1, x: 0, y: 0, hidden: false, hp: '' });
  const players = members.filter((member) => member.role === 'player');
  const partyAssets = assets.filter((asset) => asset.visibility === 'party');
  const selectedToken = scene?.tokens.find((candidate) => candidate.id === selected) ?? null;

  const startNew = () => {
    setCreating(true);
    setName('');
    setGrid(defaultGrid());
    setAssetId('');
  };
  const startEdit = () => {
    if (!scene) return;
    setCreating(false);
    setName(scene.name);
    setGrid(scene.grid);
    setAssetId(scene.assetId ?? '');
  };
  const saveScene = async (event: FormEvent) => {
    event.preventDefault();
    const draft = { name, assetId: assetId || null, grid };
    if (creating || !scene) {
      const newId = globalThis.crypto.randomUUID();
      if (await send('scene.save', newId, draft)) {
        setCreating(false);
        onSceneCreated(newId);
      }
    } else await send('scene.save', scene.id, draft, scene.revision);
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    try {
      const asset = await api.uploadAsset(campaignId, file, file.name.slice(0, 120) || 'map', uploadVisibility);
      if (asset.visibility === 'party') setAssetId(asset.id);
      onAssetsChanged();
    } catch (cause) {
      setUploadError(errorText(toApiError(cause)));
    }
  };
  const placeToken = async (event: FormEvent) => {
    event.preventDefault();
    if (!scene) return;
    const hp = Number(token.hp);
    const placed = await send('token.place', globalThis.crypto.randomUUID(), {
      sceneId: scene.id,
      label: token.label,
      kind: token.kind,
      ...(token.ownerAccountId ? { ownerAccountId: token.ownerAccountId } : {}),
      x: token.x,
      y: token.y,
      size: token.size,
      hidden: token.hidden,
      ...(token.hp && Number.isInteger(hp) && hp > 0 ? { hp: { current: hp, max: hp } } : {}),
    });
    if (placed) setToken((current) => ({ ...current, label: '' }));
  };
  const gridField = (field: keyof GridSettings, min: number, max: number) => (
    <div key={field} className="field">
      <label htmlFor={`${id}-${field}`}>{t(`scenes.grid.${field}`)}</label>
      <input id={`${id}-${field}`} type="number" min={min} max={max} value={grid[field]} onChange={(event) => setGrid({ ...grid, [field]: Number(event.target.value) })} />
    </div>
  );

  return (
    <aside className="card token-panel" aria-labelledby={`${id}-heading`}>
      <p className="eyebrow">
        <Icon name="crown" />
        {t('room.dmTools')}
      </p>
      <h2 id={`${id}-heading`}>{t('scenes.dmPanel')}</h2>

      {scene && (
        <p className="row-actions">
          <button type="button" onClick={() => void send('scene.share', scene.id, { shared: !scene.shared }, scene.revision)}>
            <Icon name={scene.shared ? 'eyeOff' : 'eye'} />
            {scene.shared ? t('scenes.unshare') : t('scenes.share')}
          </button>
          <button type="button" onClick={startEdit}>
            {t('scenes.editScene')}
          </button>
          <button type="button" onClick={startNew}>
            <Icon name="plus" />
            {t('scenes.newScene')}
          </button>
        </p>
      )}

      <form onSubmit={(event) => void saveScene(event)} aria-label={creating || !scene ? t('scenes.newScene') : t('scenes.editScene')}>
        <div className="field">
          <label htmlFor={`${id}-name`}>{t('scenes.name')}</label>
          <input id={`${id}-name`} value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-asset`}>{t('scenes.background')}</label>
          <select id={`${id}-asset`} value={assetId} onChange={(event) => setAssetId(event.target.value)}>
            <option value="">{t('scenes.blankGrid')}</option>
            {partyAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name} ({asset.width}×{asset.height})
              </option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor={`${id}-file`}>{t('scenes.upload')}</label>
            <input id={`${id}-file`} type="file" accept={ASSET_MIME_TYPES.join(',')} onChange={(event) => void upload(event.target.files?.[0])} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-vis`}>{t('scenes.uploadVisibility')}</label>
            <select id={`${id}-vis`} value={uploadVisibility} onChange={(event) => setUploadVisibility(event.target.value as AssetVisibility)}>
              <option value="party">{t('scenes.visibilityParty')}</option>
              <option value="dm">{t('scenes.visibilityDm')}</option>
            </select>
          </div>
        </div>
        <p className="hint">{t('scenes.uploadHint')}</p>
        {uploadError && (
          <p className="error" role="alert">
            {uploadError}
          </p>
        )}
        <div className="field-row">
          {gridField('columns', 1, 200)}
          {gridField('rows', 1, 200)}
          {gridField('cellPixels', 4, 1000)}
          {gridField('offsetX', -10_000, 10_000)}
          {gridField('offsetY', -10_000, 10_000)}
          {gridField('feetPerCell', 1, 100)}
        </div>
        <button type="submit" className="primary" disabled={!name.trim()}>
          {t('scenes.saveScene')}
        </button>
      </form>

      {scene && (
        <>
          <h3>{t('scenes.tokens')}</h3>
          <ul className="row-list">
            {scene.tokens.map((entry) => (
              <li key={entry.id}>
                <button type="button" className="link-button" aria-current={selected === entry.id ? 'true' : undefined} onClick={() => onSelect(selected === entry.id ? null : entry.id)}>
                  {entry.label}
                </button>
                <span className="muted small">
                  {t(`scenes.kind.${entry.kind}`)} · {entry.x + 1},{entry.y + 1}
                  {entry.hp && ` · HP ${entry.hp.current}/${entry.hp.max}`}
                </span>
                {entry.hidden && <span className="badge">{t('scenes.hiddenBadge')}</span>}
              </li>
            ))}
          </ul>
          {selectedToken && (
            <div className="row-actions" role="group" aria-label={t('scenes.selectedToken', { label: selectedToken.label })}>
              <button type="button" onClick={() => void send('token.update', selectedToken.id, { hidden: !selectedToken.hidden })}>
                <Icon name={selectedToken.hidden ? 'eye' : 'eyeOff'} />
                {selectedToken.hidden ? t('scenes.reveal') : t('scenes.hide')}
              </button>
              <button type="button" className="danger" onClick={() => void send('token.remove', selectedToken.id, {}).then(() => onSelect(null))}>
                {t('scenes.removeToken')}
              </button>
            </div>
          )}
          <form onSubmit={(event) => void placeToken(event)} aria-label={t('scenes.addToken')}>
            <div className="field-row">
              <div className="field">
                <label htmlFor={`${id}-label`}>{t('scenes.tokenName')}</label>
                <input id={`${id}-label`} value={token.label} maxLength={60} onChange={(event) => setToken({ ...token, label: event.target.value })} />
              </div>
              <div className="field">
                <label htmlFor={`${id}-kind`}>{t('scenes.tokenKind')}</label>
                <select id={`${id}-kind`} value={token.kind} onChange={(event) => setToken({ ...token, kind: event.target.value as (typeof TOKEN_KINDS)[number] })}>
                  {TOKEN_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {t(`scenes.kind.${kind}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`${id}-owner`}>{t('scenes.owner')}</label>
                <select id={`${id}-owner`} value={token.ownerAccountId} onChange={(event) => setToken({ ...token, ownerAccountId: event.target.value })}>
                  <option value="">{t('scenes.ownerDm')}</option>
                  {players.map((member) => (
                    <option key={member.accountId} value={member.accountId}>
                      {member.username}
                    </option>
                  ))}
                </select>
              </div>
              {(['x', 'y', 'size'] as const).map((field) => (
                <div key={field} className="field">
                  <label htmlFor={`${id}-t-${field}`}>{t(`scenes.token.${field}`)}</label>
                  <input
                    id={`${id}-t-${field}`}
                    type="number"
                    min={field === 'size' ? 1 : 0}
                    max={field === 'size' ? 4 : 199}
                    value={field === 'size' ? token.size : token[field] + 1}
                    onChange={(event) => setToken({ ...token, [field]: field === 'size' ? Number(event.target.value) : Number(event.target.value) - 1 })}
                  />
                </div>
              ))}
              <div className="field">
                <label htmlFor={`${id}-hp`}>{t('scenes.tokenHp')}</label>
                <input id={`${id}-hp`} type="number" min={1} value={token.hp} onChange={(event) => setToken({ ...token, hp: event.target.value })} />
              </div>
            </div>
            <label className="check">
              <input type="checkbox" checked={token.hidden} onChange={(event) => setToken({ ...token, hidden: event.target.checked })} />
              {t('scenes.placeHidden')}
            </label>
            <p>
              <button type="submit" disabled={!token.label.trim()}>
                <Icon name="plus" />
                {t('scenes.addToken')}
              </button>
            </p>
          </form>
        </>
      )}
    </aside>
  );
}
