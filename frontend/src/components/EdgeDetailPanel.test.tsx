import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { RelationshipDetails } from '../types/graph';
import { EdgeDetailPanel } from './EdgeDetailPanel';

const relationship: RelationshipDetails = {
  source: 'Calculus',
  target: 'Derivatives',
  type: 'RELATED_TO',
  reason: 'Derivatives are a core tool within calculus',
  source_documents: [
    { doc_id: 'shared-1', name: 'Math Notes', full_text: 'Shared evidence.' },
    { doc_id: 'source-1', name: 'Calculus Handbook', full_text: 'Source-only evidence.' },
  ],
  target_documents: [
    { doc_id: 'shared-1', name: 'Math Notes', full_text: 'Shared evidence.' },
    { doc_id: 'target-1', name: 'Derivative Rules', full_text: 'Target-only evidence.' },
  ],
  shared_document_ids: ['shared-1'],
};

describe('EdgeDetailPanel', () => {
  it('renders shared and side-specific document sections', () => {
    render(
      <EdgeDetailPanel
        relationship={relationship}
        isLoading={false}
        error={null}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Calculus to Derivatives')).toBeInTheDocument();
    expect(screen.getByText('RELATED_TO')).toBeInTheDocument();
    expect(screen.getByText('Derivatives are a core tool within calculus')).toBeInTheDocument();
    expect(screen.getByText('Shared documents')).toBeInTheDocument();
    expect(screen.getByText('Source-only documents')).toBeInTheDocument();
    expect(screen.getByText('Target-only documents')).toBeInTheDocument();
    expect(screen.getAllByText('Math Notes')).toHaveLength(1);
  });

  it('renders a loading state', () => {
    render(
      <EdgeDetailPanel
        relationship={null}
        isLoading
        error={null}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Loading relationship details...')).toBeInTheDocument();
  });

  it('renders an error state and supports closing', () => {
    const onClose = vi.fn();

    render(
      <EdgeDetailPanel
        relationship={null}
        isLoading={false}
        error="Request failed"
        onClose={onClose}
      />,
    );

    expect(screen.getByText('Request failed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close relationship details' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the relationship summary visible while showing an error', () => {
    render(
      <EdgeDetailPanel
        relationship={relationship}
        isLoading={false}
        error="Request failed"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Calculus to Derivatives')).toBeInTheDocument();
    expect(screen.getByText('Derivatives are a core tool within calculus')).toBeInTheDocument();
    expect(screen.getByText('Request failed')).toBeInTheDocument();
  });
});
