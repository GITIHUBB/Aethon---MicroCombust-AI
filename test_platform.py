import contextlib
import io
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import ingest
import main


class BackendQueryTests(unittest.TestCase):
    def test_greetings_skip_retrieval(self):
        with patch.object(main, "similarity_search") as search:
            response = main.query_agent(main.QueryRequest(query="hello"))

        search.assert_not_called()
        self.assertIn("AETHON", response["answer"])
        self.assertEqual(response["passages_used"], 0)

    def test_empty_retrieval_uses_concise_clarification(self):
        with patch.object(main, "similarity_search", return_value=[]):
            response = main.query_agent(
                main.QueryRequest(query="compare combustion regimes")
            )

        self.assertIn("clarify", response["answer"])
        self.assertNotIn("BASS", response["answer"])
        self.assertLessEqual(len(response["answer"].split(". ")), 2)

    def test_typo_normalization_and_identifier_boost(self):
        self.assertEqual(
            main._normalize_query("mcro flm grafity PMMA"),
            "microgravity flame gravity Polymethyl Methacrylate PMMA",
        )
        self.assertEqual(
            main._normalize_query("DALT investigaton"),
            "DALT investigation",
        )
        documents = [
            {"metadata": {"source": "other.pdf"}, "page_content": "General burning"},
            {"metadata": {"source": "psi62.pdf"}, "page_content": "PSI-62 PMMA results"},
        ]
        with patch.object(main, "_cohere_ranks", return_value=[0, 1]):
            ranked = main.rerank("PMMA PSI-62", documents, top_k=2)
        self.assertEqual(ranked[0]["metadata"]["source"], "psi62.pdf")

    def test_search_uses_eight_normalized_candidates_and_filters_weak_matches(self):
        class FakeCollection:
            def query(self, **kwargs):
                self.kwargs = kwargs
                return {
                    "documents": [["weak", "PMMA in microgravity"]],
                    "metadatas": [[{"source": "weak.pdf"}, {"source": "pmma.pdf"}]],
                    "distances": [[1.31, 1.30]],
                }

        collection = FakeCollection()
        with (
            patch.object(main, "get_collection", return_value=collection),
            patch.object(main, "rerank", side_effect=lambda _query, docs, _k: docs),
        ):
            results = main.similarity_search("mcro flm grafity PMMA")

        self.assertEqual(collection.kwargs["n_results"], 8)
        self.assertEqual(
            collection.kwargs["query_texts"],
            ["microgravity flame gravity Polymethyl Methacrylate PMMA"],
        )
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["metadata"]["source"], "pmma.pdf")

    def test_answer_has_clean_final_references(self):
        docs = [
            {
                "metadata": {"source": "PSI-108_doc_1_flame.pdf"},
                "page_content": "Research passage",
            }
        ]
        answer = main._append_clean_references(
            "The result is documented [PSI-108_doc_1_flame.pdf · p.N/A].", docs
        )
        self.assertNotIn(".pdf", answer)
        self.assertEqual(answer.count("### 📚 Referenced NASA Papers & Datasets"), 1)


class IngestionTests(unittest.TestCase):
    def test_cleaning_and_template_detection(self):
        cleaned = ingest._clean_text("micro-\ngravity flame\n\n\nspread")
        self.assertEqual(cleaned, "microgravity flame\n\nspread")
        self.assertTrue(ingest._is_placeholder("paper.txt", "Do not use this form"))
        self.assertTrue(ingest._is_placeholder("s_PSI-62.txt", "template"))
        self.assertFalse(ingest._is_placeholder("paper.txt", "NASA research text"))

    def test_reset_clears_old_collections_and_skips_templates(self):
        class FakeCollection:
            def __init__(self):
                self.documents = []

            def upsert(self, **kwargs):
                self.documents.extend(kwargs["documents"])

        class FakeClient:
            def __init__(self):
                self.collections = {}
                self.deleted = []

            def list_collections(self):
                return [type("Existing", (), {"name": "old"})()]

            def delete_collection(self, name):
                self.deleted.append(name)

            def get_or_create_collection(self, name):
                return self.collections.setdefault(name, FakeCollection())

        class FakeModel:
            def encode(self, chunks):
                return type("Embeddings", (), {"tolist": lambda self: [[0.0] for _ in chunks]})()

        with tempfile.TemporaryDirectory() as temporary_directory:
            papers = Path(temporary_directory)
            (papers / "s_PSI-62.txt").write_text("template content" * 20)
            (papers / "placeholder.txt").write_text("Do not use this template" * 10)
            (papers / "research.txt").write_text("NASA combustion research " * 20)
            client = FakeClient()
            with (
                patch.object(ingest, "PAPERS_DIR", temporary_directory),
                patch.object(ingest.chromadb, "PersistentClient", return_value=client),
                patch.dict(
                    sys.modules,
                    {
                        "sentence_transformers": types.SimpleNamespace(
                            SentenceTransformer=lambda _name: FakeModel()
                        )
                    },
                ),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                ingest.run_ingestion(reset=True)

        self.assertEqual(client.deleted, ["old"])
        self.assertTrue(client.collections["langchain"].documents)
        self.assertEqual(
            len(client.collections["langchain"].documents),
            len(client.collections["microcombust_papers"].documents),
        )


if __name__ == "__main__":
    unittest.main()
