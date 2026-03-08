import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { RelationshipDocument } from '../types/graph';
import { ConceptDocumentOverlay } from './ConceptDocumentOverlay';

const documents: RelationshipDocument[] = [
  {
    doc_id: 'doc-1',
    name: 'Math Notes',
    full_text: '# Math Notes\n\nChain rule explanation.',
  },
  {
    doc_id: 'doc-2',
    name: 'Derivative Rules',
    full_text: '# Derivative Rules\n\n- Product rule\n- Quotient rule',
  },
];

describe('ConceptDocumentOverlay', () => {
  it('shows a loading state while related documents are being fetched', () => {
    render(
      <ConceptDocumentOverlay
        conceptName="Calculus"
        documents={null}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Loading documents...')).toBeInTheDocument();
  });

  it('opens a document in the markdown viewer when its title is clicked', async () => {
    const user = userEvent.setup();

    render(
      <ConceptDocumentOverlay
        conceptName="Calculus"
        documents={documents}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByText('Select a document to read its markdown.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Math Notes' }));

    expect(
      screen.getByRole('heading', { name: 'Math Notes', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Chain rule explanation.')).toBeInTheDocument();
  });

  it('lets the user switch between related documents in the same overlay', async () => {
    const user = userEvent.setup();

    render(
      <ConceptDocumentOverlay
        conceptName="Calculus"
        documents={documents}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Math Notes' }));
    expect(screen.getByText('Chain rule explanation.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Derivative Rules' }));

    expect(
      screen.getByRole('heading', { name: 'Derivative Rules', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Product rule')).toBeInTheDocument();
    expect(screen.getByText('Quotient rule')).toBeInTheDocument();
  });

  it('closes the overlay from the back button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <ConceptDocumentOverlay
        conceptName="Calculus"
        documents={documents}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole('button', { name: /back to graph/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
