import { renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useFileTree } from './useFileTree';

const MOCK_CONCEPTS_RESPONSE = {
  concepts: [
    { name: 'Calculus', document_count: 2, related_concepts: ['Physics'] },
    { name: 'Physics', document_count: 1, related_concepts: ['Calculus'] },
    { name: 'Algebra', document_count: 1, related_concepts: [] },
  ],
};

const MOCK_DOCUMENTS_RESPONSE = {
  documents: [
    { doc_id: 'doc-1', name: 'Derivatives Notes', chunk_count: 3, concepts: ['Calculus'] },
    { doc_id: 'doc-2', name: 'Mechanics Overview', chunk_count: 5, concepts: ['Physics', 'Calculus'] },
    { doc_id: 'doc-3', name: 'Linear Equations', chunk_count: 2, concepts: ['Algebra'] },
  ],
};

function mockFetchSuccess() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      if (url === '/api/concepts') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(MOCK_CONCEPTS_RESPONSE),
        });
      }
      if (url === '/api/documents') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(MOCK_DOCUMENTS_RESPONSE),
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    }),
  );
}

describe('useFileTree', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns loading state initially', () => {
    mockFetchSuccess();
    const { result } = renderHook(() => useFileTree());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.tree).toEqual([]);
  });

  it('builds correct tree from API responses', async () => {
    mockFetchSuccess();
    const { result } = renderHook(() => useFileTree());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Should have 3 concepts sorted alphabetically
    expect(result.current.tree).toHaveLength(3);
    expect(result.current.tree[0].name).toBe('Algebra');
    expect(result.current.tree[1].name).toBe('Calculus');
    expect(result.current.tree[2].name).toBe('Physics');
  });

  it('groups documents under correct concepts', async () => {
    mockFetchSuccess();
    const { result } = renderHook(() => useFileTree());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Algebra has 1 document
    const algebra = result.current.tree.find((c) => c.name === 'Algebra');
    expect(algebra?.documents).toEqual([{ docId: 'doc-3', name: 'Linear Equations' }]);

    // Calculus has 2 documents (doc-1 and doc-2)
    const calculus = result.current.tree.find((c) => c.name === 'Calculus');
    expect(calculus?.documents).toHaveLength(2);
    expect(calculus?.documents.map((d) => d.docId).sort()).toEqual(['doc-1', 'doc-2']);

    // Physics has 1 document (doc-2)
    const physics = result.current.tree.find((c) => c.name === 'Physics');
    expect(physics?.documents).toHaveLength(1);
    expect(physics?.documents[0].docId).toBe('doc-2');
  });

  it('a document can appear under multiple concepts', async () => {
    mockFetchSuccess();
    const { result } = renderHook(() => useFileTree());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // doc-2 "Mechanics Overview" has concepts: ['Physics', 'Calculus']
    const calculus = result.current.tree.find((c) => c.name === 'Calculus');
    const physics = result.current.tree.find((c) => c.name === 'Physics');

    const calcDocs = calculus?.documents.map((d) => d.docId) ?? [];
    const physDocs = physics?.documents.map((d) => d.docId) ?? [];

    expect(calcDocs).toContain('doc-2');
    expect(physDocs).toContain('doc-2');
  });

  it('groups documents without concepts under a Notes section', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url === '/api/concepts') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(MOCK_CONCEPTS_RESPONSE),
          });
        }
        if (url === '/api/documents') {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                documents: [
                  ...MOCK_DOCUMENTS_RESPONSE.documents,
                  { doc_id: 'doc-draft', name: 'Short draft', chunk_count: 1, concepts: [] },
                ],
              }),
          });
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      }),
    );

    const { result } = renderHook(() => useFileTree());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const notes = result.current.tree.find((concept) => concept.name === 'Notes');

    expect(notes).toBeDefined();
    expect(notes?.documents).toEqual([{ docId: 'doc-draft', name: 'Short draft' }]);
  });

  it('handles API failure gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const { result } = renderHook(() => useFileTree());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.tree).toEqual([]);
  });

  it('handles partial API failure gracefully', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url === '/api/concepts') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(MOCK_CONCEPTS_RESPONSE),
          });
        }
        // documents endpoint fails
        return Promise.reject(new Error('Server error'));
      }),
    );

    const { result } = renderHook(() => useFileTree());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Should still return empty tree on any failure
    expect(result.current.tree).toEqual([]);
  });

  it('refetch reloads data', async () => {
    mockFetchSuccess();
    const { result } = renderHook(() => useFileTree());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.tree).toHaveLength(3);

    // Stub fetch to return different data on refetch
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url === '/api/concepts') {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                concepts: [{ name: 'NewConcept', document_count: 1, related_concepts: [] }],
              }),
          });
        }
        if (url === '/api/documents') {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                documents: [{ doc_id: 'doc-new', name: 'New Doc', chunk_count: 1, concepts: ['NewConcept'] }],
              }),
          });
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      }),
    );

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.tree).toHaveLength(1);
      expect(result.current.tree[0].name).toBe('NewConcept');
    });
  });
});
