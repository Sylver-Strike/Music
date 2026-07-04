@echo off
setlocal
cd /d "%~dp0"

echo ===================================================
echo   SonicFetch: Installing Java (JDK 17)
echo ===================================================
echo This will download a portable JDK to make the Android build work.
echo.

set "JDK_ZIP=jdk.zip"
set "JDK_DIR=jdk"
set "JDK_URL=https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.10%%2B7/OpenJDK17U-jdk_x64_windows_hotspot_17.0.10_7.zip"

if exist "%JDK_DIR%" (
    echo JDK already exists in %JDK_DIR%.
    goto DONE
)

echo [1/2] Downloading JDK 17... (This may take a minute)
powershell -Command "Invoke-WebRequest -Uri '%JDK_URL%' -OutFile '%JDK_ZIP%'"

if not exist "%JDK_ZIP%" (
    echo [ERROR] Download failed. Please check your internet connection.
    pause
    exit /b 1
)

echo [2/2] Extracting JDK...
powershell -Command "Expand-Archive -Path '%JDK_ZIP%' -DestinationPath '%JDK_DIR%'"
del "%JDK_ZIP%"

:: Move contents up if it created a subfolder
for /d %%i in ("%JDK_DIR%\jdk*") do (
    xcopy /E /I /Y "%%i\*" "%JDK_DIR%\"
    rd /S /Q "%%i"
)

echo.
echo ===================================================
echo   Installation Successful!
echo ===================================================
echo Java has been installed in your project folder.
echo You can now use automate.bat to build your APK.
echo.

:DONE
pause
