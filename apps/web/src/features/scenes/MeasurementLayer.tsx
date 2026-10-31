import { useTranslation } from 'react-i18next';
import { aoeCells, gridDistance } from '#rules/movement';
import type { AreaMarker, GridPoint, GridSettings } from '#shared/scenes';

export interface Ruler {
  from: GridPoint;
  to: GridPoint;
}

export interface PingMark {
  key: string;
  x: number;
  y: number;
}

/**
 * Lapisan SVG di atas grid: penggaris (jarak menurut aturan diagonal scene), penanda area of
 * effect, dan ping sementara. Semua dalam satuan kotak grid.
 */
export function MeasurementLayer({ grid, ruler, markers, pings }: { grid: GridSettings; ruler: Ruler | null; markers: AreaMarker[]; pings: PingMark[] }) {
  const { t } = useTranslation();
  return (
    <g className="measurement-layer" pointerEvents="none">
      {markers.map((marker) => (
        <g key={marker.id} className={`aoe aoe-${marker.shape}`} aria-label={t('scenes.areaLabel', { label: marker.label || t(`scenes.shape.${marker.shape}`), feet: marker.sizeFeet })}>
          {aoeCells(marker, grid).map((cell) => (
            <rect key={`${cell.x},${cell.y}`} className="aoe-cell" x={cell.x} y={cell.y} width="1" height="1" />
          ))}
          <circle className="aoe-origin" cx={marker.origin.x} cy={marker.origin.y} r="0.15" />
        </g>
      ))}
      {ruler && (
        <g className="ruler">
          <line x1={ruler.from.x + 0.5} y1={ruler.from.y + 0.5} x2={ruler.to.x + 0.5} y2={ruler.to.y + 0.5} />
          <text x={ruler.to.x + 0.5} y={ruler.to.y - 0.2} textAnchor="middle" fontSize="0.45">
            {t('scenes.feet', { feet: gridDistance(ruler.from, ruler.to, grid) })}
          </text>
        </g>
      )}
      {pings.map((ping) => (
        <circle key={ping.key} className="ping" cx={ping.x + 0.5} cy={ping.y + 0.5} r="0.45" />
      ))}
    </g>
  );
}
