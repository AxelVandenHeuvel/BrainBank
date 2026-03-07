import { useState } from 'react';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  discoveryConcepts?: string[];
}

interface QueryResponse {
  answer?: string;
  discovery_concepts?: string[];
}

interface UseChatResult {
  messages: ChatMessage[];
  isLoading: boolean;
  sendMessage: (question: string) => Promise<void>;
}

const QUERY_ENDPOINT = 'http://localhost:8000/query';
const FALLBACK_ERROR_MESSAGE = 'I could not reach BrainBank right now.';

export function useChat(): UseChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  async function sendMessage(question: string) {
    const trimmedQuestion = question.trim();

    if (!trimmedQuestion) {
      return;
    }

    setMessages((previousMessages) => [
      ...previousMessages,
      { role: 'user', content: trimmedQuestion },
    ]);
    setIsLoading(true);

    try {
      const response = await fetch(QUERY_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmedQuestion }),
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const data = (await response.json()) as QueryResponse;
      setMessages((previousMessages) => [
        ...previousMessages,
        {
          role: 'assistant',
          content: data.answer ?? '',
          discoveryConcepts: data.discovery_concepts ?? [],
        },
      ]);
    } catch {
      setMessages((previousMessages) => [
        ...previousMessages,
        {
          role: 'assistant',
          content: FALLBACK_ERROR_MESSAGE,
          discoveryConcepts: [],
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  return { messages, isLoading, sendMessage };
}
