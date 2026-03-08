import type { GraphApiResponse, RelationshipDetails } from '../types/graph';

export const mockGraphApiResponse: GraphApiResponse = {
  nodes: [
    // ── Calculus ──
    { id: 'concept:Calculus', type: 'Concept', name: 'Calculus' },
    { id: 'concept:Limits', type: 'Concept', name: 'Limits' },
    { id: 'concept:Derivatives', type: 'Concept', name: 'Derivatives' },
    { id: 'concept:Integrals', type: 'Concept', name: 'Integrals' },
    { id: 'concept:Chain Rule', type: 'Concept', name: 'Chain Rule' },
    { id: 'concept:Fundamental Theorem of Calculus', type: 'Concept', name: 'Fundamental Theorem of Calculus' },

    // ── Physics ──
    { id: 'concept:Classical Mechanics', type: 'Concept', name: 'Classical Mechanics' },
    { id: 'concept:Newton\'s Laws', type: 'Concept', name: 'Newton\'s Laws' },
    { id: 'concept:Conservation of Energy', type: 'Concept', name: 'Conservation of Energy' },
    { id: 'concept:Electromagnetism', type: 'Concept', name: 'Electromagnetism' },
    { id: 'concept:Maxwell\'s Equations', type: 'Concept', name: 'Maxwell\'s Equations' },
    { id: 'concept:Thermodynamics', type: 'Concept', name: 'Thermodynamics' },
    { id: 'concept:Entropy', type: 'Concept', name: 'Entropy' },

    // ── Philosophy ──
    { id: 'concept:Epistemology', type: 'Concept', name: 'Epistemology' },
    { id: 'concept:Rationalism', type: 'Concept', name: 'Rationalism' },
    { id: 'concept:Empiricism', type: 'Concept', name: 'Empiricism' },
    { id: 'concept:Ethics', type: 'Concept', name: 'Ethics' },
    { id: 'concept:Utilitarianism', type: 'Concept', name: 'Utilitarianism' },
    { id: 'concept:Existentialism', type: 'Concept', name: 'Existentialism' },
    { id: 'concept:Free Will', type: 'Concept', name: 'Free Will' },

    // ── Personal / Journal ──
    { id: 'concept:Study Habits', type: 'Concept', name: 'Study Habits' },
    { id: 'concept:Time Management', type: 'Concept', name: 'Time Management' },
    { id: 'concept:Motivation', type: 'Concept', name: 'Motivation' },
    { id: 'concept:Career Goals', type: 'Concept', name: 'Career Goals' },

    // ── Cross-domain bridges ──
    { id: 'concept:Differential Equations', type: 'Concept', name: 'Differential Equations' },
    { id: 'concept:Determinism', type: 'Concept', name: 'Determinism' },
  ],
  edges: [
    // ── Calculus cluster ──
    { source: 'concept:Calculus', target: 'concept:Limits', type: 'RELATED_TO' },
    { source: 'concept:Calculus', target: 'concept:Derivatives', type: 'RELATED_TO' },
    { source: 'concept:Calculus', target: 'concept:Integrals', type: 'RELATED_TO' },
    { source: 'concept:Derivatives', target: 'concept:Chain Rule', type: 'RELATED_TO' },
    { source: 'concept:Integrals', target: 'concept:Fundamental Theorem of Calculus', type: 'RELATED_TO' },
    { source: 'concept:Derivatives', target: 'concept:Fundamental Theorem of Calculus', type: 'RELATED_TO' },
    { source: 'concept:Limits', target: 'concept:Derivatives', type: 'RELATED_TO' },

    // ── Physics cluster ──
    { source: 'concept:Classical Mechanics', target: 'concept:Newton\'s Laws', type: 'RELATED_TO' },
    { source: 'concept:Classical Mechanics', target: 'concept:Conservation of Energy', type: 'RELATED_TO' },
    { source: 'concept:Electromagnetism', target: 'concept:Maxwell\'s Equations', type: 'RELATED_TO' },
    { source: 'concept:Thermodynamics', target: 'concept:Entropy', type: 'RELATED_TO' },
    { source: 'concept:Thermodynamics', target: 'concept:Conservation of Energy', type: 'RELATED_TO' },

    // ── Philosophy cluster ──
    { source: 'concept:Epistemology', target: 'concept:Rationalism', type: 'RELATED_TO' },
    { source: 'concept:Epistemology', target: 'concept:Empiricism', type: 'RELATED_TO' },
    { source: 'concept:Ethics', target: 'concept:Utilitarianism', type: 'RELATED_TO' },
    { source: 'concept:Existentialism', target: 'concept:Free Will', type: 'RELATED_TO' },
    { source: 'concept:Rationalism', target: 'concept:Empiricism', type: 'RELATED_TO' },

    // ── Personal cluster ──
    { source: 'concept:Study Habits', target: 'concept:Time Management', type: 'RELATED_TO' },
    { source: 'concept:Motivation', target: 'concept:Study Habits', type: 'RELATED_TO' },
    { source: 'concept:Career Goals', target: 'concept:Motivation', type: 'RELATED_TO' },

    // ── Cross-domain bridges ──
    { source: 'concept:Calculus', target: 'concept:Classical Mechanics', type: 'RELATED_TO' },
    { source: 'concept:Differential Equations', target: 'concept:Calculus', type: 'RELATED_TO' },
    { source: 'concept:Differential Equations', target: 'concept:Classical Mechanics', type: 'RELATED_TO' },
    { source: 'concept:Derivatives', target: 'concept:Newton\'s Laws', type: 'RELATED_TO' },
    { source: 'concept:Entropy', target: 'concept:Determinism', type: 'RELATED_TO' },
    { source: 'concept:Free Will', target: 'concept:Determinism', type: 'RELATED_TO' },
    { source: 'concept:Determinism', target: 'concept:Classical Mechanics', type: 'RELATED_TO' },
    { source: 'concept:Existentialism', target: 'concept:Motivation', type: 'RELATED_TO' },
    { source: 'concept:Ethics', target: 'concept:Career Goals', type: 'RELATED_TO' },
  ],
};

