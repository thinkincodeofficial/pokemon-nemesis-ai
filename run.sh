#!/usr/bin/env sh
# Starts a local web server for the game. Then open http://localhost:8000
cd "$(dirname "$0")"
echo "PokéAPI Nemesis running at http://localhost:8000 (Ctrl+C to stop)"
python3 -m http.server 8000 || python -m http.server 8000 || npx --yes http-server -p 8000 -c-1
