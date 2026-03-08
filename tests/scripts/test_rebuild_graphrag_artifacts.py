from unittest.mock import patch

import scripts.rebuild_graphrag_artifacts as rebuild_script


class TestRebuildGraphRagArtifactsScript:
    def test_main_runs_rebuild_and_consolidation_cleanup(self, capsys):
        with patch.object(
            rebuild_script,
            "rebuild_graphrag_artifacts",
            return_value={"concept_centroids": 7, "communities": 2},
        ) as mock_rebuild:
            with patch.object(
                rebuild_script,
                "run_consolidation_cleanup",
                return_value={"merged_count": 3, "renamed_count": 4},
            ) as mock_cleanup:
                exit_code = rebuild_script.main()

        assert exit_code == 0
        mock_rebuild.assert_called_once_with()
        mock_cleanup.assert_called_once_with()

        output = capsys.readouterr().out
        assert "concept centroids" in output
        assert "communities" in output
        assert "concept merges=3" in output
        assert "canonical renames=4" in output
