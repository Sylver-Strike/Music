@echo off
cd /d "%~dp0"
echo Starting SonicFetch Backend...
echo ---------------------------------------------------
echo Make sure your Android App's API_BASE_URL matches your IP!
echo Local PC IP (for emulator): 10.0.2.2
echo ---------------------------------------------------
npm start
pause
