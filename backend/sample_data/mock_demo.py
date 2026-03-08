import hashlib
import os
from dataclasses import dataclass
from textwrap import dedent

import kuzu as _kuzu

from backend.db.kuzu import init_kuzu, update_node_communities
from backend.db.lance import (
    COMMUNITY_SUMMARIES_SCHEMA,
    CONCEPT_CENTROIDS_SCHEMA,
    init_lancedb,
    replace_table_records,
)
from backend.retrieval.latent_discovery import average_vectors
from backend.services.clustering import run_leiden_clustering
from backend.services.embeddings import VECTOR_DIM, calculate_color_score, embed_texts


@dataclass(frozen=True)
class DemoDocument:
    doc_id: str
    title: str
    text: str
    concepts: tuple[str, ...]


@dataclass(frozen=True)
class DemoEdge:
    source: str
    target: str
    reason: str
    weight: float = 1.0


@dataclass(frozen=True)
class DemoDomain:
    root: str
    concepts: tuple[str, ...]
    internal_pairs: tuple[tuple[str, str], ...]
    summary: str
    application: str


CURATED_DOCUMENTS: tuple[DemoDocument, ...] = (
    DemoDocument(
        doc_id="demo:calc-limits",
        title="Limits and Continuity Review",
        concepts=("Calculus", "Limits"),
        text=dedent(
            """
            # Limits and Continuity Review

            Professor Lin kept repeating that Calculus starts with Limits because they tell us what a function is trying to do near a point, even if the function is undefined there.

            ## Key ideas
            - For a two-sided limit to exist, the left-hand and right-hand limits have to agree.
            - Continuity at x = a means f(a) exists, the limit as x -> a exists, and both values match.
            - The epsilon-delta definition is the formal language behind the intuitive graphs we draw.

            ## Worked example
            For f(x) = (x^2 - 1)/(x - 1), the graph has a hole at x = 1 but the limit still exists. Factoring gives x + 1, so the limits from both sides go to 2.
            """
        ).strip(),
    ),
    DemoDocument(
        doc_id="demo:calc-derivatives",
        title="Derivative Rules Study Guide",
        concepts=("Derivatives", "Chain Rule"),
        text=dedent(
            """
            # Derivative Rules Study Guide

            Derivatives measure instantaneous change. The slope of the tangent line is just the derivative evaluated at that point.

            ## Rules I need memorized
            - Power rule: d/dx of x^n = n*x^(n-1)
            - Product Rule: differentiate the first, leave the second, then add first times derivative of the second
            - Chain Rule: derivative of the outer function times derivative of the inner function

            ## Example that tripped me up
            For y = (3x^2 + 1)(x^3 - 4), I forgot the Product Rule on the practice quiz and lost four points. If the function is composite, like sin(x^2 + 1), I also need the Chain Rule.
            """
        ).strip(),
    ),
    DemoDocument(
        doc_id="demo:calc-integrals",
        title="Integration Techniques Cheat Sheet",
        concepts=("Integrals", "Fundamental Theorem of Calculus"),
        text=dedent(
            """
            # Integration Techniques Cheat Sheet

            Integration is basically undoing differentiation, but the tricks are way harder to spot.

            ## Methods
            - u-Substitution: find the inner function, let u equal it, replace dx
            - Integration by parts: integral of u dv = uv - integral of v du.
            - Partial fractions: split rational functions into simpler pieces

            ## Fundamental Theorem of Calculus
            Part 1: If F'(x) = f(x), then the definite integral from a to b of f(x) dx equals F(b) - F(a). This is the bridge between derivatives and integrals.
            """
        ).strip(),
    ),
    DemoDocument(
        doc_id="demo:phys-mechanics",
        title="Mechanics Problem Set Notes",
        concepts=(
            "Classical Mechanics",
            "Newton's Laws",
            "Conservation of Energy",
            "Differential Equations",
        ),
        text=dedent(
            """
            # Mechanics Problem Set Notes

            ## Newton's Laws recap
            1. An object stays at rest or in motion unless a net force acts on it
            2. F = ma
            3. Every action has an equal and opposite reaction

            ## Energy approach
            When forces get complicated, switch to conservation of energy. The total kinetic plus potential energy stays constant if there is no friction or external work.

            ## Calculus connection
            Velocity is the derivative of position, acceleration is the derivative of velocity. So mechanics problems are really just differential equations in disguise.
            """
        ).strip(),
    ),
    DemoDocument(
        doc_id="demo:phys-em",
        title="Electromagnetism Lecture Notes",
        concepts=("Electromagnetism", "Maxwell's Equations"),
        text=dedent(
            """
            # Electromagnetism Lecture Notes

            ## Coulomb's Law
            Electric force between two charges: F = kq1q2/r^2.

            ## Electric fields
            E = F/q. The field is the force per unit charge.

            ## Maxwell's Equations
            Four equations that unify electricity and magnetism:
            1. Gauss's law for E: charges create electric fields
            2. Gauss's law for B: no magnetic monopoles
            3. Faraday's law: changing B creates E
            4. Ampere-Maxwell: currents and changing E create B

            The professor said these four equations contain all of classical electromagnetism. Light is just an electromagnetic wave predicted by these equations.
            """
        ).strip(),
    ),
    DemoDocument(
        doc_id="demo:phys-thermo",
        title="Thermodynamics Midterm Review",
        concepts=("Thermodynamics", "Entropy", "Determinism"),
        text=dedent(
            """
            # Thermodynamics Midterm Review

            ## Laws
            - 0th: If A is in thermal equilibrium with B, and B with C, then A is with C
            - 1st: Energy is conserved
            - 2nd: Entropy of an isolated system never decreases
            - 3rd: Can't reach absolute zero in finite steps

            ## Entropy
            Entropy is a measure of disorder or the number of microstates.

            ## Connection to philosophy
            The entropy argument comes up in determinism debates because thermodynamics gives time a direction even though Newton's laws are reversible.
            """
        ).strip(),
    ),
    DemoDocument(
        doc_id="demo:phil-epistemology",
        title="Epistemology Essay Draft",
        concepts=("Epistemology", "Rationalism", "Empiricism"),
        text=dedent(
            """
            # Epistemology Essay Draft

            ## What counts as knowledge?
            The traditional definition is justified true belief, but Gettier cases show that is not sufficient.

            ## Rationalism vs Empiricism
            Rationalists say some knowledge is innate or derived from reason alone. Empiricists say all knowledge comes from sensory experience.

            ## My take for the essay
            Math knowledge supports rationalism, but scientific knowledge supports empiricism.
            """
        ).strip(),
    ),
    DemoDocument(
        doc_id="demo:phil-ethics",
        title="Ethics Seminar Notes",
        concepts=("Ethics", "Utilitarianism", "Career Goals"),
        text=dedent(
            """
            # Ethics Seminar Notes

            ## Utilitarianism
            The greatest happiness for the greatest number.

            ## Deontology
            Some actions are wrong regardless of consequences.

            ## Career relevance
            We discussed tech ethics in seminar. If I end up working in AI, these frameworks matter.
            """
        ).strip(),
    ),
    DemoDocument(
        doc_id="demo:phil-existentialism",
        title="Existentialism Reading Notes",
        concepts=("Existentialism", "Free Will", "Determinism", "Motivation"),
        text=dedent(
            """
            # Existentialism Reading Notes

            ## Sartre
            Existence precedes essence.

            ## Camus
            The struggle itself is enough to fill a heart.

            ## Free will
            We are condemned to be free.

            ## Personal connection
            Reading this during midterms helped me think about stress, motivation, and the determinism debate in physics.
            """
        ).strip(),
    ),
    DemoDocument(
        doc_id="demo:journal-semester-goals",
        title="Semester Goals - Jan 2026",
        concepts=("Study Habits", "Career Goals"),
        text=dedent(
            """
            # Semester Goals

            ## Study habits I want to build
            - Do practice problems daily instead of cramming before exams
            - Use active recall
            - Review notes within 24 hours of each lecture

            ## Career Goals
            I am thinking about grad school for applied math or computational physics. Either way, I need to build actual projects, not just do homework.
            """
        ).strip(),
    ),
    DemoDocument(
        doc_id="demo:journal-burnout",
        title="Feeling Burned Out - Feb 2026",
        concepts=("Study Habits", "Motivation"),
        text=dedent(
            """
            # Feeling Burned Out

            I have been in the library until midnight every day this week and my study habits clearly are not working.

            Motivation is at an all-time low. Read some Camus last night and it helped.
            """
        ).strip(),
    ),
    DemoDocument(
        doc_id="demo:journal-midterm-reflection",
        title="Midterm Reflection",
        concepts=("Time Management", "Motivation"),
        text=dedent(
            """
            # Midterm Reflection

            Calc midterm went well, physics was rough, philosophy paper got an A-.

            ## What went wrong with physics
            I spent too much time on calculus problem sets and did not leave enough time for physics.

            ## What worked
            Starting the philosophy essay early meant I had time to revise.
            """
        ).strip(),
    ),
)

