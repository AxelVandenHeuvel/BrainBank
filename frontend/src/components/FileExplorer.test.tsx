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
    documents: [{ docId: 'doc-3', name: 'Linear Equations' }], // Managed by default
  },
  {
    name: 'Calculus',
    documents: [
      { docId: 'doc-1', name: 'Derivatives Notes', isManaged: true },
      { docId: 'doc-2', name: 'Mechanics Overview', isManaged: false }, // EXTERNAL FILE
    ],
  },
  {
    name: 'Physics',
    documents: [{ docId: 'doc-2', name: 'Mechanics Overview', isManaged: false }],
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
    expect(screen.getByText('Algebra')).toBeInTheDocument();
    expect(screen.getByText('Calculus')).toBeInTheDocument();
  });

  it('clicking a managed document calls onOpenDocument', async () => {
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

    await user.click(screen.getByText('Calculus'));
    await user.click(screen.getByText('Derivatives Notes'));

    expect(onOpenDocument).toHaveBeenCalledWith('doc-1', 'Derivatives Notes', 'Calculus');
  });

  it('prevents opening unmanaged (external) documents', async () => {
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

    await user.click(screen.getByText('Calculus'));
    
    const unmanagedDoc = screen.getByText('Mechanics Overview');
    await user.click(unmanagedDoc);

    // Should NOT have been called because the button is disabled
    expect(onOpenDocument).not.toHaveBeenCalled();
  });

  it('displays the Adopt button for unmanaged documents and triggers onAdoptDocument', async () => {
    const user = userEvent.setup();
    const onAdoptDocument = vi.fn();

    render(
      <FileExplorer
        tree={MOCK_TREE}
        isLoading={false}
        highlightedConcept={null}
        onOpenDocument={vi.fn()}
        onAdoptDocument={onAdoptDocument}
      />,
    );

    await user.click(screen.getByText('Calculus'));
    
    // The warning icon SVG has a title of "Unindexed File"
    expect(screen.getAllByTitle('Unindexed File')[0]).toBeInTheDocument();

    const adoptButtons = screen.getAllByText('Adopt');
    expect(adoptButtons.length).toBeGreaterThan(0);

    await user.click(adoptButtons[0]);
    expect(onAdoptDocument).toHaveBeenCalledWith('doc-2');
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

    await waitFor(() => {
      expect(screen.getByText('Mechanics Overview')).toBeInTheDocument();
    });
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

    expect(screen.getByText('Calculus')).toBeInTheDocument();
    expect(screen.getByText('Deriv')).toBeInTheDocument(); 
    expect(screen.getByText('atives Notes')).toBeInTheDocument(); 
    expect(screen.queryByText('Algebra')).not.toBeInTheDocument();
  });
});