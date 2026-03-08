import subprocess
import sys
from pathlib import Path

from backend.db.kuzu import init_kuzu
from backend.db.lance import init_lancedb
from backend.sample_data.college_math_notes import (
    load_college_math_notes,
    seed_college_math_notes,
)


class TestLoadCollegeMathNotes:
    def test_loads_multiple_sample_documents(self):
        notes = load_college_math_notes()

        assert len(notes) >= 6
        assert len({note.doc_id for note in notes}) == len(notes)
        assert "Calculus I - Limits and Continuity Review" in {
            note.title for note in notes
        }
        assert any("epsilon-delta" in note.text.lower() for note in notes)


class TestSeedCollegeMathNotes:
    def test_seeds_documents_into_temp_databases(self, lance_path, kuzu_path):
        summary = seed_college_math_notes(lance_db_path=lance_path, kuzu_db_path=kuzu_path)

        assert summary["seeded_documents"] >= 6
        assert summary["skipped_documents"] == 0

        _, table = init_lancedb(lance_path)
        df = table.to_pandas()

        assert len(df["doc_id"].unique()) >= 6
        assert "Calculus I - Limits and Continuity Review" in set(df["doc_name"])

        kuzu_db, conn = init_kuzu(kuzu_path)
        result = conn.execute("MATCH (c:Concept {name: 'Derivatives'}) RETURN count(c)")

        assert result.has_next()
        assert result.get_next()[0] == 1

        conn.close()
        kuzu_db.close()

    def test_skips_existing_documents_on_repeat_seed(self, lance_path, kuzu_path):
        first_summary = seed_college_math_notes(
            lance_db_path=lance_path,
            kuzu_db_path=kuzu_path,
        )
        second_summary = seed_college_math_notes(
            lance_db_path=lance_path,
            kuzu_db_path=kuzu_path,
        )

        assert first_summary["seeded_documents"] >= 6
        assert second_summary["seeded_documents"] == 0
        assert second_summary["skipped_documents"] == len(load_college_math_notes())

    def test_seed_script_runs_from_repo_root(self, lance_path, kuzu_path):
        repo_root = Path(__file__).resolve().parents[2]
        result = subprocess.run(
            [
                sys.executable,
                "scripts/seed_college_math_notes.py",
                "--lance-db-path",
                lance_path,
                "--kuzu-db-path",
                kuzu_path,
            ],
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=False,
        )

        assert result.returncode == 0
        assert "Seeded" in result.stdout
