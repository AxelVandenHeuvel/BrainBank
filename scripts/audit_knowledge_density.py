"""
Knowledge Integrity Audit for BrainBank.
Verifies that Kuzu (Graph) and LanceDB (Chunks) are in sync and 
that the 3-document minimum is strictly enforced.
"""

import lancedb
import kuzu
from tabulate import tabulate

def run_audit(kuzu_path="./data/kuzu", lancedb_path="./data/lancedb"):
    print("🔍 Starting Knowledge Integrity Audit...\n")
    
    # 1. Connect to Databases
    db = kuzu.Database(kuzu_path)
    conn = kuzu.Connection(db)
    ldb = lancedb.connect(lancedb_path)
    chunks_table = ldb.open_table("chunks")
    
    # 2. Get the Ground Truth from LanceDB
    # Extract every unique concept mentioned in chunks and count their occurrences
    df = chunks_table.to_pandas()
    # Explode concepts list and count distinct doc_ids per concept
    doc_counts = df.explode("concepts").groupby("concepts")["doc_id"].nunique()
    
    # 3. Get the Visualized Concepts from Kuzu
    kuzu_nodes = conn.execute("MATCH (c:Concept) RETURN c.name").get_as_df()
    kuzu_concept_set = set(kuzu_nodes["c.name"])
    
    # 4. Analysis
    orphans = []
    ghosts = []
    healthy_count = 0
    
    # Check every concept known to Kuzu
    for concept in kuzu_concept_set:
        count = doc_counts.get(concept, 0)
        if count < 3:
            orphans.append([concept, count])
        else:
            healthy_count += 1
            
    # Check for "Ghosts" (Concepts in chunks but missing from the graph)
    for concept in doc_counts.index:
        if concept not in kuzu_concept_set:
            ghosts.append([concept, doc_counts[concept]])

    # 5. Report Results
    print("--- 📊 AUDIT SUMMARY ---")
    print(f"✅ Healthy Concepts (3+ Docs): {healthy_count}")
    print(f"⚠️  Orphan Concepts (< 3 Docs):  {len(orphans)}")
    print(f"👻 Ghost Concepts (Missing from Graph): {len(ghosts)}")
    print("------------------------\n")

    if orphans:
        print("❌ ORPHANS DETECTED (Should have been Reaped):")
        print(tabulate(orphans, headers=["Concept", "Doc Count"], tablefmt="presto"))
        print("")

    if ghosts:
        print("🕵️ GHOSTS DETECTED (In documents but not in Graph):")
        print(tabulate(ghosts[:10], headers=["Concept", "Doc Count"], tablefmt="presto"))
        if len(ghosts) > 10:
            print(f"... and {len(ghosts) - 10} more.")
            
    if not orphans and not ghosts:
        print("🌟 PERFECT SYNC: Your knowledge graph is dense and consistent!")

if __name__ == "__main__":
    run_audit()