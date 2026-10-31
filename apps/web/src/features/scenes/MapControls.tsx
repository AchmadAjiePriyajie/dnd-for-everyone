import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { gridDistance } from '#rules/movement';
import type { Id } from '#shared/contracts';
import { AREA_DIRECTIONS, AREA_SHAPES, type AreaMarker, type FogState, type GridPoint, type SceneView, type Token } from '#shared/scenes';
import type { Ruler } from './MeasurementLayer';

export const MAP_TOOLS = ['select', 'measure', 'ping', 'area', 'reveal'] as const;
export type MapTool = (typeof MAP_TOOLS)[number];

type MarkerDraft = Omit<AreaMarker, 'id' | 'ownerAccountId' | 'sceneId'>;

interface Props {
  scene: SceneView;
  isDm: boolean;
  accountId: Id | undefined;
  tool: MapTool;
  setTool(tool: MapTool): void;
  selectedToken: Token | null;
  canMove(token: Token): boolean;
  ruler: Ruler | null;
  setRuler(ruler: Ruler | null): void;
  onMoveTo(token: Token, target: GridPoint): void;
  onPing(point: GridPoint): void;
  onPlaceMarker(marker: MarkerDraft): void;
  onRemoveMarker(markerId: Id): void;
  onFog(fog: FogState): void;
}

/** Bilangan kotak 1-based dari input → indeks 0-based dalam batas grid. */
const cell = (value: string, max: number) => Math.min(max - 1, Math.max(0, Math.round(Number(value)) - 1));

/**
 * Alat peta. Setiap alat juga punya form kolom/baris, sehingga tap/klik di peta dan keyboard/layar
 * sentuh tanpa presisi menghasilkan perintah yang sama.
 */
