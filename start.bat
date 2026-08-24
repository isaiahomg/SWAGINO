@echo off
setlocal enableextensions
cd /d "%~dp0"

rem --- Re-launch this same script with no visible console (see hidden.vbs), then exit. A
rem     double-clicked .bat always briefly owns a console window before it can do this - that
rem     instant flash is a cmd.exe limitation, not something a batch file can suppress from
rem     inside itself; everything AFTER this relaunch (the proxy, the wait loop) stays hidden. ---
if "%~1"=="/hidden" goto :run
start "" wscript.exe "%~dp0hidden.vbs" "%~f0" "/hidden"
exit /b

:run
set "PORT=8787"
set "URL=http://localhost:%PORT%/swagino.html"

rem --- If the proxy is already running, open the browser immediately ---
curl -s -o nul --max-time 2 "http://localhost:%PORT%/" >nul 2>&1
if not errorlevel 1 goto :open

rem --- Start the proxy with no visible window; its output goes to proxy.log instead of a
rem     console. tray.ps1 owns the proxy process and puts a "SWAGINO proxy" icon in the
rem     system tray - right-click it (or run stop.bat) to stop the server. ---
wscript.exe "%~dp0hidden.vbs" "powershell" "-NoProfile" "-ExecutionPolicy" "Bypass" "-WindowStyle" "Hidden" "-File" "%~dp0tray.ps1"

rem --- Open the browser the instant the port accepts connections (no fixed wait = no lag) ---
set /a n=0
:wait
curl -s -o nul --max-time 2 "http://localhost:%PORT%/" >nul 2>&1
if not errorlevel 1 goto :open
set /a n+=1
if %n% geq 150 goto :timeout
ping -n 1 -w 100 192.0.2.1 >nul 2>&1
goto :wait

:open
start "" "%URL%"
goto :eof

:timeout
rem Running hidden means there's no window left to show this in, or to "pause" - a pause here
rem would just hang an invisible, unclosable process. Log it instead.
> "%~dp0start_error.log" (
  echo Could not reach %URL% within ~15 seconds.
  echo Make sure Python is installed and on your PATH, then run:  python proxy.py
)
goto :eof
