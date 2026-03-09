import kuzu
import lancedb

def purge_zombies(kuzu_path="./data/kuzu", lancedb_path="./data/lancedb"):
    print("🧹 Starting Zombie Purge...")
    
    # 1. Connect
    db = kuzu.Database(kuzu_path)
    conn = kuzu.Connection(db)
    ldb = lancedb.connect(lancedb_path)
    chunks_table = ldb.open_table("chunks")
    
    # 2. Get the Ground Truth (LanceDB)
    df = chunks_table.to_pandas()
    # Count distinct doc_ids per concept
    true_counts = df.explode("concepts").groupby("concepts")["doc_id"].nunique().to_dict()
    
    # 3. Get all concepts in Kuzu
    kuzu_nodes = conn.execute("MATCH (c:Concept) RETURN c.name").get_as_df()
    all_kuzu_concepts = kuzu_nodes["c.name"].tolist()
    
    purged_count = 0
    
    for concept in all_kuzu_concepts:
        count = true_counts.get(concept, 0)
        
        if count == 0:
            # 🧟 ZOMBIE FOUND: Exists in Graph but has no Documents
            print(f"💀 Purging Zombie: {concept}")
            conn.execute("MATCH (c:Concept {name: $name}) DETACH DELETE c", {"name": concept})
            purged_count += 1
        elif count < 3:
            # 🐥 ORPHAN FOUND: Should have been reaped by your Reaper
            print(f"🐣 Note: {concept} is an Orphan ({count} docs). Run the Reaper next.")

    print(f"\n✨ Purge Complete. Removed {purged_count} zombie nodes.")

if __name__ == "__main__":
    purge_zombies()