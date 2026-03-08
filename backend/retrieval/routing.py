from backend.retrieval.types import QueryRoute


GLOBAL_ROUTE_KEYWORDS = (
    "overview",
    "summarize",
    "summary",
    "main themes",
    "main ideas",
    "big picture",
    "high level",
    "across my notes",
    "across the corpus",
)


def normalize_query_text(query: str) -> str:
    return " ".join(query.lower().split())


def classify_query_route(query: str) -> QueryRoute:
    normalized = normalize_query_text(query)
    if any(keyword in normalized for keyword in GLOBAL_ROUTE_KEYWORDS):
        return QueryRoute.GLOBAL
    return QueryRoute.LOCAL
