import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Milkdown Crepe (same pattern as NoteEditor.test.tsx)
let mockMarkdown = '';
let mockOnChange: ((md: string) => void) | null = null;

vi.mock('@milkdown/crepe', () => {
  class Crepe {
    static Feature = {
      Toolbar: 'toolbar',
      Latex: 'latex',
      Placeholder: 'placeholder',
      BlockEdit: 'blockEdit',
      ImageBlock: 'imageBlock',
      Cursor: 'cursor',
    };
    root: HTMLElement | null = null;
    defaultVal: string;

    constructor(opts: { root: HTMLElement; defaultValue?: string }) {
      this.root = opts.root;
      this.defaultVal = opts.defaultValue ?? '';
    }

    on(
      cb: (listener: {
        markdownUpdated: (fn: (ctx: unknown, md: string) => void) => void;
      }) => void,
    ) {
      cb({
        markdownUpdated: (fn: (ctx: unknown, md: string) => void) => {
          mockOnChange = (md: string) => fn(null, md);
        },
      });
      return this;
    }

    async create() {
      if (!this.root) return this;
      const div = document.createElement('div');
      div.dataset.testid = 'milkdown-mock';
      this.root.appendChild(div);
      return this;
    }

    getMarkdown() {
      return mockMarkdown;
    }

    get editor() {
      return { action: () => {}, use: () => ({ use: () => this.editor }) };
    }

    destroy() {
      return Promise.resolve();
    }
  }
  return { Crepe };
});

vi.mock('@milkdown/kit/core', () => ({ editorViewCtx: Symbol('editorViewCtx') }));
vi.mock('@milkdown/kit/utils', () => ({ $prose: (fn: unknown) => fn }));
vi.mock('@milkdown/kit/prose/state', () => ({ Plugin: class {} }));
vi.mock('@milkdown/kit/prose/view', () => ({
  Decoration: {},
  DecorationSet: { empty: {}, create: () => ({}) },
}));
vi.mock('@milkdown/crepe/theme/common/style.css', () => ({}));
vi.mock('@milkdown/crepe/theme/frame-dark.css', () => ({}));

import { DocumentEditor } from './DocumentEditor';

beforeEach(() => {
  mockMarkdown = '';
  mockOnChange = null;
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ doc_id: 'doc-1', chunks: 1, concepts: [] }),
  } as Response);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('DocumentEditor', () => {
  it('renders title field with initial title', () => {
    render(
      <DocumentEditor
        docId="doc-1"
        initialTitle="My Note"
        initialContent=""
        isNew={false}
      />,
    );
    expect(screen.getByDisplayValue('My Note')).toBeInTheDocument();
  });

  it('renders editor container', async () => {
    render(
      <DocumentEditor
        docId="doc-1"
        initialTitle="Test"
        initialContent=""
        isNew={false}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('milkdown-mock')).toBeInTheDocument();
    });
  });

  it('shows save status indicator', () => {
    render(
      <DocumentEditor
        docId="doc-1"
        initialTitle="Test"
        initialContent=""
        isNew={false}
      />,
    );
    expect(screen.getByTestId('save-status')).toBeInTheDocument();
  });

  it('renders a manual save button', () => {
    render(
      <DocumentEditor
        docId="doc-1"
        initialTitle="Test"
        initialContent=""
        isNew={false}
      />,
    );

    expect(screen.getByRole('button', { name: 'Save note' })).toBeInTheDocument();
  });

  it('title changes call onTitleChange', async () => {
    const user = userEvent.setup();
    const onTitleChange = vi.fn();
    render(
      <DocumentEditor
        docId="doc-1"
        initialTitle="Old"
        initialContent=""
        isNew={false}
        onTitleChange={onTitleChange}
      />,
    );
    const titleInput = screen.getByDisplayValue('Old');
    await user.clear(titleInput);
    await user.type(titleInput, 'New Title');
    expect(onTitleChange).toHaveBeenCalledWith('doc-1', 'New Title');
  });

  it('auto-save triggers after debounce for new docs (POST /api/documents)', async () => {
    vi.useFakeTimers();

    render(
      <DocumentEditor
        docId="new-1"
        initialTitle="Draft"
        initialContent=""
        isNew={true}
      />,
    );

    // Wait for Crepe to mount by flushing microtasks
    await act(async () => {
      await Promise.resolve();
    });

    // Simulate content change via the mock callback
    act(() => {
      mockMarkdown = 'Hello world';
      mockOnChange?.('Hello world');
    });

    // Advance past the 1.5s debounce
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });

    expect(fetch).toHaveBeenCalledWith('/api/documents', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('manual save persists a title-only new note through the lightweight document endpoint', async () => {
    const user = userEvent.setup();

    render(
      <DocumentEditor
        docId="new-1"
        initialTitle="Untitled"
        initialContent=""
        isNew={true}
      />,
    );

    const titleInput = screen.getByDisplayValue('Untitled');
    await user.clear(titleInput);
    await user.type(titleInput, 'Short draft');
    await user.click(screen.getByRole('button', { name: 'Save note' }));

    expect(fetch).toHaveBeenCalledWith(
      '/api/documents',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ title: 'Short draft', text: '' }),
      }),
    );
  });

  it('auto-save triggers after debounce for existing docs (PUT /api/documents/{docId})', async () => {
    vi.useFakeTimers();

    render(
      <DocumentEditor
        docId="existing-1"
        initialTitle="Existing"
        initialContent=""
        isNew={false}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      mockMarkdown = 'Updated content';
      mockOnChange?.('Updated content');
    });

    await act(async () => {
      vi.advanceTimersByTime(1600);
    });

    expect(fetch).toHaveBeenCalledWith(
      '/api/documents/existing-1',
      expect.objectContaining({ method: 'PUT' }),
    );
  });
});