interface MockDocument {
  doc_id: string;
  name: string;
  full_text: string;
}

const MOCK_CONCEPT_DOCUMENTS: Record<string, MockDocument[]> = {
  // ── Calculus ──
  Calculus: [
    {
      doc_id: 'calc-limits',
      name: 'Limits and Continuity Review',
      full_text:
        '# Limits and Continuity Review\n\nProfessor Lin kept repeating that Calculus starts with Limits because they tell us what a function is trying to do near a point, even if the function is undefined there.\n\n## Key ideas\n- For a two-sided limit to exist, the left-hand and right-hand limits have to agree.\n- Continuity at x = a means f(a) exists, the limit as x → a exists, and both values match.\n- The epsilon-delta definition is the formal language behind the intuitive graphs we draw.\n\n## Worked example\nFor f(x) = (x² - 1)/(x - 1), the graph has a hole at x = 1 but the limit still exists. Factoring gives x + 1, so the limits from both sides go to 2.',
    },
  ],
  Limits: [
    {
      doc_id: 'calc-limits',
      name: 'Limits and Continuity Review',
      full_text:
        '# Limits and Continuity Review\n\nProfessor Lin kept repeating that Calculus starts with Limits because they tell us what a function is trying to do near a point, even if the function is undefined there.\n\n## Key ideas\n- For a two-sided limit to exist, the left-hand and right-hand limits have to agree.\n- Continuity at x = a means f(a) exists, the limit as x → a exists, and both values match.\n- The epsilon-delta definition is the formal language behind the intuitive graphs we draw.',
    },
  ],
  Derivatives: [
    {
      doc_id: 'calc-derivatives',
      name: 'Derivative Rules Study Guide',
      full_text:
        '# Derivative Rules Study Guide\n\nDerivatives measure instantaneous change. The slope of the tangent line is just the derivative evaluated at that point.\n\n## Rules I need memorized\n- Power rule: d/dx of x^n = n·x^(n-1)\n- Product Rule: differentiate the first, leave the second, then add first times derivative of the second\n- Chain Rule: derivative of the outer function times derivative of the inner function\n\n## Example that tripped me up\nFor y = (3x² + 1)(x³ - 4), I forgot the Product Rule on the practice quiz and lost four points. If the function is composite, like sin(x² + 1), I also need the Chain Rule.',
    },
  ],
  Integrals: [
    {
      doc_id: 'calc-integrals',
      name: 'Integration Techniques Cheat Sheet',
      full_text:
        '# Integration Techniques Cheat Sheet\n\nIntegration is basically undoing differentiation, but the tricks are way harder to spot.\n\n## Methods\n- u-Substitution: find the inner function, let u equal it, replace dx\n- Integration by parts: ∫u dv = uv - ∫v du. Pick u so it simplifies when differentiated.\n- Partial fractions: split rational functions into simpler pieces\n\n## Fundamental Theorem of Calculus\nPart 1: If F\'(x) = f(x), then ∫[a,b] f(x)dx = F(b) - F(a). This is the bridge between derivatives and integrals — it says accumulation and rate of change are two sides of the same coin.',
    },
  ],
  'Chain Rule': [
    {
      doc_id: 'calc-derivatives',
      name: 'Derivative Rules Study Guide',
      full_text:
        '# Derivative Rules Study Guide\n\n## Chain Rule\nTake the derivative of the outer function and multiply by the derivative of the inner function. For sin(x² + 1), the outer is sin(·) and the inner is x² + 1, so the derivative is cos(x² + 1) · 2x.\n\nI keep dropping the derivative of the inside — that\'s where most of my points go.',
    },
  ],
  'Fundamental Theorem of Calculus': [
    {
      doc_id: 'calc-integrals',
      name: 'Integration Techniques Cheat Sheet',
      full_text:
        '# Fundamental Theorem of Calculus\n\nPart 1: d/dx ∫[a,x] f(t)dt = f(x). Differentiation undoes integration.\nPart 2: ∫[a,b] f(x)dx = F(b) - F(a). To evaluate a definite integral, find any antiderivative and subtract.\n\nThis theorem is why calculus works as a unified subject instead of two disconnected topics.',
    },
  ],

  // ── Physics ──
  'Classical Mechanics': [
    {
      doc_id: 'phys-mechanics',
      name: 'Mechanics Problem Set Notes',
      full_text:
        '# Mechanics Problem Set Notes\n\n## Newton\'s Laws recap\n1. An object stays at rest or in motion unless a net force acts on it\n2. F = ma — this is where 90% of the problem sets live\n3. Every action has an equal and opposite reaction\n\n## Energy approach\nWhen forces get complicated, switch to conservation of energy. The total kinetic + potential energy stays constant if there\'s no friction or external work. I find the energy method faster than free-body diagrams for inclined-plane problems.\n\n## Calculus connection\nVelocity is the derivative of position, acceleration is the derivative of velocity. So mechanics problems are really just differential equations in disguise.',
    },
  ],
  'Newton\'s Laws': [
    {
      doc_id: 'phys-mechanics',
      name: 'Mechanics Problem Set Notes',
      full_text:
        '# Newton\'s Laws\n\nF = ma is deceptively simple. The hard part is drawing the free-body diagram correctly and picking the right coordinate system.\n\n## Common mistakes I make\n- Forgetting to decompose forces into components on an incline\n- Mixing up normal force and weight when there\'s an angle\n- Not recognizing that tension is the same throughout an ideal rope',
    },
  ],
  'Conservation of Energy': [
    {
      doc_id: 'phys-mechanics',
      name: 'Mechanics Problem Set Notes',
      full_text:
        '# Conservation of Energy\n\nKE₁ + PE₁ = KE₂ + PE₂ (no friction). When I can use this instead of Newton\'s second law, problems get way shorter. The pendulum problem on homework 4 was one line with energy conservation vs. half a page with forces.',
    },
  ],
  Electromagnetism: [
    {
      doc_id: 'phys-em',
      name: 'Electromagnetism Lecture Notes',
      full_text:
        '# Electromagnetism Lecture Notes\n\n## Coulomb\'s Law\nElectric force between two charges: F = kq₁q₂/r². Looks just like gravity but with charge instead of mass, and it can repel.\n\n## Electric fields\nE = F/q. The field is the force per unit charge. Field lines go from positive to negative.\n\n## Maxwell\'s Equations\nFour equations that unify electricity and magnetism:\n1. Gauss\'s law for E: charges create electric fields\n2. Gauss\'s law for B: no magnetic monopoles\n3. Faraday\'s law: changing B creates E\n4. Ampère-Maxwell: currents and changing E create B\n\nThe professor said these four equations contain all of classical electromagnetism. Light is just an electromagnetic wave predicted by these equations.',
    },
  ],
  'Maxwell\'s Equations': [
    {
      doc_id: 'phys-em',
      name: 'Electromagnetism Lecture Notes',
      full_text:
        '# Maxwell\'s Equations\n\nFour equations that describe all classical electromagnetism. Faraday\'s law says a changing magnetic field creates an electric field — that\'s how generators work. The displacement current term that Maxwell added to Ampère\'s law is what predicts electromagnetic waves.',
    },
  ],
  Thermodynamics: [
    {
      doc_id: 'phys-thermo',
      name: 'Thermodynamics Midterm Review',
      full_text:
        '# Thermodynamics Midterm Review\n\n## Laws\n- 0th: If A is in thermal equilibrium with B, and B with C, then A is with C (defines temperature)\n- 1st: Energy is conserved — ΔU = Q - W\n- 2nd: Entropy of an isolated system never decreases\n- 3rd: Can\'t reach absolute zero in finite steps\n\n## Entropy\nEntropy is a measure of disorder or the number of microstates. The second law means heat naturally flows hot → cold, never the reverse without external work. This gives time a direction — the "arrow of time."\n\n## Connection to philosophy\nThe entropy argument comes up in determinism debates — if the universe is just particles following Newton\'s laws, is everything predetermined? But thermodynamics says we can only predict statistical averages, not individual particle paths.',
    },
  ],
  Entropy: [
    {
      doc_id: 'phys-thermo',
      name: 'Thermodynamics Midterm Review',
      full_text:
        '# Entropy\n\nS = k·ln(Ω) where Ω is the number of microstates. Higher entropy = more ways to arrange the system. The second law says entropy always increases in isolated systems, which is why you can\'t unscramble an egg.\n\nThis connects to information theory too — Shannon entropy measures uncertainty in a message, and the math is almost identical.',
    },
  ],

  // ── Philosophy ──
  Epistemology: [
    {
      doc_id: 'phil-epistemology',
      name: 'Epistemology Essay Draft',
      full_text:
        '# Epistemology Essay Draft\n\n## What counts as knowledge?\nThe traditional definition is "justified true belief," but Gettier cases show that isn\'t sufficient. You can have a justified true belief that\'s only true by luck.\n\n## Rationalism vs Empiricism\nRationalists (Descartes, Leibniz) say some knowledge is innate or derived from reason alone. Empiricists (Locke, Hume) say all knowledge comes from sensory experience — the mind starts as a blank slate.\n\n## My take for the essay\nI\'m going to argue that math knowledge supports rationalism — we can know that 2+2=4 without doing experiments. But scientific knowledge supports empiricism — you can\'t deduce the boiling point of water from pure logic. Maybe the answer is that both are right about different domains.',
    },
  ],
  Rationalism: [
    {
      doc_id: 'phil-epistemology',
      name: 'Epistemology Essay Draft',
      full_text:
        '# Rationalism\n\nDescartes\'s "I think, therefore I am" is the classic rationalist move — he arrives at certain knowledge through pure reasoning, not observation. Leibniz argued that mathematical truths are known a priori.\n\nInteresting that my calculus class feels rationalist — we prove theorems from axioms, not from experiments.',
    },
  ],
  Empiricism: [
    {
      doc_id: 'phil-epistemology',
      name: 'Epistemology Essay Draft',
      full_text:
        '# Empiricism\n\nHume argued we can\'t even prove causation — we only ever observe correlation. The sun has risen every day so far, but that doesn\'t logically guarantee tomorrow.\n\nThis connects to my physics class — the scientific method is fundamentally empiricist. We test hypotheses against observations.',
    },
  ],
  Ethics: [
    {
      doc_id: 'phil-ethics',
      name: 'Ethics Seminar Notes',
      full_text:
        '# Ethics Seminar Notes\n\n## Utilitarianism\nMill\'s "greatest happiness for the greatest number." The trolley problem is the classic test case — do you pull the lever to save five and kill one?\n\n## Deontology\nKant says some actions are wrong regardless of consequences. You shouldn\'t lie even if it would save someone, because lying violates the categorical imperative.\n\n## Virtue ethics\nAristotle: focus on building good character traits rather than following rules. A virtuous person naturally does the right thing.\n\n## Career relevance\nWe discussed tech ethics in seminar. If I end up working in AI, these frameworks matter — is it ethical to deploy a model that\'s 95% accurate if the 5% errors disproportionately affect minorities? Utilitarianism and deontology give different answers.',
    },
  ],
  Utilitarianism: [
    {
      doc_id: 'phil-ethics',
      name: 'Ethics Seminar Notes',
      full_text:
        '# Utilitarianism\n\nJeremy Bentham\'s original formulation was purely about pleasure and pain. Mill refined it by distinguishing higher and lower pleasures — reading philosophy produces a "higher" happiness than eating pizza, supposedly.\n\nThe problem: how do you measure and compare happiness across people? And it can justify terrible things if the math works out (harvesting one person\'s organs to save five).',
    },
  ],
  Existentialism: [
    {
      doc_id: 'phil-existentialism',
      name: 'Existentialism Reading Notes',
      full_text:
        '# Existentialism Reading Notes\n\n## Sartre\n"Existence precedes essence" — we aren\'t born with a purpose, we create our own meaning. This is both liberating and terrifying.\n\n## Camus\nThe Myth of Sisyphus: life is absurd but we must imagine Sisyphus happy. The struggle itself is enough to fill a heart.\n\n## Free will\nIf existence precedes essence, then we are "condemned to be free" (Sartre). We can\'t blame our nature or God — every choice is ours.\n\n## Personal connection\nReading this during midterms hit different. When I\'m stressed about grades, Camus\'s point about finding meaning in the struggle actually helps. Also made me think about the determinism debate in physics — if everything is just atoms following laws, is Sartre wrong about free will?',
    },
  ],
  'Free Will': [
    {
      doc_id: 'phil-existentialism',
      name: 'Existentialism Reading Notes',
      full_text:
        '# Free Will\n\nSartre says we\'re condemned to be free — no excuses, full responsibility for every choice.\n\nBut my physics professor brought up Laplace\'s demon — if you knew the position and velocity of every particle, you could predict the entire future. That\'s hard determinism, and it seems to contradict free will.\n\nMaybe compatibilism is the answer: free will is compatible with determinism because "free" just means "not coerced," not "uncaused."',
    },
  ],

  // ── Personal / Journal ──
  'Study Habits': [
    {
      doc_id: 'journal-semester-goals',
      name: 'Semester Goals - Jan 2026',
      full_text:
        '# Semester Goals\n\n## Study habits I want to build\n- Do practice problems daily instead of cramming before exams\n- Use active recall: close the textbook and try to explain concepts from memory\n- Review notes within 24 hours of each lecture\n\nI keep telling myself I\'ll start studying earlier but then I don\'t. This semester needs to be different.',
    },
    {
      doc_id: 'journal-burnout',
      name: 'Feeling Burned Out - Feb 2026',
      full_text:
        '# Feeling Burned Out\n\nI\'ve been in the library until midnight every day this week and I still bombed the physics quiz. My study habits clearly aren\'t working — I\'m putting in hours but not learning efficiently. Need to try something different. Maybe shorter focused sessions with breaks instead of marathon sessions.',
    },
  ],
  'Time Management': [
    {
      doc_id: 'journal-midterm-reflection',
      name: 'Midterm Reflection',
      full_text:
        '# Midterm Reflection\n\nCalc midterm went well (B+), physics was rough (C+), philosophy paper got an A-.\n\n## What went wrong with physics\nI spent too much time on calculus problem sets and didn\'t leave enough time for physics. Need to balance my time better across subjects. The Pomodoro method might help — 25 min focused blocks with 5 min breaks.\n\n## What worked\nStarting the philosophy essay early meant I had time to revise. Wish I\'d done the same for physics.',
    },
  ],
  Motivation: [
    {
      doc_id: 'journal-midterm-reflection',
      name: 'Midterm Reflection',
      full_text:
        '# Midterm Reflection\n\nAfter the physics grade I felt like dropping the class. But then I went to office hours and the professor walked me through two problems I\'d been stuck on, and it clicked. That feeling when something finally makes sense is why I\'m in school.\n\nNeed to remember this feeling next time I want to give up.',
    },
    {
      doc_id: 'journal-burnout',
      name: 'Feeling Burned Out - Feb 2026',
      full_text:
        '# Feeling Burned Out\n\nMotivation is at an all-time low. Read some Camus last night and weirdly it helped — "the struggle itself is enough to fill a heart." Maybe the point isn\'t to get perfect grades but to actually understand things.',
    },
  ],
  'Career Goals': [
    {
      doc_id: 'journal-semester-goals',
      name: 'Semester Goals - Jan 2026',
      full_text:
        '# Career Goals\n\nI\'m thinking about grad school for applied math or computational physics. Need to get my GPA up and maybe find a research position this summer.\n\nAlternatively, tech companies hire physics/math majors for quantitative roles. The ethics seminar made me think about whether I want to work in AI — interesting but the ethical questions are real.\n\nEither way, I need to build actual projects, not just do homework.',
    },
  ],
  'Differential Equations': [
    {
      doc_id: 'phys-mechanics',
      name: 'Mechanics Problem Set Notes',
      full_text:
        '# Differential Equations in Mechanics\n\nF = ma is really m·d²x/dt² = F(x,v,t) — a second-order differential equation. Simple harmonic motion (springs, pendulums) gives x\'\' = -ω²x, which has sin and cos solutions.\n\nThis is where calculus and physics merge. The math I\'m learning in calc class is literally the tool for solving physics problems.',
    },
  ],
  Determinism: [
    {
      doc_id: 'phil-existentialism',
      name: 'Existentialism Reading Notes',
      full_text:
        '# Determinism\n\nLaplace\'s demon: if you knew every particle\'s position and velocity, you could predict the entire future of the universe. Classical mechanics is deterministic — same initial conditions always give same outcomes.\n\nBut: quantum mechanics introduces genuine randomness. And chaos theory means even deterministic systems are unpredictable in practice. So maybe the universe is deterministic but unfollowable.\n\nThe entropy connection is interesting too — the second law of thermodynamics gives time a direction, even though Newton\'s laws are time-reversible.',
    },
  ],
};

