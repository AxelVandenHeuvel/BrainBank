import uvicorn
import os
import sys

# Add the parent directory to sys.path so we can import 'backend'
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.api import app

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    # In production, we might want to disable reload
    is_dev = os.environ.get("NODE_ENV") == "development"
    
    print(f"Starting BrainBank backend on port {port}...")
    uvicorn.run(app, host="127.0.0.1", port=port, reload=is_dev)
