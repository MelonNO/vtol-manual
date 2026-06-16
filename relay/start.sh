#!/bin/bash
# Start the VTOL relay coverage map server.
# Runs on http://0.0.0.0:5000 — browse to http://localhost:5000 or http://<pi-ip>:5000

cd "$(dirname "$0")"

# Install dependencies if missing
if ! python3 -c "import flask, requests, pymavlink" 2>/dev/null; then
    pip3 install -r requirements.txt
fi

python3 -u app.py
