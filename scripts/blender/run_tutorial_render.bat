@echo off
setlocal
cd /d "%~dp0..\.."
set "BLENDER=C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
set "OBJ=%USERPROFILE%\Downloads\bayard-station-valve-house\source\model.zip"
set "OUT=%CD%\public\tutorial"
set "LOG=%OUT%\blender_render.log"

if not exist "%BLENDER%" (
  echo Could not find Blender at "%BLENDER%"
  pause
  exit /b 1
)
if not exist "%OBJ%" (
  echo Could not find model zip at "%OBJ%"
  pause
  exit /b 1
)

if not exist "%OUT%" mkdir "%OUT%"
echo Starting Bayard tutorial render...
echo Log: "%LOG%"
echo Leave this window open. It will write spawn.jpg, gutter.jpg, and walk.mp4.
echo.

"%BLENDER%" --background --python "%CD%\scripts\blender\render_bayard_tutorial.py" -- --obj "%OBJ%" --out "%OUT%" > "%LOG%" 2>&1

echo.
echo Exit code %ERRORLEVEL%
if exist "%OUT%\RENDER_DONE.txt" (
  echo Finished. See "%OUT%\RENDER_DONE.txt"
) else (
  echo Did not finish cleanly. Check "%LOG%"
)
pause
