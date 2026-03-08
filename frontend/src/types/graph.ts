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
  colorScore?: number;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  fx?: number;
  fy?: number;
  fz?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  reason?: string;
}

export interface GraphApiResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
  reason?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export type GraphSource = 'api' | 'mock';

export interface RelationshipDocument {
  doc_id: string;
  name: string;
  full_text: string;
}

export interface RelationshipDetails {
  source: string;
  target: string;
  type: 'RELATED_TO';
  reason: string;
  source_documents: RelationshipDocument[];
  target_documents: RelationshipDocument[];
  shared_document_ids: string[];
}
