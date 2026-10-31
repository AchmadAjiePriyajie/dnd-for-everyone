import { useId } from 'react';
import type { FogState, GridSettings } from '#shared/scenes';

/**
 * Kabut manual: area di luar persegi yang diungkap DM digelapkan. Ini tampilan saja — token di
 * area tertutup sudah tidak dikirim server ke player, dan gambar latar harus aman dilihat.
 * DM melihat kabut transparan agar tetap bisa menyiapkan scene.
 */
export function RevealLayer({ grid, fog, isDm }: { grid: GridSettings; fog: FogState; isDm: boolean }) {
  const id = useId();
  if (!fog.enabled) return null;
  return (
    <g className={`reveal-layer${isDm ? ' is-dm' : ''}`} pointerEvents="none" data-testid="fog">
      <mask id={`fog-${id}`}>
        <rect x="0" y="0" width={grid.columns} height={grid.rows} fill="white" />
        {fog.revealed.map((area, index) => (
          <rect key={index} x={area.x} y={area.y} width={area.w} height={area.h} fill="black" />
        ))}
      </mask>
      <rect className="fog" x="0" y="0" width={grid.columns} height={grid.rows} mask={`url(#fog-${id})`} />
    </g>
  );
}
