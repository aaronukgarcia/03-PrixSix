@REM GUID: SCRIPT-DEPLOY-001-v01
@REM [Type] Utility Script — outside production build, used in development and testing
@REM [Category] Deploy
@REM [Intent] Windows batch file to deploy Firestore security indexes via firebase CLI. Run from project root.
@REM [Usage] scripts\deploy-indexes.bat (run from project root)
@REM [Moved] 2026-02-24 from project root — codebase tidy-up
@REM
@echo off
cd /d E:\GoogleDrive\Papers\03-PrixSix\03.Current
set PATH=C:\Program Files\nodejs;%PATH%
call npx firebase deploy --only firestore:indexes --force
