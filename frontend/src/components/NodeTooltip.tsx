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
      className="pointer-events-none absolute z-20 w-64 rounded-2xl border border-cyan-300/20 bg-slate-950/90 p-4 text-sm text-slate-100 shadow-2xl shadow-cyan-950/30 backdrop-blur"
      style={{
        left: x,
        top: y,
        transform: 'translate(-50%, calc(-100% - 18px))',
      }}
    >
      <p className="text-lg font-semibold text-white">{node.name}</p>
      <div className="mt-2 flex items-center justify-between text-slate-300">
        <span>{node.type}</span>
        <span>{connectionCount} connections</span>
      </div>
    </div>
  );
}