export const mockRelationshipDetailsByEdge: Record<string, RelationshipDetails> = {
  'concept:Calculus->concept:Derivatives': {
    source: 'Calculus',
    target: 'Derivatives',
    type: 'RELATED_TO',
    reason: 'Derivatives are the central tool of differential calculus, measuring instantaneous rates of change',
    source_documents: [
      {
        doc_id: 'calc-limits',
        name: 'Limits and Continuity Review',
        full_text: 'Calculus starts with limits because they tell us what a function is trying to do near a point.',
      },
    ],
    target_documents: [
      {
        doc_id: 'calc-derivatives',
        name: 'Derivative Rules Study Guide',
        full_text: 'Derivatives measure instantaneous change. Power rule, product rule, chain rule.',
      },
    ],
    shared_document_ids: [],
  },
  'concept:Derivatives->concept:Newton\'s Laws': {
    source: 'Derivatives',
    target: 'Newton\'s Laws',
    type: 'RELATED_TO',
    reason: 'Newton\'s second law F=ma is a differential equation — acceleration is the second derivative of position',
    source_documents: [
      {
        doc_id: 'calc-derivatives',
        name: 'Derivative Rules Study Guide',
        full_text: 'Derivatives measure instantaneous change.',
      },
    ],
    target_documents: [
      {
        doc_id: 'phys-mechanics',
        name: 'Mechanics Problem Set Notes',
        full_text: 'F = ma — velocity is the derivative of position, acceleration is the derivative of velocity.',
      },
    ],
    shared_document_ids: [],
  },
  'concept:Entropy->concept:Determinism': {
    source: 'Entropy',
    target: 'Determinism',
    type: 'RELATED_TO',
    reason: 'The second law of thermodynamics gives time a direction, challenging pure determinism with statistical irreversibility',
    source_documents: [
      {
        doc_id: 'phys-thermo',
        name: 'Thermodynamics Midterm Review',
        full_text: 'Entropy always increases in isolated systems. This gives time a direction — the arrow of time.',
      },
    ],
    target_documents: [
      {
        doc_id: 'phil-existentialism',
        name: 'Existentialism Reading Notes',
        full_text: 'Newton\'s laws are time-reversible but thermodynamics gives time a direction via entropy.',
      },
    ],
    shared_document_ids: [],
  },
  'concept:Free Will->concept:Determinism': {
    source: 'Free Will',
    target: 'Determinism',
    type: 'RELATED_TO',
    reason: 'The free will debate directly opposes existentialist freedom against physical determinism',
    source_documents: [
      {
        doc_id: 'phil-existentialism',
        name: 'Existentialism Reading Notes',
        full_text: 'Sartre says we are condemned to be free — no excuses, full responsibility.',
      },
    ],
    target_documents: [
      {
        doc_id: 'phil-existentialism',
        name: 'Existentialism Reading Notes',
        full_text: 'Laplace\'s demon: if you knew every particle\'s state, you could predict the entire future.',
      },
    ],
    shared_document_ids: ['phil-existentialism'],
  },
  'concept:Existentialism->concept:Motivation': {
    source: 'Existentialism',
    target: 'Motivation',
    type: 'RELATED_TO',
    reason: 'Camus\'s absurdism reframes the struggle for meaning as a source of personal motivation',
    source_documents: [
      {
        doc_id: 'phil-existentialism',
        name: 'Existentialism Reading Notes',
        full_text: 'Camus: the struggle itself is enough to fill a heart.',
      },
    ],
    target_documents: [
      {
        doc_id: 'journal-burnout',
        name: 'Feeling Burned Out - Feb 2026',
        full_text: 'Read some Camus last night and it helped — maybe the point isn\'t perfect grades but actually understanding things.',
      },
    ],
    shared_document_ids: [],
  },
  'concept:Ethics->concept:Career Goals': {
    source: 'Ethics',
    target: 'Career Goals',
    type: 'RELATED_TO',
    reason: 'Ethics seminar discussions about AI ethics directly inform career direction decisions',
    source_documents: [
      {
        doc_id: 'phil-ethics',
        name: 'Ethics Seminar Notes',
        full_text: 'If I end up in AI, these ethical frameworks matter — is it ethical to deploy a 95% accurate model if errors disproportionately affect minorities?',
      },
    ],
    target_documents: [
      {
        doc_id: 'journal-semester-goals',
        name: 'Semester Goals - Jan 2026',
        full_text: 'The ethics seminar made me think about whether I want to work in AI.',
      },
    ],
    shared_document_ids: [],
  },
};

export function getMockDocumentsForConcept(conceptName: string): MockDocument[] {
  return (
    MOCK_CONCEPT_DOCUMENTS[conceptName] ?? [
      {
        doc_id: `mock-${conceptName.toLowerCase().replace(/\s+/g, '-')}`,
        name: `${conceptName} Notes.md`,
        full_text: `Research notes and observations about ${conceptName}.`,
      },
    ]
  );
}
