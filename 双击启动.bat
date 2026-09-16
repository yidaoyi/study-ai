@echo off
cd /d "%~dp0"

set PORT=8765
set PY=

where python >nul 2>nul && set PY=python
if not defined PY (where py >nul 2>nul && set PY=py -3)
if not defined PY (
  echo [X] Python not found. Install Python 3 first.
  pause
  exit /b 1
)

echo ============================================
echo   ZhiYiBan local preview
echo   URL: http://127.0.0.1:%PORT%/index.html
echo   Keep this window open. Close it to stop.
echo ============================================

start "" "http://127.0.0.1:%PORT%/index.html"
%PY% -m http.server %PORT% --bind 127.0.0.1
pause
