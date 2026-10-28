@echo off
chcp 65001 >nul
title КафИС — Установка автозапуска при включении Windows 10/11

net session >nul 2>&1
if %errorLevel% neq 0 (
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"

echo Регистрация ИС «КафИС» в Планировщике задач Windows (запуск при включении ПК)...
schtasks /delete /tn "KafIS_AutoStart_Server" /f >nul 2>&1
schtasks /create /tn "KafIS_AutoStart_Server" /tr "\"%~dp0START_WINDOWS_SERVER.bat\"" /sc onlogon /rl highest /f

echo.
echo [ГОТОВО] Теперь при каждом включении компьютера Windows сервер КафИС будет запускаться автоматически!
pause
