import { type KeyboardEvent, type PointerEvent, type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiError } from '#shared/access';
import type { Id, JsonValue } from '#shared/contracts';
import { straightPath } from '#rules/movement';
import type { AreaMarker, Asset, FogState, GridPoint, SceneView, Token } from '#shared/scenes';
import { api, assetUrl } from '../../app/api';
import { Icon } from '../../app/icons';
import { Link, routePath } from '../../app/router';
import { onMapPing, sendCommand, useRoomEntry } from '../../app/room-store';
import { ErrorMessage, toApiError } from '../../app/ui';
import { MapControls, type MapTool } from './MapControls';
import { MeasurementLayer, type PingMark, type Ruler } from './MeasurementLayer';
import { RevealLayer } from './RevealLayer';
import { TokenPanel } from './TokenPanel';

/** Lama ping tampil di peta (ms); ping tidak disimpan di mana pun. */
const PING_MS = 3000;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;

interface MapProps {
  scene: SceneView;
  background: { url: string; width: number; height: number } | null;
  selected: Id | null;
  onSelect(tokenId: Id | null): void;
  /** Boleh digerakkan oleh peserta ini (DM: semua; player: miliknya). */
  canMove(token: Token): boolean;
  onMove(token: Token, x: number, y: number): void;
  /** Tap/klik pada kotak peta (alat aktif menentukan artinya). */
  onCellTap?(cell: GridPoint): void;
  /** Lapisan di bawah token (kabut, area, penggaris, ping). */
  layers?: ReactNode;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Peta SVG dalam satuan sel grid (viewBox = kolom × baris). Token dapat diseret, atau dipilih lalu
 * digerakkan dengan tombol panah — kontrol DOM yang juga bekerja tanpa mouse.
 */
export function BattleMap({ scene, background, selected, onSelect, canMove, onMove, onCellTap, layers }: MapProps) {
  const { t } = useTranslation();
  const grid = scene.grid;
  const svg = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [drag, setDrag] = useState<{ id: Id; x: number; y: number } | null>(null);
  const width = grid.columns / view.zoom;
  const height = grid.rows / view.zoom;

  const toCell = (event: PointerEvent): { x: number; y: number } | null => {
    const matrix = svg.current?.getScreenCTM?.();
    if (!matrix || !svg.current) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: Math.floor(point.x), y: Math.floor(point.y) };
  };
  const zoom = (factor: number) => setView((current) => ({ ...current, zoom: clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM) }));
  const pan = (dx: number, dy: number) => setView((current) => ({ ...current, x: clamp(current.x + dx, -grid.columns, grid.columns), y: clamp(current.y + dy, -grid.rows, grid.rows) }));
  const keyMove = (event: KeyboardEvent, token: Token) => {
    const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const delta = step[event.key];
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(selected === token.id ? null : token.id);
      return;
    }
    if (!delta || !canMove(token)) return;
    event.preventDefault();
    const x = clamp(token.x + delta[0], 0, grid.columns - token.size);
    const y = clamp(token.y + delta[1], 0, grid.rows - token.size);
    if (x !== token.x || y !== token.y) onMove(token, x, y);
  };

  return (
    <div className="battle-map">
      <div className="row-actions map-controls" role="toolbar" aria-label={t('scenes.mapControls')}>
        <button type="button" onClick={() => zoom(ZOOM_STEP)} aria-label={t('scenes.zoomIn')}>
          +
        </button>
        <button type="button" onClick={() => zoom(1 / ZOOM_STEP)} aria-label={t('scenes.zoomOut')}>
          −
        </button>
        {(
          [
            ['panLeft', -2, 0, '←'],
            ['panUp', 0, -2, '↑'],
            ['panDown', 0, 2, '↓'],
            ['panRight', 2, 0, '→'],
          ] as const
        ).map(([key, dx, dy, label]) => (
          <button key={key} type="button" onClick={() => pan(dx, dy)} aria-label={t(`scenes.${key}`)}>
            {label}
          </button>
        ))}
        <button type="button" onClick={() => setView({ zoom: 1, x: 0, y: 0 })}>
          {t('scenes.resetView')}
        </button>
      </div>
      <svg
        ref={svg}
        className="map-surface"
        viewBox={`${view.x} ${view.y} ${width} ${height}`}
        role="group"
        aria-label={t('scenes.mapLabel', { name: scene.name, columns: grid.columns, rows: grid.rows })}
        onWheel={(event) => zoom(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)}
        onClick={(event) => {
          if (drag || (event.target as Element).closest('.map-token')) return;
          const cell = toCell(event as unknown as PointerEvent);
          if (cell && cell.x >= 0 && cell.y >= 0 && cell.x < grid.columns && cell.y < grid.rows) onCellTap?.(cell);
        }}
        onPointerMove={(event) => {
          if (!drag) return;
          const cell = toCell(event);
          if (cell) setDrag({ ...drag, x: cell.x, y: cell.y });
        }}
        onPointerUp={() => {
          if (!drag) return;
          const token = scene.tokens.find((candidate) => candidate.id === drag.id);
          setDrag(null);
          if (!token) return;
          const x = clamp(drag.x, 0, grid.columns - token.size);
          const y = clamp(drag.y, 0, grid.rows - token.size);
          if (x !== token.x || y !== token.y) onMove(token, x, y);
        }}
      >
        <defs>
          <pattern id={`grid-${scene.id}`} width="1" height="1" patternUnits="userSpaceOnUse">
            <path d="M 1 0 L 0 0 0 1" fill="none" className="grid-line" />
          </pattern>
        </defs>
        <rect x="0" y="0" width={grid.columns} height={grid.rows} className="map-floor" />
        {background && (
          <image
            href={background.url}
            x={-grid.offsetX / grid.cellPixels}
            y={-grid.offsetY / grid.cellPixels}
            width={background.width / grid.cellPixels}
            height={background.height / grid.cellPixels}
            preserveAspectRatio="none"
          />
        )}
        <rect x="0" y="0" width={grid.columns} height={grid.rows} fill={`url(#grid-${scene.id})`} />
        {(grid.difficult ?? []).map((cell) => (
          <rect key={`d-${cell.x},${cell.y}`} className="difficult-cell" x={cell.x} y={cell.y} width="1" height="1" />
        ))}
        {layers}
        {scene.tokens.map((token) => {
          const position = drag?.id === token.id ? drag : token;
          const movable = canMove(token);
          return (
            <g
              key={token.id}
              role="button"
              tabIndex={0}
              aria-pressed={selected === token.id}
              aria-label={t('scenes.tokenLabel', { label: token.label, column: token.x + 1, row: token.y + 1 })}
              className={`map-token kind-${token.kind}${token.hidden ? ' is-hidden' : ''}${selected === token.id ? ' is-selected' : ''}${movable ? ' is-movable' : ''}`}
              transform={`translate(${position.x} ${position.y})`}
              onKeyDown={(event) => keyMove(event, token)}
              onClick={() => onSelect(selected === token.id ? null : token.id)}
              onPointerDown={(event) => {
                if (!movable) return;
                (event.target as Element).setPointerCapture?.(event.pointerId);
                setDrag({ id: token.id, x: token.x, y: token.y });
              }}
            >
              <circle cx={token.size / 2} cy={token.size / 2} r={token.size / 2 - 0.08} />
              <text x={token.size / 2} y={token.size / 2} dominantBaseline="central" textAnchor="middle" fontSize={0.4 * Math.min(2, token.size)}>
                {token.label.slice(0, 2).toUpperCase()}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="hint">{t('scenes.keyboardHint')}</p>
    </div>
  );
}

/** Halaman scene: pilih scene, lihat peta, DM mengatur peta dan token. */
export function ScenesPage({ campaignId }: { campaignId: Id }) {
  const { t } = useTranslation();
  const id = useId();
  const snapshot = useRoomEntry(campaignId)?.snapshot;
  const scenes = snapshot?.scenes ?? [];
  const [sceneId, setSceneId] = useState<Id | null>(null);
  const [scene, setScene] = useState<SceneView | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selected, setSelected] = useState<Id | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [tool, setTool] = useState<MapTool>('select');
  const [ruler, setRuler] = useState<Ruler | null>(null);
  const [pings, setPings] = useState<PingMark[]>([]);
  const isDm = snapshot?.you.role === 'dm';
  const accountId = snapshot?.you.accountId;
  const sequence = snapshot?.eventSequence;
  const activeId = sceneId ?? scenes[0]?.id ?? null;

  const reload = useCallback(async () => {
    if (!activeId) return setScene(null);
    setScene(await api.scene(campaignId, activeId));
  }, [campaignId, activeId]);
  useEffect(() => {
    reload().catch((cause) => setError(toApiError(cause)));
    api.assets(campaignId).then(setAssets, () => setAssets([]));
  }, [reload, campaignId, sequence]);

  const showPing = useCallback((x: number, y: number) => {
    const key = globalThis.crypto.randomUUID();
    setPings((current) => [...current, { key, x, y }]);
    setTimeout(() => setPings((current) => current.filter((ping) => ping.key !== key)), PING_MS);
  }, []);
  useEffect(() => onMapPing((ping) => ping.sceneId === activeId && ping.accountId !== accountId && showPing(ping.x, ping.y)), [activeId, accountId, showPing]);

  const send = async (kind: string, targetId: Id, payload: Record<string, unknown>, expectedRevision?: number) => {
    setError(null);
    try {
      await sendCommand({
        requestId: globalThis.crypto.randomUUID(),
        campaignId,
        targetId,
        kind,
        payload: payload as JsonValue,
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
      });
      await reload();
      return true;
    } catch (cause) {
      setError(toApiError(cause));
      return false;
    }
  };
  if (!snapshot) return <p className="muted">{t('app.loading')}</p>;
  const asset = scene?.assetId ? assets.find((candidate) => candidate.id === scene.assetId) : undefined;
  const canMove = (token: Token) => isDm || (token.ownerAccountId !== null && token.ownerAccountId === accountId);
  // Drag, keyboard dan tap memakai path lurus yang sama; server memvalidasi biaya dan batas.
  const moveTo = (token: Token, target: GridPoint) =>
    void send('token.move', token.id, { x: target.x, y: target.y, path: straightPath({ x: token.x, y: token.y }, target) });
  const ping = (point: GridPoint) => {
    if (!scene) return;
    showPing(point.x, point.y);
    api.ping(campaignId, scene.id, point.x, point.y).catch((cause) => setError(toApiError(cause)));
  };
  const selectedToken = scene?.tokens.find((token) => token.id === selected) ?? null;
  const onCellTap = (cell: GridPoint) => {
    if (tool === 'select' && selectedToken && canMove(selectedToken)) moveTo(selectedToken, cell);
    else if (tool === 'measure') {
      // Dengan token terpilih: ukur dari token. Tanpa token: tap pertama titik awal, tap kedua tujuan.
      const started = ruler && ruler.from.x === ruler.to.x && ruler.from.y === ruler.to.y;
      setRuler(selectedToken ? { from: { x: selectedToken.x, y: selectedToken.y }, to: cell } : started ? { from: ruler.from, to: cell } : { from: cell, to: cell });
    }
    else if (tool === 'ping') ping(cell);
  };
  const placeMarker = (marker: Omit<AreaMarker, 'id' | 'ownerAccountId' | 'sceneId'>) => scene && void send('marker.place', globalThis.crypto.randomUUID(), { ...marker, sceneId: scene.id });
  const setFog = (fog: FogState) => scene && void send('scene.fog', scene.id, fog);
  const background = scene && asset ? { url: assetUrl(campaignId, asset.id), width: asset.width, height: asset.height } : null;

  return (
    <div className="room">
      <Link href={routePath.campaign(campaignId)} className="back-link">
        <Icon name="arrowLeft" />
        {t('reference.backToRoom')}
      </Link>
      <h1>{t('scenes.title')}</h1>
      <ErrorMessage error={error} />
      {scenes.length > 0 && (
        <div className="field">
          <label htmlFor={`${id}-scene`}>{t('scenes.pick')}</label>
          <select id={`${id}-scene`} value={activeId ?? ''} onChange={(event) => setSceneId(event.target.value)}>
            {scenes.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
                {isDm && !entry.shared ? ` (${t('scenes.notShared')})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      {!scenes.length && <p className="muted">{isDm ? t('scenes.emptyDm') : t('scenes.emptyPlayer')}</p>}
      <div className="scene-layout">
        {scene && (
          <div className="battle-column">
            <BattleMap
              scene={scene}
              background={background}
              selected={selected}
              onSelect={setSelected}
              canMove={canMove}
              onMove={(token, x, y) => moveTo(token, { x, y })}
              onCellTap={onCellTap}
              layers={
                <>
                  <RevealLayer grid={scene.grid} fog={scene.fog} isDm={isDm} />
                  <MeasurementLayer grid={scene.grid} ruler={ruler} markers={scene.markers} pings={pings} />
                </>
              }
            />
            <MapControls
              scene={scene}
              isDm={isDm}
              accountId={accountId}
              tool={tool}
              setTool={setTool}
              selectedToken={selectedToken}
              canMove={canMove}
              ruler={ruler}
              setRuler={setRuler}
              onMoveTo={moveTo}
              onPing={ping}
              onPlaceMarker={placeMarker}
              onRemoveMarker={(markerId) => void send('marker.remove', markerId, {})}
              onFog={setFog}
            />
          </div>
        )}
        {isDm && (
          <TokenPanel
            key={scene?.id ?? 'new'}
            campaignId={campaignId}
            scene={scene}
            assets={assets}
            members={snapshot.members}
            selected={selected}
            onSelect={setSelected}
            send={send}
            onSceneCreated={(newId) => setSceneId(newId)}
            onAssetsChanged={() => api.assets(campaignId).then(setAssets, (cause) => setError(toApiError(cause)))}
          />
        )}
      </div>
    </div>
  );
}

