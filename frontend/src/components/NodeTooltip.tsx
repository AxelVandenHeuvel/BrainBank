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
      className={`absolute z-20 w-56 border border-white/[0.08] bg-black/90 p-3 text-sm text-neutral-100 shadow-xl backdrop-blur ${
        isInteractive ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
      style={{
        left: x,
        top: y,
        transform: 'translate(-50%, calc(-100% - 18px))',
      }}
    >
      <p className="font-semibold text-white">{node.name}</p>
      <div className="mt-1.5 flex items-center justify-between text-xs text-neutral-400">
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
          className="mt-3 inline-flex items-center border border-pink-500/30 bg-pink-500/10 px-3 py-1.5 text-xs font-medium text-pink-300 transition hover:bg-pink-500/20"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
