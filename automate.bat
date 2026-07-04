@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ===================================================
echo   SonicFetch Automation Tool
echo ===================================================

:MENU
echo 1. Sync Web Files to Android App
echo 2. Start Node.js Backend Server
echo 3. Run Android Build (Build APK)
echo 4. Full Setup (Sync + Start Server)
echo 5. Install Java (Fixes JAVA_HOME Error)
echo 6. Exit
echo.
set /p opt="Choose an option (1-6): "

if "%opt%"=="1" goto SYNC
if "%opt%"=="2" goto SERVER
if "%opt%"=="3" goto BUILD
if "%opt%"=="4" goto FULL
if "%opt%"=="5" goto INSTALL_JDK
if "%opt%"=="6" goto EXIT

:INSTALL_JDK
call install_jdk.bat
goto MENU

:SYNC
echo.
echo [1/1] Syncing public/ to android assets...
xcopy /E /I /Y "public\*" "android\app\src\main\assets\www\"
echo Done.
pause
goto MENU

:SERVER
echo.
echo Starting Backend...
start cmd /k "cd /d "%~dp0" && npm start"
goto MENU

:BUILD
echo.
echo Attempting to build APK...

:: Try to find Android SDK
if not exist "android\local.properties" (
    echo [INFO] local.properties missing. Attempting to locate Android SDK...
    set "SDK_PATH=C:\Users\%USERNAME%\AppData\Local\Android\Sdk"
    if exist "!SDK_PATH!" (
        echo sdk.dir=!SDK_PATH:\=/! > "android\local.properties"
        echo [SUCCESS] Located SDK and created local.properties
    ) else (
        echo [WARNING] Could not find Android SDK at default location.
        echo Please ensure Android Studio is installed and SDK is downloaded.
    )
)

:: Try to find Java if JAVA_HOME is not set
if "%JAVA_HOME%"=="" (
    echo JAVA_HOME not detected. Searching for JDK...

    :: 1. Check project-specific JDK
    if exist "%~dp0jdk\bin\java.exe" (
        set "JAVA_HOME=%~dp0jdk"
    ) else (
        :: 2. Search for Android Studio's bundled JDK
        set "AS_PATH=C:\Program Files\Android\Android Studio"
        if exist "!AS_PATH!\jbr\bin\java.exe" (
            set "JAVA_HOME=!AS_PATH!\jbr"
        ) else if exist "!AS_PATH!\jre\bin\java.exe" (
            set "JAVA_HOME=!AS_PATH!\jre"
        ) else (
            echo [ERROR] Could not find a Java installation.
            echo.
            echo Please run 'install_jdk.bat' first to install Java automatically.
            echo.
            pause
            goto MENU
        )
    )
    echo Found Java at: !JAVA_HOME!
)

cd android
if exist gradlew.bat (
    call gradlew.bat assembleDebug
    echo.
    if exist "app\build\outputs\apk\debug\app-debug.apk" (
        echo SUCCESS! Your APK is at: android\app\build\outputs\apk\debug\app-debug.apk
    ) else (
        echo BUILD FAILED. Check the errors above.
    )
) else (
    echo Gradle wrapper not found.
)
cd ..
pause
goto MENU

:FULL
echo.
echo [1/2] Syncing assets...
xcopy /E /I /Y "public\*" "android\app\src\main\assets\www\"
echo [2/2] Starting server...
start cmd /k "npm start"
echo All systems ready.
pause
goto MENU

:EXIT
exit
