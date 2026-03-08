import type { GraphNode } from '../types/graph';

interface NodeTooltipProps {
  node: GraphNode;
  connectionCount: number;
  x: number;
  y: number;
}

export function NodeTooltip({
  node,
  connectionCount,
  x,
  y,
}: NodeTooltipProps) {
  return (
    <div
      className="pointer-events-none absolute z-20 rounded-full border border-white/10 bg-slate-950/90 px-3 py-1.5 text-xs font-medium text-white shadow-lg shadow-slate-950/40 backdrop-blur"
      style={{
        left: x,
        top: y,
        transform: 'translate(-50%, calc(-100% - 18px))',
      }}
    >
      {node.name} ({connectionCount})
    </div>
  );
}