CURATED_EDGES: tuple[DemoEdge, ...] = (
    DemoEdge("Calculus", "Limits", "Calculus starts with limits."),
    DemoEdge("Calculus", "Derivatives", "Derivatives are one half of calculus."),
    DemoEdge("Calculus", "Integrals", "Integrals are one half of calculus."),
    DemoEdge("Derivatives", "Chain Rule", "The chain rule is a core derivative technique."),
    DemoEdge("Integrals", "Fundamental Theorem of Calculus", "The theorem connects integrals to antiderivatives."),
    DemoEdge("Derivatives", "Fundamental Theorem of Calculus", "The theorem links differentiation and integration."),
    DemoEdge("Limits", "Derivatives", "Derivatives are defined from limits."),
    DemoEdge("Classical Mechanics", "Newton's Laws", "Newton's laws anchor mechanics."),
    DemoEdge("Classical Mechanics", "Conservation of Energy", "Mechanics often uses energy reasoning."),
    DemoEdge("Electromagnetism", "Maxwell's Equations", "Maxwell's equations unify electromagnetism."),
    DemoEdge("Thermodynamics", "Entropy", "Entropy is central to thermodynamics."),
    DemoEdge("Thermodynamics", "Conservation of Energy", "Thermodynamics uses conservation laws."),
    DemoEdge("Epistemology", "Rationalism", "Rationalism is a major epistemology branch."),
    DemoEdge("Epistemology", "Empiricism", "Empiricism is a major epistemology branch."),
    DemoEdge("Ethics", "Utilitarianism", "Utilitarianism is a major ethical framework."),
    DemoEdge("Existentialism", "Free Will", "Existentialism emphasizes freedom and choice."),
    DemoEdge("Rationalism", "Empiricism", "The essay contrasts rationalism with empiricism."),
    DemoEdge("Study Habits", "Time Management", "Time management shapes study habits."),
    DemoEdge("Motivation", "Study Habits", "Motivation affects study consistency."),
    DemoEdge("Career Goals", "Motivation", "Goals shape day-to-day motivation."),
    DemoEdge("Calculus", "Classical Mechanics", "Classical mechanics uses calculus to model motion and change."),
    DemoEdge("Differential Equations", "Calculus", "Differential equations extend calculus."),
    DemoEdge("Differential Equations", "Classical Mechanics", "Mechanics problems often become differential equations."),
    DemoEdge("Derivatives", "Newton's Laws", "Acceleration is the derivative of velocity, so mechanics depends on derivatives."),
    DemoEdge("Entropy", "Determinism", "Entropy gives time a direction inside determinism debates."),
    DemoEdge("Free Will", "Determinism", "Free will debates directly confront determinism."),
    DemoEdge("Determinism", "Classical Mechanics", "Classical mechanics motivates deterministic worldviews."),
    DemoEdge("Existentialism", "Motivation", "Existentialist writing reframes meaning-making as motivation."),
    DemoEdge("Ethics", "Career Goals", "Ethical tradeoffs shape career direction."),
)

