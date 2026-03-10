#!/bin/bash
# Script to build the Python backend as a standalone executable for Electron

# Ensure we're in the project root
cd "$(dirname "$0")/.."

echo "Building Python backend..."

# Create a clean dist directory for the backend
mkdir -p backend/dist

# Use PyInstaller to bundle the backend
# --onefile: Create a single executable
# --name: Name of the executable
# --distpath: Where to put the final executable
# --collect-all: Ensure native binaries for kuzu and lancedb are included
uv run pyinstaller --onefile \
    --name brainbank-backend \
    --distpath frontend/electron/bin \
    --collect-all kuzu \
    --collect-all lancedb \
    --collect-all pyarrow \
    --hidden-import backend.api \
    --hidden-import uvicorn.logging \
    --hidden-import uvicorn.loops \
    --hidden-import uvicorn.loops.auto \
    --hidden-import uvicorn.protocols \
    --hidden-import uvicorn.protocols.http \
    --hidden-import uvicorn.protocols.http.auto \
    --hidden-import uvicorn.protocols.websockets \
    --hidden-import uvicorn.protocols.websockets.auto \
    --hidden-import uvicorn.lifespan \
    --hidden-import uvicorn.lifespan.on \
    backend/server.py

echo "Backend build complete: dist/brainbank-backend"
