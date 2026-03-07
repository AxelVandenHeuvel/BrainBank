#!/bin/bash
# BrainBank - Start both backend and frontend

# Check for GEMINI_API_KEY
if [ -z "$GEMINI_API_KEY" ]; then
  echo "Error: GEMINI_API_KEY not set"
  echo "Run: export GEMINI_API_KEY=your_key_here"
  exit 1
fi

# Install deps if needed
if [ ! -d ".venv" ]; then
  echo "Setting up Python environment..."
  uv venv && uv pip install -e ".[dev]"
fi

if [ ! -d "frontend/node_modules" ]; then
  echo "Installing frontend dependencies..."
  cd frontend && npm install && cd ..
fi

# Start backend in background
echo "Starting backend on :8000..."
uv run uvicorn backend.api:app --reload --port 8000 &
BACKEND_PID=$!

# Start frontend
echo "Starting frontend on :5173..."
cd frontend && npm run dev &
FRONTEND_PID=$!

# Cleanup on exit
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT

echo ""
echo "BrainBank is running!"
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop."

wait
