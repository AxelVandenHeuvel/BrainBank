export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sourceConcepts?: string[];
  discoveryConcepts?: string[];
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}
