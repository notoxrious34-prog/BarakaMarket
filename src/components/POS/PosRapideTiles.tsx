import React, { memo } from 'react';
import { Zap } from 'lucide-react';
import { formatDZD } from '../../core/display';
import type { RapideMemEntry } from '../../core/rapide-memory';

/**
 * ADR-051 P1 — pinned rapide tiles island (MKT-004: memoized, PosView stays lean).
 * One-tap codeless staples above the catalog grid; hidden while searching.
 */
interface Props {
  tiles: RapideMemEntry[];
  visible: boolean;
  onPick: (e: RapideMemEntry) => void;
}

export const PosRapideTiles: React.FC<Props> = memo(function PosRapideTiles({ tiles, visible, onPick }) {
  if (!visible || tiles.length === 0) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 mb-2.5">
      {tiles.map(e => (
        <button
          key={`rapide-pin-${e.label}`}
          onClick={() => onPick(e)}
          title={e.label}
          className="rounded-xl border border-dashed border-amber-600/60 bg-amber-950/20 hover:bg-amber-950/40 p-2 text-start cursor-pointer transition-all"
        >
          <span className="flex items-center gap-1 text-[10px] font-black text-amber-400">
            <Zap className="w-3 h-3 shrink-0" />
            <span className="truncate">{e.label}</span>
          </span>
          <span className="block text-xs font-mono font-bold text-amber-200 mt-1" dir="ltr">
            {formatDZD(e.priceTtcCt / 100, false)}
          </span>
        </button>
      ))}
    </div>
  );
});