GENERATED_DOMAINS: tuple[DemoDomain, ...] = (
    DemoDomain(
        root="Computer Science",
        concepts=("Algorithms", "Data Structures", "Distributed Systems", "Databases", "Machine Learning", "Neural Networks", "Information Theory", "Computer Networks"),
        internal_pairs=(("Algorithms", "Data Structures"), ("Distributed Systems", "Databases"), ("Machine Learning", "Neural Networks"), ("Information Theory", "Computer Networks")),
        summary="This cluster tracks how software systems represent information, learn patterns, and coordinate work across many machines.",
        application="These concepts are the backbone for building products, training models, and reasoning about how information moves through a system.",
    ),
    DemoDomain(
        root="Biology",
        concepts=("Cell Biology", "Genetics", "Evolution", "Ecology", "Neuroscience", "Homeostasis", "Microbiology", "Immunology"),
        internal_pairs=(("Cell Biology", "Genetics"), ("Genetics", "Evolution"), ("Ecology", "Homeostasis"), ("Microbiology", "Immunology")),
        summary="The biology cluster captures living systems from molecules and cells up through ecosystems and nervous systems.",
        application="It helps show how mechanisms at one scale cascade into adaptation, behavior, and system-level stability.",
    ),
    DemoDomain(
        root="Economics",
        concepts=("Microeconomics", "Macroeconomics", "Game Theory", "Inflation", "Supply and Demand", "Monetary Policy", "Behavioral Economics", "Market Design"),
        internal_pairs=(("Microeconomics", "Supply and Demand"), ("Macroeconomics", "Inflation"), ("Monetary Policy", "Inflation"), ("Game Theory", "Market Design")),
        summary="Economics models incentives, scarcity, and coordination from individual choices to system-wide policy effects.",
        application="These nodes make it easier to show how decisions compound into markets, institutions, and long-run outcomes.",
    ),
    DemoDomain(
        root="Psychology",
        concepts=("Cognitive Biases", "Memory Consolidation", "Learning Theory", "Attention", "Decision Making", "Social Identity", "Emotional Regulation", "Habit Formation"),
        internal_pairs=(("Cognitive Biases", "Decision Making"), ("Memory Consolidation", "Learning Theory"), ("Attention", "Emotional Regulation"), ("Learning Theory", "Habit Formation")),
        summary="Psychology explains how people perceive, remember, decide, and regulate behavior under real constraints.",
        application="This area gives the graph human behavior anchors that connect naturally to studying, product design, and economics.",
    ),
    DemoDomain(
        root="Product Design",
        concepts=("Product Strategy", "User Research", "Information Architecture", "Design Systems", "Prototyping", "Accessibility", "Feedback Loops", "Metrics"),
        internal_pairs=(("Product Strategy", "Metrics"), ("User Research", "Information Architecture"), ("Design Systems", "Accessibility"), ("Prototyping", "Feedback Loops")),
        summary="Product design sits at the intersection of user needs, interface structure, iteration speed, and measurable outcomes.",
        application="These concepts create practical bridges from theory into how teams build software and evaluate whether it works.",
    ),
    DemoDomain(
        root="History",
        concepts=("Enlightenment", "Industrial Revolution", "Colonialism", "Democratic Institutions", "Civil Rights", "Cold War", "Propaganda", "Public Policy"),
        internal_pairs=(("Enlightenment", "Democratic Institutions"), ("Industrial Revolution", "Colonialism"), ("Civil Rights", "Public Policy"), ("Cold War", "Propaganda")),
        summary="History shows how ideas, institutions, and power struggles evolve over time rather than appearing in isolation.",
        application="It gives the demo graph a way to connect political choices, technological change, and ethical debates across eras.",
    ),
    DemoDomain(
        root="Arts",
        concepts=("Narrative Structure", "Poetry Analysis", "Symbolism", "Harmony", "Rhythm", "Composition", "Visual Storytelling", "Creative Process"),
        internal_pairs=(("Narrative Structure", "Symbolism"), ("Poetry Analysis", "Symbolism"), ("Harmony", "Rhythm"), ("Composition", "Creative Process")),
        summary="The arts cluster focuses on how creators shape meaning through structure, pacing, sound, image, and revision.",
        application="It adds a creative lane to the graph so interpretation and expression can connect to design, history, and motivation.",
    ),
    DemoDomain(
        root="Data Science",
        concepts=("Probability", "Bayesian Inference", "Linear Algebra", "Optimization", "Statistics", "Causal Inference", "Signal Processing", "Control Theory"),
        internal_pairs=(("Probability", "Bayesian Inference"), ("Linear Algebra", "Optimization"), ("Statistics", "Causal Inference"), ("Signal Processing", "Control Theory")),
        summary="Data science connects mathematical modeling, inference, and systems thinking into one applied analytic toolkit.",
        application="This cluster is where quantitative reasoning meets experimentation, forecasting, and feedback-driven control.",
    ),
)

