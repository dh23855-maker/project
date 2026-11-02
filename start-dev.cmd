@echo off
REM Starts the API server and the web screen, then opens the browser.
REM Double-click this file, or run it from the project folder.
REM Close the two black windows (backend, frontend) to stop everything.
cd /d "%~dp0"

if not exist "backend\.venv\Scripts\python.exe" (
  echo [!] backend\.venv not found. See backend\README.md first.
  pause
  exit /b 1
)
if not exist "frontend\node_modules" (
  echo [!] frontend\node_modules not found. Run "npm install" in the frontend folder first.
  pause
  exit /b 1
)

start "backend" /D "%~dp0backend" cmd /k ".venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --port 8000"
start "frontend" /D "%~dp0frontend" cmd /k "npm run dev"
echo Two windows were opened (backend, frontend). The browser opens at http://localhost:5173 in a few seconds.
