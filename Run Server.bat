@echo off
TITLE Project Launcher

:: 1. Run npm install first (must finish before starting)
echo Running npm install...
powershell -Command "npm install"

:: 2. Configure ngrok authtoken
echo Configuring ngrok token...
ngrok config add-authtoken 3AVOU63MVMCjw7FxHDF8zD42uLH_7Gwa21ugoMq4e3YkgZDuZ

:: 3. Launch ngrok in a NEW window
echo Launching ngrok in a separate window...
start cmd /k "ngrok http 3000"

:: 4. Launch npm start in the CURRENT window
echo Starting the application...
powershell -Command "npm start"

pause