export function MapControls(props: Props) {
  const { scene, isDm, tool, setTool, selectedToken, canMove, ruler, setRuler } = props;
  const { t } = useTranslation();
  const id = useId();
  const grid = scene.grid;
  const [target, setTarget] = useState({ column: '1', row: '1' });
  const [area, setArea] = useState({ shape: 'sphere' as MarkerDraft['shape'], size: '20', width: '5', direction: 'E' as MarkerDraft['direction'], column: '1', row: '1', label: '' });
  const [reveal, setReveal] = useState({ column: '1', row: '1', w: '4', h: '4' });
  const point = (): GridPoint => ({ x: cell(target.column, grid.columns), y: cell(target.row, grid.rows) });
  const tools = MAP_TOOLS.filter((candidate) => candidate !== 'reveal' || isDm);
  const field = (name: string, label: string, value: string, onChange: (value: string) => void, step = '1') => (
    <div className="field">
      <label htmlFor={`${id}-${name}`}>{label}</label>
      <input id={`${id}-${name}`} type="number" step={step} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
  const targetFields = (
    <div className="field-row">
      {field('column', t('scenes.token.x'), target.column, (column) => setTarget({ ...target, column }))}
      {field('row', t('scenes.token.y'), target.row, (row) => setTarget({ ...target, row }))}
    </div>
  );

  return (
    <section className="card map-tools" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{t('scenes.tools')}</h2>
      <div className="segmented" role="radiogroup" aria-label={t('scenes.tools')}>
        {tools.map((candidate) => (
          <label key={candidate} className="check">
            <input type="radio" name={`${id}-tool`} checked={tool === candidate} onChange={() => setTool(candidate)} />
            {t(`scenes.tool.${candidate}`)}
          </label>
        ))}
      </div>
      <p className="hint">{t(`scenes.toolHint.${tool}`)}</p>

      {tool === 'select' &&
        (selectedToken && canMove(selectedToken) ? (
          <form
            aria-label={t('scenes.moveTo', { label: selectedToken.label })}
            onSubmit={(event) => {
              event.preventDefault();
              props.onMoveTo(selectedToken, point());
            }}
          >
            {targetFields}
            <button type="submit">{t('scenes.moveButton', { label: selectedToken.label })}</button>
          </form>
        ) : (
          <p className="muted small">{t('scenes.pickToken')}</p>
        ))}

      {tool === 'measure' && (
        <form
          aria-label={t('scenes.tool.measure')}
          onSubmit={(event) => {
            event.preventDefault();
            const from = selectedToken ? { x: selectedToken.x, y: selectedToken.y } : (ruler?.from ?? { x: 0, y: 0 });
            setRuler({ from, to: point() });
          }}
        >
          {targetFields}
          <button type="submit">{t('scenes.measureButton')}</button>
          {ruler && (
            <p role="status">
              {t('scenes.distance', { feet: gridDistance(ruler.from, ruler.to, grid), from: `${ruler.from.x + 1},${ruler.from.y + 1}`, to: `${ruler.to.x + 1},${ruler.to.y + 1}` })}
            </p>
          )}
        </form>
      )}

      {tool === 'ping' && (
        <form
          aria-label={t('scenes.tool.ping')}
          onSubmit={(event) => {
            event.preventDefault();
            props.onPing(point());
          }}
        >
          {targetFields}
          <button type="submit">{t('scenes.pingButton')}</button>
        </form>
      )}

      {tool === 'area' && (
        <>
          <form
            aria-label={t('scenes.tool.area')}
            onSubmit={(event) => {
              event.preventDefault();
              props.onPlaceMarker({
                shape: area.shape,
                sizeFeet: Number(area.size),
                ...(area.shape === 'line' ? { widthFeet: Number(area.width) } : {}),
                direction: area.direction,
                // Titik asal di sudut kotak (kolom/baris 1-based → koordinat sudut).
                origin: { x: Math.max(0, Number(area.column) - 1), y: Math.max(0, Number(area.row) - 1) },
                label: area.label,
              });
            }}
          >
            <div className="field-row">
              <div className="field">
                <label htmlFor={`${id}-shape`}>{t('scenes.shapeLabel')}</label>
                <select id={`${id}-shape`} value={area.shape} onChange={(event) => setArea({ ...area, shape: event.target.value as MarkerDraft['shape'] })}>
                  {AREA_SHAPES.map((shape) => (
                    <option key={shape} value={shape}>
                      {t(`scenes.shape.${shape}`)}
                    </option>
                  ))}
                </select>
              </div>
              {field('size', t('scenes.sizeFeet'), area.size, (size) => setArea({ ...area, size }), '5')}
              {area.shape === 'line' && field('width', t('scenes.widthFeet'), area.width, (width) => setArea({ ...area, width }), '5')}
              <div className="field">
                <label htmlFor={`${id}-dir`}>{t('scenes.direction')}</label>
                <select id={`${id}-dir`} value={area.direction} onChange={(event) => setArea({ ...area, direction: event.target.value as MarkerDraft['direction'] })}>
                  {AREA_DIRECTIONS.map((direction) => (
                    <option key={direction} value={direction}>
                      {direction}
                    </option>
                  ))}
                </select>
              </div>
              {field('acol', t('scenes.originColumn'), area.column, (column) => setArea({ ...area, column }), '0.5')}
              {field('arow', t('scenes.originRow'), area.row, (row) => setArea({ ...area, row }), '0.5')}
              <div className="field">
                <label htmlFor={`${id}-alabel`}>{t('scenes.areaName')}</label>
                <input id={`${id}-alabel`} value={area.label} maxLength={60} onChange={(event) => setArea({ ...area, label: event.target.value })} />
              </div>
            </div>
            <button type="submit">{t('scenes.placeArea')}</button>
          </form>
          <ul className="row-list">
            {scene.markers.map((marker) => (
              <li key={marker.id}>
                <span className="row-main">
                  {marker.label || t(`scenes.shape.${marker.shape}`)} · {t('scenes.feet', { feet: marker.sizeFeet })}
                </span>
                {(isDm || marker.ownerAccountId === props.accountId) && (
                  <button type="button" onClick={() => props.onRemoveMarker(marker.id)}>
                    {t('scenes.removeArea', { label: marker.label || t(`scenes.shape.${marker.shape}`) })}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {tool === 'reveal' && isDm && (
        <form
          aria-label={t('scenes.tool.reveal')}
          onSubmit={(event) => {
            event.preventDefault();
            const rect = { x: cell(reveal.column, grid.columns), y: cell(reveal.row, grid.rows), w: Math.max(1, Math.round(Number(reveal.w))), h: Math.max(1, Math.round(Number(reveal.h))) };
            props.onFog({ enabled: true, revealed: [...scene.fog.revealed, rect] });
          }}
        >
          <label className="check">
            <input type="checkbox" checked={scene.fog.enabled} onChange={(event) => props.onFog({ ...scene.fog, enabled: event.target.checked })} />
            {t('scenes.fogEnabled')}
          </label>
          <div className="field-row">
            {field('rcol', t('scenes.token.x'), reveal.column, (column) => setReveal({ ...reveal, column }))}
            {field('rrow', t('scenes.token.y'), reveal.row, (row) => setReveal({ ...reveal, row }))}
            {field('rw', t('scenes.revealWidth'), reveal.w, (w) => setReveal({ ...reveal, w }))}
            {field('rh', t('scenes.revealHeight'), reveal.h, (h) => setReveal({ ...reveal, h }))}
          </div>
          <p className="row-actions">
            <button type="submit">{t('scenes.revealArea')}</button>
            <button type="button" onClick={() => props.onFog({ enabled: true, revealed: [] })}>
              {t('scenes.coverAll')}
            </button>
          </p>
        </form>
      )}
    </section>
  );
}
