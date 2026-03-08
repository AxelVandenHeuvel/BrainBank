import igraph
import leidenalg
import kuzu


def run_leiden_clustering(conn: kuzu.Connection) -> dict[str, int]:
    """Run Leiden community detection on the Concept graph.

    Queries all RELATED_TO edges with their weights, builds an undirected
    igraph graph, runs Leiden with ModularityVertexPartition (weighted), and
    returns a mapping of concept_name -> community_id (int).

    Handles small graphs (< 2 nodes) gracefully without crashing.
    """
    node_result = conn.execute("MATCH (c:Concept) RETURN c.name")
    names: list[str] = []
    while node_result.has_next():
        names.append(node_result.get_next()[0])

    if not names:
        return {}

    if len(names) == 1:
        return {names[0]: 0}

    edge_result = conn.execute(
        "MATCH (a:Concept)-[r:RELATED_TO]->(b:Concept) RETURN a.name, b.name, r.weight"
    )
    raw_edges: list[tuple[str, str, float]] = []
    while edge_result.has_next():
        a, b, w = edge_result.get_next()
        raw_edges.append((a, b, float(w) if w is not None else 1.0))

    name_to_idx = {name: i for i, name in enumerate(names)}

    edge_list = [
        (name_to_idx[a], name_to_idx[b])
        for a, b, _ in raw_edges
        if a in name_to_idx and b in name_to_idx
    ]
    weights = [
        w
        for a, b, w in raw_edges
        if a in name_to_idx and b in name_to_idx
    ]

    g = igraph.Graph(n=len(names), edges=edge_list, directed=False)
    if weights:
        g.es["weight"] = weights

    weight_attr = "weight" if weights else None
    partition = leidenalg.find_partition(
        g,
        leidenalg.ModularityVertexPartition,
        weights=weight_attr,
    )

    community_map: dict[str, int] = {}
    for community_id, community in enumerate(partition):
        for vertex_idx in community:
            community_map[names[vertex_idx]] = community_id

    return community_map
