from unittest.mock import patch

import scripts.print_lancedb_chunks as print_chunks_script


class TestRenderChunks:
    def test_renders_chunk_metadata_without_vector_by_default(self):
        output = print_chunks_script.render_chunks([
            {
                "chunk_id": "chunk-1",
                "doc_id": "doc-1",
                "doc_name": "Study Notes",
                "text": "Limits describe behavior near a point.",
                "concepts": ["Calculus", "Limits"],
                "vector": [0.1, 0.2],
            }
        ])

        assert "chunk_id: chunk-1" in output
        assert "doc_name: Study Notes" in output
        assert "concepts: Calculus, Limits" in output
        assert "text: Limits describe behavior near a point." in output
        assert "vector:" not in output

    def test_renders_no_chunks_message_for_empty_results(self):
        output = print_chunks_script.render_chunks([])
        assert output == "No chunks found."


class TestMain:
    def test_main_prints_rendered_chunks(self, capsys):
        with patch.object(
            print_chunks_script,
            "list_chunk_records",
            return_value=[
                {
                    "chunk_id": "chunk-1",
                    "doc_id": "doc-1",
                    "doc_name": "Study Notes",
                    "text": "Derivative rules chunk",
                    "concepts": ["Calculus"],
                    "vector": [0.1, 0.2],
                }
            ],
        ) as mock_list:
            exit_code = print_chunks_script.main([])

        assert exit_code == 0
        mock_list.assert_called_once_with("./data/lancedb", doc_id=None)
        output = capsys.readouterr().out
        assert "Derivative rules chunk" in output
