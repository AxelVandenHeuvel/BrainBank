from backend.retrieval.routing import QueryRoute, classify_query_route


class TestRouting:
    def test_routes_summary_question_to_global(self):
        assert classify_query_route("Give me a high level overview across the corpus") == QueryRoute.GLOBAL

    def test_routes_specific_question_to_local(self):
        assert classify_query_route("How is calculus connected to derivatives?") == QueryRoute.LOCAL
