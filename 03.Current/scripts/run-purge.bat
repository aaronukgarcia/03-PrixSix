@REM GUID: SCRIPT-DEPLOY-002-v01
@REM [Type] Utility Script — outside production build, used in development and testing
@REM [Category] Deploy
@REM [Intent] Windows batch file to run the score purge scripts in sequence. Wraps purge-race-results.js and purge-scores.js.
@REM [Usage] scripts\run-purge.bat (run from project root)
@REM [Moved] 2026-02-24 from project root — codebase tidy-up
@REM
@echo off
cd /d E:\GoogleDrive\Papers\03-PrixSix\03.Current
set PATH=C:\Program Files\nodejs;%PATH%
set GOOGLE_APPLICATION_CREDENTIALS=service-account.json
call "C:\Program Files\nodejs\npx.cmd" ts-node --project app\tsconfig.scripts.json app\scripts\fix-missing-oduserId.ts
