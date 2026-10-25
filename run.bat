@echo off
rem Starts a local web server for the game and opens it in your browser.
cd /d "%~dp0"
start "" http://localhost:8000
python -m http.server 8000 || npx --yes http-server -p 8000 -c-1
