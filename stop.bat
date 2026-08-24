@echo off
rem start.bat runs the proxy with no visible window (see tray.ps1) and puts a "SWAGINO
rem proxy" icon in the system tray instead - right-click it and choose Stop server, or
rem run this if that's not handy.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop_proxy.ps1"
pause
