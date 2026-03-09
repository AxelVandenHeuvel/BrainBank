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
#   .\scripts\reseed.ps1
#
# IMPORTANT: Stop the backend server before running.

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $RepoRoot

# Load .env if present
if (Test-Path ".env") {
    Get-Content ".env" | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            [Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), "Process")
        }
    }
}

if (-not $env:GEMINI_API_KEY) {
    Write-Host "Error: GEMINI_API_KEY not set." -ForegroundColor Red
    Write-Host "Add it to .env or run: `$env:GEMINI_API_KEY = 'your_key_here'"
    exit 1
}

Write-Host "=== BrainBank Reseed ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: Wipe databases
Write-Host "Step 1: Wiping databases..." -ForegroundColor Yellow
if (Test-Path "data\kuzu") { Remove-Item -Recurse -Force "data\kuzu" }
if (Test-Path "data\lancedb") { Remove-Item -Recurse -Force "data\lancedb" }
# Clean up any leftover Kuzu WASM / lock files
Get-ChildItem -Path "data" -Filter "*.wasm" -Recurse -ErrorAction SilentlyContinue | Remove-Item -Force
Get-ChildItem -Path "data" -Filter "lock" -Recurse -ErrorAction SilentlyContinue | Remove-Item -Force
Get-ChildItem -Path "data" -Filter ".lock" -Recurse -ErrorAction SilentlyContinue | Remove-Item -Force
Write-Host "  Done."
Write-Host ""

# Step 2: Seed demo data
Write-Host "Step 2: Seeding mock demo data..." -ForegroundColor Yellow
python scripts\seed_mock_demo_data.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host ""

# Step 3: Rebuild pipeline
Write-Host "Step 3: Running full rebuild pipeline..." -ForegroundColor Yellow
python scripts\rebuild_graphrag_artifacts.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host ""

# Step 4: Audit
Write-Host "Step 4: Running knowledge density audit..." -ForegroundColor Yellow
python scripts\audit_knowledge_density.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host ""

Write-Host "=== Reseed complete! ===" -ForegroundColor Green
Write-Host "Start the server with: ./run.sh (Mac/Linux) or uvicorn backend.api:app --reload --port 8000 (Windows)"
