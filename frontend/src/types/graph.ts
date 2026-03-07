export type GraphNodeType =
  | 'Concept'
  | 'Document'
  | 'Project'
  | 'Task'
  | 'Reflection';

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  name: string;
  x?: number;
  y?: number;
  z?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
}

export interface GraphApiResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export type GraphSource = 'api' | 'mock';

