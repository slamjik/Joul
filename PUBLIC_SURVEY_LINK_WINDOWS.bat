@echo off
chcp 65001 >nul
title КафИС МИСИС — Внешняя ссылка для анкетирования (Работает в РФ без Cloudflare)
color 0B

echo ============================================================================
echo   КафИС (НФ НИТУ МИСИС) — ВНЕШНИЙ ДОСТУП ДЛЯ АНКЕТИРОВАНИЯ СТУДЕНТОВ (РФ)
echo   Без Cloudflare (не блокируется РКН и мобильными операторами РФ)
echo ============================================================================
echo.

:: Проверяем, запущен ли сам сервер на порту 3000
netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Сервер КафИС на порту 3000 ещё не запущен.
    echo [i] Сначала запустите START_WINDOWS_SERVER.bat, дождитесь старта,
    echo     и затем откройте этот файл снова.
    echo.
    pause
    exit /b 1
)

echo [OK] Локальный сервер КафИС работает на http://localhost:3000
echo.
echo Выберите способ подключения студентов (без служебных записок в ИТ-отдел):
echo   [1] SSH-туннель localhost.run (Без установки программ, работает в РФ)
echo   [2] SSH-туннель Pinggy по порту 443 (Если закрыт порт 22 в вузе)
echo   [3] SSH-туннель Serveo.net (Резервный канал без Cloudflare)
echo.
set /p MODE="Введите номер варианта (по умолчанию 1, просто нажмите Enter): "
if "%MODE%"=="" set MODE=1

if "%MODE%"=="2" (
    echo.
    echo [+] Запускаем туннель через порт 443 (Pinggy)...
    echo [!] Скопируйте появившуюся https:// ссылку, добавьте /survey в конце и скиньте старостам:
    echo.
    ssh -p 443 -R0:localhost:3000 -o StrictHostKeyChecking=no -o ServerAliveInterval=30 a.pinggy.io
    pause
    exit /b 0
)

if "%MODE%"=="3" (
    echo.
    echo [+] Запускаем туннель Serveo.net...
    echo [!] Скопируйте появившуюся https:// ссылку, добавьте /survey в конце и скиньте старостам:
    echo.
    ssh -R 80:localhost:3000 -o StrictHostKeyChecking=no -o ServerAliveInterval=30 serveo.net
    pause
    exit /b 0
)

echo.
echo [+] Запускаем прямой туннель localhost.run (через стандартный SSH Windows 10/11)...
echo ============================================================================
echo   Сейчас внизу появится ссылка вида: https://xxxx.lhr.life
echo   Добавьте к ней /survey (например: https://xxxx.lhr.life/survey)
echo   и отправьте студентам — открывается с любого оператора РФ (МТС/Билайн/Мегафон/Т2)
echo ============================================================================
echo.
ssh -R 80:localhost:3000 -o StrictHostKeyChecking=no -o ServerAliveInterval=30 nokey@localhost.run
pause
