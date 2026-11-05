@echo off
cd /d "%~dp0"
native\rium-download-host.exe --install
if errorlevel 1 (
 echo Installation failed. Please keep this window open and report the message.
 pause
)
