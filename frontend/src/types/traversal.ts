export interface TraversalStep {
  nodeId: string;
  concept: string;
  hop: number;
  brightness: number;
  delayMs: number;
}

export interface TraversalPlan {
  rootNodeId: string;
  stepIntervalMs: number;
  pulseDurationMs: number;
  brightnessDecay: number;
  brightnessThreshold: number;
  steps: TraversalStep[];
}

export interface ActiveTraversal {
  runId: number;
  plan: TraversalPlan;
}