BRIDGE_EDGES: tuple[DemoEdge, ...] = (
    DemoEdge("Entropy", "Information Theory", "Entropy links thermodynamics and information theory through uncertainty and state counting."),
    DemoEdge("Machine Learning", "Statistics", "Machine learning depends on statistical estimation, evaluation, and generalization."),
    DemoEdge("Machine Learning", "Linear Algebra", "Most model representations and training updates are expressed with linear algebra."),
    DemoEdge("Neural Networks", "Neuroscience", "Neural networks borrow their language and intuition from neuroscience."),
    DemoEdge("Behavioral Economics", "Cognitive Biases", "Behavioral economics studies how cognitive biases bend classical incentive models."),
    DemoEdge("Behavioral Economics", "Decision Making", "Behavioral economics explains real-world decision making under bounded rationality."),
    DemoEdge("Ethics", "Accessibility", "Accessibility is both a design practice and an ethical commitment to inclusion."),
    DemoEdge("Ethics", "Public Policy", "Ethical frameworks shape how public policy evaluates fairness and harm."),
    DemoEdge("Motivation", "Habit Formation", "Motivation spikes are fragile, so habit formation makes progress sustainable."),
    DemoEdge("Study Habits", "Learning Theory", "Better study habits are usually applied learning theory in disguise."),
    DemoEdge("Epistemology", "Bayesian Inference", "Bayesian inference is a formal way to update beliefs in light of evidence."),
    DemoEdge("Empiricism", "Statistics", "Empiricism depends on evidence, and statistics helps turn observations into claims."),
    DemoEdge("Calculus", "Optimization", "Optimization uses derivatives and curvature to locate better solutions."),
    DemoEdge("Differential Equations", "Control Theory", "Control theory models system response with differential equations and feedback."),
    DemoEdge("Thermodynamics", "Homeostasis", "Homeostasis is a biological version of managing energy flow and equilibrium."),
    DemoEdge("Classical Mechanics", "Control Theory", "Control systems often begin with classical mechanics models of motion and force."),
    DemoEdge("Career Goals", "Product Strategy", "Career planning and product strategy both force explicit tradeoffs and prioritization."),
    DemoEdge("Existentialism", "Creative Process", "Existentialism often frames creative work as an act of choosing meaning."),
    DemoEdge("Civil Rights", "Ethics", "Civil rights debates turn abstract ethical commitments into concrete institutional demands."),
    DemoEdge("Public Policy", "Market Design", "Policy choices often reshape incentives by redesigning the rules of a market."),
    DemoEdge("Information Architecture", "Narrative Structure", "Both information architecture and narrative structure shape how people move through meaning."),
    DemoEdge("Visual Storytelling", "User Research", "Visual storytelling becomes stronger when it responds to audience attention and comprehension."),
    DemoEdge("Probability", "Game Theory", "Strategic reasoning often depends on probabilistic expectations about other agents."),
)


