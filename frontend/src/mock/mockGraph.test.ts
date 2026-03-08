import { describe, expect, it } from 'vitest';

import { getMockDocumentsForConcept, mockGraphApiResponse } from './mockGraph';

describe('mockGraph', () => {
  it('covers roughly one hundred nodes across many different subject areas', () => {
    const conceptNames = new Set(mockGraphApiResponse.nodes.map((node) => node.name));
    const representativeConcepts = [
      'Calculus',
      'Newton\'s Laws',
      'Epistemology',
      'Motivation',
      'Machine Learning',
      'Biology',
      'Economics',
      'Psychology',
      'Product Design',
      'History',
      'Arts',
      'Data Science',
    ];

    expect(mockGraphApiResponse.nodes.length).toBeGreaterThanOrEqual(95);
    representativeConcepts.forEach((conceptName) => {
      expect(conceptNames.has(conceptName)).toBe(true);
    });
  });

  it('includes cross-domain bridges instead of only isolated subject clusters', () => {
    expect(mockGraphApiResponse.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'concept:Machine Learning',
          target: 'concept:Statistics',
        }),
        expect.objectContaining({
          source: 'concept:Behavioral Economics',
          target: 'concept:Cognitive Biases',
        }),
        expect.objectContaining({
          source: 'concept:Ethics',
          target: 'concept:Accessibility',
        }),
        expect.objectContaining({
          source: 'concept:Differential Equations',
          target: 'concept:Control Theory',
        }),
      ]),
    );
  });

  it('returns domain-specific mock documents for generated concepts', () => {
    const documents = getMockDocumentsForConcept('Machine Learning');

    expect(documents[0]).toEqual(
      expect.objectContaining({
        name: expect.stringContaining('Machine Learning'),
        full_text: expect.stringContaining('Computer Science'),
      }),
    );
    expect(documents[0]?.full_text).toContain('Statistics');
  });
});
