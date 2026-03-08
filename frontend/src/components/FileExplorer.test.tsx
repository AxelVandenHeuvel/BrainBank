import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FileExplorer } from './FileExplorer';

// Mock the useFileTree hook
vi.mock('../hooks/useFileTree', () => ({
  useFileTree: vi.fn(),
}));

import { useFileTree } from '../hooks/useFileTree';

const mockUseFileTree = vi.mocked(useFileTree);

const MOCK_TREE = [
  {
    name: 'Algebra',
    documents: [{ docId: 'doc-3', name: 'Linear Equations' }],
  },
  {
    name: 'Calculus',
    documents: [
      { docId: 'doc-1', name: 'Derivatives Notes' },
      { docId: 'doc-2', name: 'Mechanics Overview' },
    ],
  },
  {
    name: 'Physics',
    documents: [{ docId: 'doc-2', name: 'Mechanics Overview' }],
  },
];

describe('FileExplorer', () => {
  it('renders concept folders', () => {
    render(
      <FileExplorer
        tree={MOCK_TREE}
        isLoading={false}
        highlightedConcept={null}
        onOpenDocument={vi.fn()}
      />,
    );

    expect(screen.getByTestId('file-explorer-scroll-shell')).toBeInTheDocument();
    expect(screen.getByTestId('file-explorer-scroll-container')).toBeInTheDocument();
    expect(screen.getByTestId('file-explorer-scroll-rail')).toBeInTheDocument();
    expect(screen.getByTestId('file-explorer-scroll-thumb')).toBeInTheDocument();
    expect(screen.getByTestId('file-explorer-tree')).toHaveClass('sidebar-files-content');
    expect(screen.getByText('Algebra')).toBeInTheDocument();
    expect(screen.getByText('Calculus')).toBeInTheDocument();
    expect(screen.getByText('Physics')).toBeInTheDocument();
  });

  it('clicking a folder expands it showing documents', async () => {
    const user = userEvent.setup();

    render(
      <FileExplorer
        tree={MOCK_TREE}
        isLoading={false}
        highlightedConcept={null}
        onOpenDocument={vi.fn()}
      />,
    );

    // Documents should not be visible initially
    expect(screen.queryByText('Derivatives Notes')).not.toBeInTheDocument();

    // Click the Calculus folder
    await user.click(screen.getByText('Calculus'));

    // Now documents should be visible
    expect(screen.getByText('Derivatives Notes')).toBeInTheDocument();
    expect(screen.getByText('Mechanics Overview')).toBeInTheDocument();
  });

  it('clicking an expanded folder collapses it', async () => {
    const user = userEvent.setup();

    render(
      <FileExplorer
        tree={MOCK_TREE}
        isLoading={false}
        highlightedConcept={null}
        onOpenDocument={vi.fn()}
      />,
    );

    // Expand
    await user.click(screen.getByText('Calculus'));
    expect(screen.getByText('Derivatives Notes')).toBeInTheDocument();

    // Collapse
    await user.click(screen.getByText('Calculus'));
    expect(screen.queryByText('Derivatives Notes')).not.toBeInTheDocument();
  });

  it('clicking a document calls onOpenDocument with correct args', async () => {
    const user = userEvent.setup();
    const onOpenDocument = vi.fn();

    render(
      <FileExplorer
        tree={MOCK_TREE}
        isLoading={false}
        highlightedConcept={null}
        onOpenDocument={onOpenDocument}
      />,
    );

    // Expand Calculus folder
    await user.click(screen.getByText('Calculus'));

    // Click a document
    await user.click(screen.getByText('Derivatives Notes'));

    expect(onOpenDocument).toHaveBeenCalledWith('doc-1', 'Derivatives Notes', 'Calculus');
  });

  it('highlightedConcept auto-expands that folder', async () => {
    render(
      <FileExplorer
        tree={MOCK_TREE}
        isLoading={false}
        highlightedConcept="Physics"
        onOpenDocument={vi.fn()}
      />,
    );

    // Physics folder should be auto-expanded
    await waitFor(() => {
      expect(screen.getByText('Mechanics Overview')).toBeInTheDocument();
    });
  });

  it('changing highlightedConcept expands the new folder', async () => {
    const { rerender } = render(
      <FileExplorer
        tree={MOCK_TREE}
        isLoading={false}
        highlightedConcept="Physics"
        onOpenDocument={vi.fn()}
      />,
    );

    // Physics should be expanded
    await waitFor(() => {
      expect(screen.getByText('Mechanics Overview')).toBeInTheDocument();
    });

    // Change to Algebra
    rerender(
      <FileExplorer
        tree={MOCK_TREE}
        isLoading={false}
        highlightedConcept="Algebra"
        onOpenDocument={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Linear Equations')).toBeInTheDocument();
    });
  });

  it('shows loading state', () => {
    render(
      <FileExplorer
        tree={[]}
        isLoading={true}
        highlightedConcept={null}
        onOpenDocument={vi.fn()}
      />,
    );

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows empty state when tree is empty', () => {
    render(
      <FileExplorer
        tree={[]}
        isLoading={false}
        highlightedConcept={null}
        onOpenDocument={vi.fn()}
      />,
    );

    expect(screen.getByText(/no concepts yet/i)).toBeInTheDocument();
  });

  it('filters based on searchQuery and auto-expands matches', () => {
    render(
      <FileExplorer
        tree={MOCK_TREE}
        isLoading={false}
        highlightedConcept={null}
        onOpenDocument={vi.fn()}
        searchQuery="Deriv"
      />,
    );

    // Should show the matching document parent folder
    expect(screen.getByText('Calculus')).toBeInTheDocument();
    // Should be auto-expanded and show the matching document
    expect(screen.getByText('Deriv')).toBeInTheDocument(); // It will show 'Deriv' as part of 'Derivatives Notes'
    expect(screen.getByText('atives Notes')).toBeInTheDocument(); // Highlighting splits text

    // Should NOT show Algebra as it doesn't match and doesn't contain matching docs
    expect(screen.queryByText('Algebra')).not.toBeInTheDocument();
  });
});
