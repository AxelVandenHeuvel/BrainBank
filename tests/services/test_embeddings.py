from backend.db.lance import init_lancedb
from backend.services.embeddings import calculate_document_centroid


def test_calculate_document_centroid_returns_mean_vector(lance_path):
    _, table = init_lancedb(lance_path)
    table.add([
        {
            "chunk_id": "c1",
            "doc_id": "d1",
            "doc_name": "Doc",
            "text": "a",
            "concepts": [],
            "vector": [1.0] + [0.0] * 383,
        },
        {
            "chunk_id": "c2",
            "doc_id": "d1",
            "doc_name": "Doc",
            "text": "b",
            "concepts": [],
            "vector": [3.0] + [0.0] * 383,
        },
    ])

    centroid = calculate_document_centroid("d1", table)

    assert len(centroid) == 384
    assert centroid[0] == 2.0
    assert all(value == 0.0 for value in centroid[1:])


def test_calculate_document_centroid_returns_zero_vector_for_missing_doc(lance_path):
    _, table = init_lancedb(lance_path)

    centroid = calculate_document_centroid("missing", table)

    assert len(centroid) == 384
    assert all(value == 0.0 for value in centroid)
