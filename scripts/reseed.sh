#!/bin/bash
#
# Reseed BrainBank
# ================
# WHEN TO USE: Nuclear option. Wipes all databases and rebuilds from scratch.
# Use this when the graph is too corrupted to fix incrementally, or when you
# want a clean slate after major schema/prompt changes.
#
# What it does:
#   1. Deletes data/kuzu, data/lancedb, and any leftover Kuzu WASM files
#   2. Seeds the mock demo dataset
#   3. Runs the full rebuild pipeline (consolidate + heal + reap + communities)
#   4. Runs the knowledge density audit to verify
#
# Usage:
#   chmod +x scripts/reseed.sh
#   ./scripts/reseed.sh
#
# IMPORTANT: Stop the backend server before running.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Load .env if present
if [ -f ".env" ]; then
  set -a
  source .env
  set +a
fi

if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "Error: GEMINI_API_KEY not set."
  echo "Add it to .env or run: export GEMINI_API_KEY=your_key_here"
  exit 1
fi

echo "=== BrainBank Reseed ==="
echo ""

# Step 1: Wipe databases
echo "Step 1: Wiping databases..."
rm -rf data/kuzu
rm -rf data/lancedb
# Clean up any leftover Kuzu WASM / lock files
find data/ -name "*.wasm" -delete 2>/dev/null || true
find data/ -name "lock" -delete 2>/dev/null || true
find data/ -name ".lock" -delete 2>/dev/null || true
echo "  Done."
echo ""

# Step 2: Seed demo data
echo "Step 2: Seeding mock demo data..."
python scripts/seed_mock_demo_data.py
echo ""

# Step 3: Rebuild pipeline
echo "Step 3: Running full rebuild pipeline..."
python scripts/rebuild_graphrag_artifacts.py
echo ""

# Step 4: Audit
echo "Step 4: Running knowledge density audit..."
python scripts/audit_knowledge_density.py
echo ""

echo "=== Reseed complete! ==="
echo "Start the server with: ./run.sh"
