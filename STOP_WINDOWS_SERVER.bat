@echo off
chcp 65001 >nul
title КафИС — Остановка сервера

cd /d "%~dp0"
echo Остановка контейнеров Docker КафИС...
docker compose down >nul 2>&1

echo Остановка фоновых процессов Node.js на порту 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000"') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo [ГОТОВО] Сервер КафИС остановлен. Все данные сохранены в server\data\db.json.
pause
