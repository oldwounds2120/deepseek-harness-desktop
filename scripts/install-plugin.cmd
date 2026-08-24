@echo off
setlocal EnableExtensions
title DeepSeek Harness Desktop - dsh plugin manager

rem ============================================================
rem  dsh plugin helper for DeepSeek Harness Desktop
rem
rem  Usage:
rem    install-plugin.cmd add <package>       install a plugin
rem    install-plugin.cmd remove <package>    uninstall a plugin
rem    install-plugin.cmd update <package>    update a plugin
rem    install-plugin.cmd list                list installed plugins
rem  Run without arguments to print this help.
rem
rem  Works no matter where the app is installed: the script locates
rem  the installation directory by its own location, so it must stay
rem  next to the app (app root or <app>/resources).
rem ============================================================

rem ---- resolve app root (script in app root or <app>/resources) ----
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "APP_ROOT="
if exist "%SCRIPT_DIR%\resources\runtime\node" set "APP_ROOT=%SCRIPT_DIR%"
if not defined APP_ROOT if exist "%SCRIPT_DIR%\..\resources\runtime\node" set "APP_ROOT=%SCRIPT_DIR%\.."
if not defined APP_ROOT (
  echo [ERROR] Cannot locate the app installation directory.
  echo         Expected "resources\runtime\node" next to this script.
  echo         Keep this script in the app directory, or in <app>\resources.
  pause
  exit /b 1
)
set "RUNTIME=%APP_ROOT%\resources\runtime"

rem ---- locate node.exe (version dir may change between releases) ----
set "NODE_EXE="
for /d %%D in ("%RUNTIME%\node\node-*") do if not defined NODE_EXE set "NODE_EXE=%%D\node.exe"
if not defined NODE_EXE if exist "%RUNTIME%\node\node.exe" set "NODE_EXE=%RUNTIME%\node\node.exe"
if not defined NODE_EXE (
  echo [ERROR] node.exe not found under "%RUNTIME%\node"
  pause
  exit /b 1
)

rem ---- locate dsh CLI entry ----
set "DSH_BIN=%RUNTIME%\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js"
if not exist "%DSH_BIN%" (
  echo [ERROR] dsh entry not found: "%DSH_BIN%"
  echo         The runtime may have changed layout in a newer release.
  pause
  exit /b 1
)

rem ---- DSH_HOME: respect an explicit override, else fixed userData ----
if not defined DSH_HOME set "DSH_HOME=%APPDATA%\DeepSeek Harness Desktop\dsh-home"
if not exist "%DSH_HOME%" mkdir "%DSH_HOME%" >nul 2>&1

rem ---- make sure pnpm is resolvable (global pnpm preferred) ----
set "SHIM_DIR=%TEMP%\dsh-plugin-pnpm"
where pnpm >nul 2>&1
if errorlevel 1 (
  set "PNPM_CJS="
  if exist "%RUNTIME%\pnpm\package\bin\pnpm.cjs" set "PNPM_CJS=%RUNTIME%\pnpm\package\bin\pnpm.cjs"
  if not defined PNPM_CJS if exist "%RUNTIME%\pnpm\pnpm.cjs" set "PNPM_CJS=%RUNTIME%\pnpm\pnpm.cjs"
  if not defined PNPM_CJS (
    echo [ERROR] pnpm not found on PATH nor in the bundled runtime.
    pause
    exit /b 1
  )
  if not exist "%SHIM_DIR%" mkdir "%SHIM_DIR%" >nul 2>&1
  > "%SHIM_DIR%\pnpm.cmd" echo @echo off
  >>"%SHIM_DIR%\pnpm.cmd" echo "%NODE_EXE%" "%PNPM_CJS%" %%*
  set "PATH=%SHIM_DIR%;%PATH%"
)

rem ---- parse arguments (subcommand is required) ----
set "CMD=%~1"
set "PKG="
if "%CMD%"=="" goto :usage
shift
set "PKG=%~1"
if /i not "%CMD%"=="add" if /i not "%CMD%"=="remove" if /i not "%CMD%"=="update" if /i not "%CMD%"=="list" goto :usage
if /i not "%CMD%"=="list" if "%PKG%"=="" goto :usage

:run
if /i "%CMD%"=="list" goto :exec
rem ---- refuse to touch the profile while dsh is running ----
powershell -NoProfile -Command "exit (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*bin.js*' }).Count" >nul 2>&1
if errorlevel 1 (
  echo [WARN] dsh seems to be running.
  echo        Please quit the app first: right-click the tray icon and choose Exit.
  pause
  exit /b 1
)

:exec
echo.
echo [dsh-plugin] app    : %APP_ROOT%
echo [dsh-plugin] DSH_HOME: %DSH_HOME%
echo [dsh-plugin] command: %CMD% %PKG%
echo.
"%NODE_EXE%" "%DSH_BIN%" plugin --profile web %CMD% %PKG%
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  if /i not "%CMD%"=="list" echo [OK] done. Restart the app from the tray to load changes.
) else (
  echo [FAILED] pnpm exited with code %RC%. See the output above.
)
pause
exit /b %RC%

:usage
echo.
echo dsh plugin manager for DeepSeek Harness Desktop
echo.
echo Usage:
echo   install-plugin.cmd add ^<package^>      install a plugin
echo   install-plugin.cmd remove ^<package^>   uninstall a plugin
echo   install-plugin.cmd update ^<package^>   update a plugin
echo   install-plugin.cmd list                list installed plugins
echo.
echo Example:
echo   install-plugin.cmd add dshmarket
pause
exit /b 1
