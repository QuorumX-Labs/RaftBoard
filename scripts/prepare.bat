@echo off
:: scripts\prepare.bat — OCP Build Preparation (Windows)
::
:: Copies original source files (byte-for-byte) into extension build
:: contexts so Docker can use them during image build.
:: NO modifications are made to the original files — only plain copies.
::
:: Usage:
::   scripts\prepare.bat
::   scripts\prepare.bat ..\RaftBoard-main
::
:: Default origin: ..\RaftBoard-main  (sibling of raftboard-extension)

setlocal enabledelayedexpansion

:: ── Resolve paths ────────────────────────────────────────────────────────────
set "SCRIPT_DIR=%~dp0"
:: ROOT_DIR = parent of scripts\
for %%I in ("%SCRIPT_DIR%..") do set "ROOT_DIR=%%~fI"

:: Accept optional argument for original path
if "%~1"=="" (
    for %%I in ("%ROOT_DIR%\..\RaftBoard-main") do set "ORIG=%%~fI"
) else (
    set "ORIG=%~f1"
)

echo.
echo ============================================================
echo   RaftBoard OCP Build Preparation  [Windows]
echo ============================================================
echo.
echo   Source (original, untouched) : %ORIG%
echo   Extension root               : %ROOT_DIR%
echo.

:: ── Validate original exists ─────────────────────────────────────────────────
if not exist "%ORIG%\" (
    echo [ERROR] Original RaftBoard-main not found at:
    echo         %ORIG%
    echo.
    echo Usage: scripts\prepare.bat ^<path-to-RaftBoard-main^>
    echo Example: scripts\prepare.bat ..\RaftBoard-main
    exit /b 1
)

:: ── 1. Copy gateway files → gateway\core\ ────────────────────────────────────
echo [1/4] Copying gateway files to gateway\core\ ...
if not exist "%ROOT_DIR%\gateway\core\" mkdir "%ROOT_DIR%\gateway\core"

set "FILES=server.js config.js leaderManager.js websocketHandler.js clientRegistry.js logger.js package.json"
for %%F in (%FILES%) do (
    if exist "%ORIG%\%%F" (
        copy /Y "%ORIG%\%%F" "%ROOT_DIR%\gateway\core\%%F" >nul
        echo       OK  %%F
    ) else (
        echo       MISSING: %%F
    )
)

:: ── 2. Copy replica src → replica1\src\, replica2\src\, replica3\src\ ────────
echo.
echo [2/4] Copying replica source to replica1\2\3\src\ ...

set "REPLICA_SRC=%ORIG%\miniraft\replica\src\index.js"
if not exist "%REPLICA_SRC%" (
    echo [ERROR] Replica source not found at: %REPLICA_SRC%
    exit /b 1
)

for %%N in (1 2 3) do (
    if not exist "%ROOT_DIR%\replica%%N\src\" mkdir "%ROOT_DIR%\replica%%N\src"
    copy /Y "%REPLICA_SRC%" "%ROOT_DIR%\replica%%N\src\index.js" >nul
    echo       OK  replica%%N\src\index.js
)

:: ── 3. Verify checksums (certutil — built into Windows) ───────────────────────
echo.
echo [3/4] Verifying byte-identity of copied files ...

:: Compare server.js
for /f "tokens=*" %%H in ('certutil -hashfile "%ORIG%\server.js" MD5 ^| findstr /v "^MD5" ^| findstr /v "^CertUtil"') do set "ORIG_HASH=%%H"
for /f "tokens=*" %%H in ('certutil -hashfile "%ROOT_DIR%\gateway\core\server.js" MD5 ^| findstr /v "^MD5" ^| findstr /v "^CertUtil"') do set "COPY_HASH=%%H"

:: Strip spaces for reliable comparison
set "ORIG_HASH=!ORIG_HASH: =!"
set "COPY_HASH=!COPY_HASH: =!"

if "!ORIG_HASH!"=="!COPY_HASH!" (
    echo       OK  server.js checksum matches — untouched
) else (
    echo [ERROR] CHECKSUM MISMATCH on server.js
    echo         Original : !ORIG_HASH!
    echo         Copy     : !COPY_HASH!
    exit /b 1
)

:: Compare replica index.js
for /f "tokens=*" %%H in ('certutil -hashfile "%ORIG%\miniraft\replica\src\index.js" MD5 ^| findstr /v "^MD5" ^| findstr /v "^CertUtil"') do set "ORIG_REP=%%H"
for /f "tokens=*" %%H in ('certutil -hashfile "%ROOT_DIR%\replica1\src\index.js" MD5 ^| findstr /v "^MD5" ^| findstr /v "^CertUtil"') do set "COPY_REP=%%H"

set "ORIG_REP=!ORIG_REP: =!"
set "COPY_REP=!COPY_REP: =!"

if "!ORIG_REP!"=="!COPY_REP!" (
    echo       OK  replica\src\index.js checksum matches — untouched
) else (
    echo [ERROR] CHECKSUM MISMATCH on replica index.js
    exit /b 1
)

:: ── 4. Summary ───────────────────────────────────────────────────────────────
echo.
echo [4/4] Summary
echo       gateway\core\   — Monica's original gateway files (read-only copy)
echo       replica1\src\   — Original replica\src\index.js
echo       replica2\src\   — Original replica\src\index.js
echo       replica3\src\   — Original replica\src\index.js
echo.
echo   Preparation complete.
echo   Next step: docker-compose up --build
echo.
echo   OCP COMPLIANCE: Zero modifications made to original files.
echo   Original tree at %ORIG% is completely untouched.
echo.

endlocal
exit /b 0