def seed_mock_demo_data(
    lance_db_path: str = "./data/lancedb",
    kuzu_db_path: str = "./data/kuzu",
    shared_kuzu_db=None,
) -> dict[str, int]:
    db, chunks_table = init_lancedb(lance_db_path)
    document_centroids_table = db.open_table("document_centroids")
    if shared_kuzu_db is not None:
        kuzu_db = shared_kuzu_db
        conn = _kuzu.Connection(kuzu_db)
        own_db = False
    else:
        kuzu_db, conn = init_kuzu(kuzu_db_path)
        own_db = True

    try:
        existing_doc_ids = _load_existing_doc_ids(chunks_table)
        documents = _build_demo_documents()
        edges = _build_demo_edges()
        seeded_documents = 0
        skipped_documents = 0

        for concept in _all_concepts(documents, edges):
            conn.execute("MERGE (c:Concept {name: $name})", parameters={"name": concept})
            conn.execute(
                "MATCH (c:Concept {name: $name}) SET c.colorScore = $score",
                parameters={"name": concept, "score": _demo_color_score(concept)},
            )

        for document in documents:
            if document.doc_id in existing_doc_ids:
                skipped_documents += 1
                continue

            chunk_texts = _split_into_chunks(document.text)
            vectors = _embed_demo_texts(chunk_texts)
            chunk_records = []
            for index, (chunk_text, vector) in enumerate(zip(chunk_texts, vectors), start=1):
                chunk_records.append(
                    {
                        "chunk_id": f"{document.doc_id}:chunk:{index}",
                        "doc_id": document.doc_id,
                        "doc_name": document.title,
                        "text": chunk_text,
                        "concepts": _match_chunk_concepts(chunk_text, document.concepts),
                        "vector": vector,
                    }
                )
            chunks_table.add(chunk_records)
            document_centroids_table.add(
                [
                    {
                        "doc_id": document.doc_id,
                        "doc_name": document.title,
                        "centroid_vector": average_vectors(vectors),
                    }
                ]
            )
            seeded_documents += 1

        for edge in edges:
            conn.execute("MERGE (a:Concept {name: $name})", parameters={"name": edge.source})
            conn.execute("MERGE (b:Concept {name: $name})", parameters={"name": edge.target})
            conn.execute(
                "MATCH (a:Concept {name: $source}), (b:Concept {name: $target}) "
                "MERGE (a)-[r:RELATED_TO]->(b) "
                "ON CREATE SET r.reason = $reason, r.weight = $weight, r.edge_type = 'RELATED_TO' "
                "ON MATCH SET r.reason = $reason, r.weight = $weight, r.edge_type = 'RELATED_TO'",
                parameters={
                    "source": edge.source,
                    "target": edge.target,
                    "reason": edge.reason,
                    "weight": edge.weight,
                },
            )

        community_map = run_leiden_clustering(conn)
        update_node_communities(conn, community_map)

        concept_records = _build_concept_centroid_records(chunks_table.to_pandas())
        replace_table_records(db, "concept_centroids", CONCEPT_CENTROIDS_SCHEMA, concept_records)

        community_records = _build_community_summary_records(conn)
        replace_table_records(db, "community_summaries", COMMUNITY_SUMMARIES_SCHEMA, community_records)

        return {
            "seeded_documents": seeded_documents,
            "skipped_documents": skipped_documents,
            "total_concepts": len(_all_concepts(documents, edges)),
            "community_summaries": len(community_records),
        }
    finally:
        conn.close()
        if own_db:
            kuzu_db.close()


