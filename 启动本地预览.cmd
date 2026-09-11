@echo off
setlocal
cd /d "%~dp0"
set "WORKBENCH_NODE=node"
where node >nul 2>nul
if errorlevel 1 set "WORKBENCH_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "node_modules\vite\bin\vite.js" (
  echo Project dependencies are missing. Run pnpm install --frozen-lockfile first.
  pause
  exit /b 1
)
"%WORKBENCH_NODE%" -e "const r=require('node:http').get('http://127.0.0.1:5176/',s=>{s.resume();process.exit(s.statusCode===200?0:1)});r.on('error',()=>process.exit(1));r.setTimeout(2000,()=>{r.destroy();process.exit(1)});"
if not errorlevel 1 (
  start "" "http://127.0.0.1:5176/"
  exit /b 0
)
echo Local preview: http://127.0.0.1:5176/
echo Keep this window open while using the preview. Press Ctrl+C to stop.
"%WORKBENCH_NODE%" "node_modules\vite\bin\vite.js" --host 127.0.0.1 --port 5176 --strictPort --open
if errorlevel 1 pause
