@echo off
set PATH=C:\Program Files\nodejs;%PATH%
cd /d E:\GoogleDrive\Papers\03-PrixSix\03.Current\app
npx ts-node --project tsconfig.scripts.json scripts/get-cc-log.ts %1
pause