def _build_demo_documents() -> list[DemoDocument]:
    return [*CURATED_DOCUMENTS, *_build_generated_documents()]


def _build_generated_documents() -> list[DemoDocument]:
    neighbor_map = _build_domain_neighbor_map()
    bridge_map = _build_bridge_neighbor_map()
    documents: list[DemoDocument] = []

    for domain in GENERATED_DOMAINS:
        for concept_name in (domain.root, *domain.concepts):
            domain_neighbors = tuple(sorted(neighbor_map.get(concept_name, set()) - {concept_name}))
            bridge_neighbors = tuple(sorted(bridge_map.get(concept_name, set()) - {concept_name}))
            nearby_lines = "\n".join(
                f"- {neighbor} stays close to {concept_name} inside the {domain.root} cluster."
                for neighbor in domain_neighbors[:3]
            ) or f"- {domain.root} is the main anchor concept for {concept_name} in this demo graph."
            bridge_lines = "\n".join(
                f"- {concept_name} also reaches into {neighbor}, which helps the demo graph show cross-domain structure."
                for neighbor in bridge_neighbors[:3]
            ) or f"- {concept_name} mostly reinforces the internal shape of the {domain.root} cluster."
            concepts = tuple(dict.fromkeys((concept_name, domain.root, *domain_neighbors[:3], *bridge_neighbors[:3])))
            documents.append(
                DemoDocument(
                    doc_id=f"demo:{_slugify(concept_name)}",
                    title=f"{concept_name} Field Notes",
                    concepts=concepts,
                    text=dedent(
                        f"""
                        # {concept_name}

                        {concept_name} sits inside the {domain.root} cluster of the BrainBank demo graph. {domain.summary}

                        ## Why it matters
                        {domain.application}

                        ## Nearby concepts
                        {nearby_lines}

                        ## Cross-domain links
                        {bridge_lines}
                        """
                    ).strip(),
                )
            )

    return documents


def _build_demo_edges() -> list[DemoEdge]:
    edges = [*CURATED_EDGES, *BRIDGE_EDGES]
    for domain in GENERATED_DOMAINS:
        for concept in domain.concepts:
            edges.append(
                DemoEdge(
                    domain.root,
                    concept,
                    f"{domain.root} provides the umbrella context for {concept}.",
                )
            )
        for left, right in domain.internal_pairs:
            edges.append(
                DemoEdge(
                    left,
                    right,
                    f"{left} and {right} reinforce each other inside the {domain.root} cluster.",
                )
            )
    return edges


