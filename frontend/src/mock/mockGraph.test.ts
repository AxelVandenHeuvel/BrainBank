import { describe, expect, it } from 'vitest';

import { getMockDocumentsForConcept, mockGraphApiResponse } from './mockGraph';

describe('mockGraph', () => {
  it('has a focused set of student concepts across math, physics, philosophy, and personal', () => {
    const names = new Set(mockGraphApiResponse.nodes.map((n) => n.name));

    expect(names.has('Calculus')).toBe(true);
    expect(names.has("Newton's Laws")).toBe(true);
    expect(names.has('Epistemology')).toBe(true);
    expect(names.has('Motivation')).toBe(true);
    expect(names.has('Linear Algebra')).toBe(true);
    expect(names.has('Probability')).toBe(true);

    // Should be a focused set, not 100+ generated nodes
    expect(mockGraphApiResponse.nodes.length).toBeGreaterThanOrEqual(25);
    expect(mockGraphApiResponse.nodes.length).toBeLessThan(40);
  });

  it('has cross-domain edges connecting different subjects', () => {
    expect(mockGraphApiResponse.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'concept:Calculus', target: 'concept:Classical Mechanics' }),
        expect.objectContaining({ source: 'concept:Entropy', target: 'concept:Determinism' }),
        expect.objectContaining({ source: 'concept:Existentialism', target: 'concept:Motivation' }),
        expect.objectContaining({ source: 'concept:Epistemology', target: 'concept:Probability' }),
      ]),
    );
  });

  it('returns hand-written documents for curated concepts', () => {
    const docs = getMockDocumentsForConcept('Calculus');
    expect(docs.length).toBeGreaterThan(0);
    expect(docs[0].full_text).toContain('Professor Lin');

    const physicsDocs = getMockDocumentsForConcept('Classical Mechanics');
    expect(physicsDocs[0].full_text).toContain("Newton's Laws");
  });
});
