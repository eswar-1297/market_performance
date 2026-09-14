@echo off
REM Marketing Performance Tracker - build the UI and start the app on http://localhost:4100
cd /d "%~dp0"
echo Installing dependencies (first run only)...
if not exist "server\node_modules" ( cd server && call npm install --no-audit --no-fund && cd .. )
if not exist "client\node_modules" ( cd client && call npm install --no-audit --no-fund && cd .. )
echo Building the interface...
cd client && call npm run build && cd ..
echo.
echo  Marketing Performance Tracker is starting on http://localhost:4100
echo  Press Ctrl+C to stop.
echo.
start "" http://localhost:4100
cd server && npm start
