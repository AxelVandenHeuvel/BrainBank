export interface ChatDocumentCitation {
  docId: string;
  name: string;
}

export interface ChatChunkCitation {
  chunkId: string;
  docId: string;
  docName: string;
  text: string;
}

export interface ChatRelationshipCitation {
  source: string;
  target: string;
  type: string;
  reason?: string | null;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sourceConcepts?: string[];
  discoveryConcepts?: string[];
  sourceDocuments?: ChatDocumentCitation[];
  discoveryDocuments?: ChatDocumentCitation[];
  sourceChunks?: ChatChunkCitation[];
  discoveryChunks?: ChatChunkCitation[];
  supportingRelationships?: ChatRelationshipCitation[];
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}