def _build_domain_neighbor_map() -> dict[str, set[str]]:
    neighbor_map: dict[str, set[str]] = {}
    for domain in GENERATED_DOMAINS:
        for concept in domain.concepts:
            _connect_bidirectionally(neighbor_map, domain.root, concept)
        for left, right in domain.internal_pairs:
            _connect_bidirectionally(neighbor_map, left, right)
    return neighbor_map


def _build_bridge_neighbor_map() -> dict[str, set[str]]:
    neighbor_map: dict[str, set[str]] = {}
    for edge in BRIDGE_EDGES:
        _connect_bidirectionally(neighbor_map, edge.source, edge.target)
    return neighbor_map


def _connect_bidirectionally(neighbor_map: dict[str, set[str]], left: str, right: str) -> None:
    neighbor_map.setdefault(left, set()).add(right)
    neighbor_map.setdefault(right, set()).add(left)


def _slugify(value: str) -> str:
    return value.lower().replace("'", "").replace(" ", "-")


def _load_existing_doc_ids(table) -> set[str]:
    df = table.to_pandas()
    if df.empty:
        return set()
    return set(df["doc_id"].astype(str))


def _split_into_chunks(text: str) -> list[str]:
    chunks = [chunk.strip() for chunk in text.split("\n\n") if chunk.strip()]
    return chunks or [text.strip()]


def _match_chunk_concepts(chunk_text: str, concepts: tuple[str, ...]) -> list[str]:
    lowered = chunk_text.lower()
    matched = [concept for concept in concepts if concept.lower() in lowered]
    return matched if matched else list(concepts)


def _all_concepts(documents: list[DemoDocument], edges: list[DemoEdge]) -> set[str]:
    concepts = {concept for document in documents for concept in document.concepts}
    for edge in edges:
        concepts.add(edge.source)
        concepts.add(edge.target)
    return concepts


def _embed_demo_texts(texts: list[str]) -> list[list[float]]:
    if os.environ.get("BRAINBANK_DEMO_SEED_DETERMINISTIC") == "1":
        return [_deterministic_vector(text) for text in texts]
    return embed_texts(texts)


def _demo_color_score(concept_name: str) -> float:
    if os.environ.get("BRAINBANK_DEMO_SEED_DETERMINISTIC") == "1":
        digest = hashlib.sha256(concept_name.encode("utf-8")).digest()
        return digest[0] / 255.0
    return calculate_color_score(concept_name)


def _deterministic_vector(text: str) -> list[float]:
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    floats = [byte / 255.0 for byte in digest]
    return (floats * (VECTOR_DIM // len(floats) + 1))[:VECTOR_DIM]


def _build_concept_centroid_records(chunks_df) -> list[dict]:
    if chunks_df.empty:
        return []

    concept_vectors: dict[str, list[list[float]]] = {}
    concept_docs: dict[str, set[str]] = {}
    for row in chunks_df.itertuples(index=False):
        vector = [float(value) for value in row.vector]
        doc_id = str(row.doc_id)
        for concept in list(row.concepts):
            concept_vectors.setdefault(str(concept), []).append(vector)
            concept_docs.setdefault(str(concept), set()).add(doc_id)

    records = []
    for concept_name in sorted(concept_vectors):
        records.append(
            {
                "concept_name": concept_name,
                "centroid_vector": average_vectors(concept_vectors[concept_name]),
                "document_count": len(concept_docs[concept_name]),
            }
        )
    return records


def _build_community_summary_records(conn) -> list[dict]:
    result = conn.execute("MATCH (c:Concept) RETURN c.name, c.community_id")
    community_members: dict[int, list[str]] = {}
    while result.has_next():
        name, community_id = result.get_next()
        if community_id is None or int(community_id) < 0:
            continue
        community_members.setdefault(int(community_id), []).append(str(name))

    records = []
    for index, community_id in enumerate(sorted(community_members), start=1):
        member_concepts = tuple(sorted(community_members[community_id]))
        summary = _build_community_summary_text(member_concepts)
        records.append(
            {
                "community_id": f"community:{index:04d}",
                "member_concepts": list(member_concepts),
                "summary": summary,
                "summary_vector": _embed_demo_texts([summary])[0],
            }
        )
    return records


def _build_community_summary_text(member_concepts: tuple[str, ...]) -> str:
    preview = ", ".join(member_concepts[:6])
    if len(member_concepts) > 6:
        preview = f"{preview}, and {len(member_concepts) - 6} more"
    return f"This demo community connects related concepts such as {preview}."
