import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { OpenTab } from '../types/notes';

// Mock Milkdown Crepe (same pattern)
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

    constructor(opts: { root: HTMLElement; defaultValue?: string }) {
      this.root = opts.root;
    }

    on(
      cb: (listener: {
        markdownUpdated: (fn: (ctx: unknown, md: string) => void) => void;
      }) => void,
    ) {
      cb({ markdownUpdated: () => {} });
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
      return '';
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

import { EditorArea } from './EditorArea';

const noop = () => {};

const makeTabs = (overrides: Partial<OpenTab>[] = []): OpenTab[] =>
  overrides.map((o, i) => ({
    id: `tab-${i}`,
    title: `Tab ${i}`,
    content: `Content ${i}`,
    isNew: false,
    ...o,
  }));

describe('EditorArea', () => {
  it('returns null when no active tab', () => {
    const { container } = render(
      <EditorArea
        tabs={[]}
        activeTabId={null}
        onSelectTab={noop}
        onCloseTab={noop}
        onTabTitleChange={noop}
        onSaved={noop}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders TabBar and editor when active tab exists', async () => {
    const tabs = makeTabs([{ id: 'a', title: 'Physics', content: '# Physics' }]);
    render(
      <EditorArea
        tabs={tabs}
        activeTabId="a"
        onSelectTab={noop}
        onCloseTab={noop}
        onTabTitleChange={noop}
        onSaved={noop}
      />,
    );

    // TabBar should render the tab
    expect(screen.getByText('Physics')).toBeInTheDocument();
    // Editor should render the title input
    expect(screen.getByDisplayValue('Physics')).toBeInTheDocument();
    // Editor container should mount
    await waitFor(() => {
      expect(screen.getByTestId('milkdown-mock')).toBeInTheDocument();
    });
  });

  it('switching active tab remounts editor with new content', async () => {
    const tabs = makeTabs([
      { id: 'a', title: 'Note A', content: 'Content A' },
      { id: 'b', title: 'Note B', content: 'Content B' },
    ]);

    const { rerender } = render(
      <EditorArea
        tabs={tabs}
        activeTabId="a"
        onSelectTab={noop}
        onCloseTab={noop}
        onTabTitleChange={noop}
        onSaved={noop}
      />,
    );

    // First tab's title should be visible
    expect(screen.getByDisplayValue('Note A')).toBeInTheDocument();

    // Switch to tab b
    rerender(
      <EditorArea
        tabs={tabs}
        activeTabId="b"
        onSelectTab={noop}
        onCloseTab={noop}
        onTabTitleChange={noop}
        onSaved={noop}
      />,
    );

    // Second tab's title should now be visible
    expect(screen.getByDisplayValue('Note B')).toBeInTheDocument();
  });
});
