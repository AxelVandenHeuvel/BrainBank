import type { GraphNode } from '../types/graph';

interface NodeTooltipProps {
  node: GraphNode;
  connectionCount: number;
  x: number;
  y: number;
  actionLabel?: string;
  onAction?: () => void;
}

export function NodeTooltip({
  node,
  connectionCount,
  x,
  y,
  actionLabel,
  onAction,
}: NodeTooltipProps) {
  const isInteractive = Boolean(actionLabel && onAction);

  return (
    <div
      className={`absolute z-20 w-64 rounded-2xl border border-cyan-300/20 bg-slate-950/65 p-4 text-sm text-slate-100 shadow-2xl shadow-cyan-950/30 backdrop-blur ${
        isInteractive ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
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
      {isInteractive ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onAction?.();
          }}
          className="mt-4 inline-flex items-center rounded-full border border-cyan-300/30 bg-cyan-400/12 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-100 transition hover:bg-cyan-400/20"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
