import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from backend.db.kuzu import init_kuzu
from backend.db.lance import init_lancedb
from backend.services.embeddings import VECTOR_DIM

SAMPLE_NOTES_DIR = (
    Path(__file__).resolve().parents[2] / "sample_data" / "college_math_notes"
)


@dataclass(frozen=True)
class SampleRelationship:
    from_concept: str
    to_concept: str
    reason: str


@dataclass(frozen=True)
class SampleMathNote:
    doc_id: str
    title: str
    file_name: str
    concepts: tuple[str, ...]
    relationships: tuple[SampleRelationship, ...]
    text: str


def load_college_math_notes(
    sample_dir: Path = SAMPLE_NOTES_DIR,
) -> list[SampleMathNote]:
    catalog = json.loads((sample_dir / "catalog.json").read_text(encoding="utf-8"))
    notes: list[SampleMathNote] = []

    for entry in catalog:
        file_name = entry["file"]
        text = (sample_dir / file_name).read_text(encoding="utf-8").strip()
        relationships = tuple(
            SampleRelationship(
                from_concept=relationship["from"],
                to_concept=relationship["to"],
                reason=relationship["reason"],
            )
            for relationship in entry["relationships"]
        )
        notes.append(
            SampleMathNote(
                doc_id=entry["doc_id"],
                title=entry["title"],
                file_name=file_name,
                concepts=tuple(entry["concepts"]),
                relationships=relationships,
                text=text,
            )
        )

    return notes


def seed_college_math_notes(
    lance_db_path: str = "./data/lancedb",
    kuzu_db_path: str = "./data/kuzu",
) -> dict[str, int]:
    notes = load_college_math_notes()
    _, table = init_lancedb(lance_db_path)
    kuzu_db, conn = init_kuzu(kuzu_db_path)

    try:
        existing_doc_ids = _load_existing_doc_ids(table)
        seeded_documents = 0
        skipped_documents = 0

        for note in notes:
            if note.doc_id in existing_doc_ids:
                skipped_documents += 1
            else:
                table.add(_build_chunk_records(note))
                seeded_documents += 1
                existing_doc_ids.add(note.doc_id)

            for concept in note.concepts:
                conn.execute(
                    "MERGE (c:Concept {name: $name})",
                    parameters={"name": concept},
                )

            for relationship in note.relationships:
                conn.execute(
                    "MERGE (a:Concept {name: $from_name})",
                    parameters={"from_name": relationship.from_concept},
                )
                conn.execute(
                    "MERGE (b:Concept {name: $to_name})",
                    parameters={"to_name": relationship.to_concept},
                )
                conn.execute(
                    "MATCH (a:Concept {name: $from_name}), "
                    "(b:Concept {name: $to_name}) "
                    "CREATE (a)-[:RELATED_TO {reason: $reason}]->(b)",
                    parameters={
                        "from_name": relationship.from_concept,
                        "to_name": relationship.to_concept,
                        "reason": relationship.reason,
                    },
                )

        return {
            "seeded_documents": seeded_documents,
            "skipped_documents": skipped_documents,
        }
    finally:
        conn.close()
        kuzu_db.close()


def _load_existing_doc_ids(table) -> set[str]:
    df = table.to_pandas()

    if df.empty:
        return set()

    return set(df["doc_id"].astype(str))


def _build_chunk_records(note: SampleMathNote) -> list[dict]:
    records = []

    for index, chunk in enumerate(_split_markdown_into_chunks(note.text), start=1):
        records.append(
            {
                "chunk_id": f"{note.doc_id}:chunk:{index}",
                "doc_id": note.doc_id,
                "doc_name": note.title,
                "text": chunk,
                "concepts": _match_chunk_concepts(chunk, note.concepts),
                "vector": _deterministic_vector(f"{note.doc_id}:{index}:{chunk}"),
            }
        )

    return records


def _split_markdown_into_chunks(text: str) -> list[str]:
    chunks = [chunk.strip() for chunk in text.split("\n\n") if chunk.strip()]
    return chunks or [text.strip()]


def _match_chunk_concepts(chunk: str, concepts: tuple[str, ...]) -> list[str]:
    lowered_chunk = chunk.lower()
    matched = [concept for concept in concepts if concept.lower() in lowered_chunk]
    return matched if matched else list(concepts)


def _deterministic_vector(seed_text: str) -> list[float]:
    digest = hashlib.sha256(seed_text.encode("utf-8")).digest()
    floats = [byte / 255.0 for byte in digest]
    return (floats * (VECTOR_DIM // len(floats) + 1))[:VECTOR_DIM]
