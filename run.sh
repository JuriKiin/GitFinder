#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
fi

source .venv/bin/activate

pip install -q -r requirements.txt

echo "Starting GitFinder at http://localhost:5050"
open http://localhost:5050 2>/dev/null || true
python app.py
