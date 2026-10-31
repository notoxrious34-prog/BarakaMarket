@echo off
REM Baraka Market — Owner single-click license generator (TASK-BRK-016-MKT).
REM Double-click: prompts for store name + HWID, prints validated AK key + WhatsApp text.
cd /d "%~dp0.."
npx tsx scripts\keygen-gui.ts %*
pause
