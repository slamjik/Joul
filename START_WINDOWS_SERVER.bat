@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title КафИС — Полное автоматическое развертывание в 1 клик (Wi-Fi / LAN / Docker / Node.js)

:: ============================================================================
:: 0. АВТОМАТИЧЕСКИЙ ЗАПРОС ПРАВ АДМИНИСТРАТОРА
:: ============================================================================
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [КафИС] Запрос прав Администратора для автоматической настройки сети Wi-Fi и запуска сервера...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -WorkingDirectory '%~dp0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"

echo ============================================================================
echo   ИС «КафИС» — НФ НИТУ МИСИС (Установка и запуск в 1 клик от А до Я)
echo ============================================================================
echo.

:: ============================================================================
:: 1. НАСТРОЙКА СЕТИ WI-FI / LAN И БРАНДМАУЭРА WINDOWS (ПИНГ И ПОРТЫ 3000 / 80)
:: ============================================================================
echo [1/5] Автонастройка сети Wi-Fi / LAN (видимость устройств, Ping, порты 3000 и 80)...

:: Переводим активное Wi-Fi / Ethernet подключение в режим «Частная сеть» (Private),
:: чтобы устройства в одной сети Wi-Fi видели друг друга и свободно пинговались
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Public' } | ForEach-Object { Set-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -NetworkCategory Private -ErrorAction SilentlyContinue }" >nul 2>&1

:: Открываем порты 3000 и 80 для ВСЕХ профилей сети (Domain, Private, Public Wi-Fi)
netsh advfirewall firewall delete rule name="KafIS_WiFi_Port_3000" >nul 2>&1
netsh advfirewall firewall add rule name="KafIS_WiFi_Port_3000" dir=in action=allow protocol=TCP localport=3000 profile=any >nul 2>&1
netsh advfirewall firewall add rule name="KafIS_WiFi_Port_3000" dir=out action=allow protocol=TCP localport=3000 profile=any >nul 2>&1

netsh advfirewall firewall delete rule name="KafIS_WiFi_Port_80" >nul 2>&1
netsh advfirewall firewall add rule name="KafIS_WiFi_Port_80" dir=in action=allow protocol=TCP localport=80 profile=any >nul 2>&1
netsh advfirewall firewall add rule name="KafIS_WiFi_Port_80" dir=out action=allow protocol=TCP localport=80 profile=any >nul 2>&1

:: Разрешаем входящий и исходящий ICMP-пинг (Echo Request IPv4 и IPv6) в сети Wi-Fi
netsh advfirewall firewall delete rule name="KafIS_WiFi_Ping_v4" >nul 2>&1
netsh advfirewall firewall add rule name="KafIS_WiFi_Ping_v4" protocol=icmpv4:8,any dir=in action=allow profile=any >nul 2>&1
netsh advfirewall firewall delete rule name="KafIS_WiFi_Ping_v6" >nul 2>&1
netsh advfirewall firewall add rule name="KafIS_WiFi_Ping_v6" protocol=icmpv6:128,any dir=in action=allow profile=any >nul 2>&1

:: Пробрасываем стандартный порт 80 на 3000 (чтобы работало и http://IP:3000, и просто http://IP)
netsh interface portproxy delete v4tov4 listenport=80 listenaddress=0.0.0.0 >nul 2>&1
netsh interface portproxy add v4tov4 listenport=80 listenaddress=0.0.0.0 connectport=3000 connectaddress=127.0.0.1 >nul 2>&1

echo       [OK] Сеть Wi-Fi открыта: сервер пингуется и виден со всех ПК и смартфонов!

:: ============================================================================
:: 2. РЕГИСТРАЦИЯ АВТОЗАПУСКА ПРИ ВКЛЮЧЕНИИ ПК
:: ============================================================================
echo.
echo [2/5] Настройка автозапуска сервера при включении Windows...
schtasks /delete /tn "KafIS_AutoStart_Server" /f >nul 2>&1
schtasks /create /tn "KafIS_AutoStart_Server" /tr "\"%~dp0START_WINDOWS_SERVER.bat\"" /sc onlogon /rl highest /f >nul 2>&1
echo       [OK] Автозапуск зарегистрирован в Планировщике задач Windows.

:: ============================================================================
:: 3. ОПРЕДЕЛЕНИЕ IP-АДРЕСОВ В СЕТИ WI-FI / LAN
:: ============================================================================
echo.
echo [3/5] Адреса сервера в вашей сети Wi-Fi (для ноутбуков, ПК и телефонов):
echo       ------------------------------------------------------------------------
echo       На этом компьютере:      http://localhost:3000
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    set "RAW_IP=%%a"
    set "CLEAN_IP=!RAW_IP: =!"
    if not "!CLEAN_IP!"=="" (
        echo       В сети Wi-Fi ^(панель^):   http://!CLEAN_IP!:3000
        echo       В сети Wi-Fi ^(анкета^):   http://!CLEAN_IP!:3000/survey
    )
)
echo       ------------------------------------------------------------------------

:: ============================================================================
:: 4. АВТОВЫБОР СРЕДЫ: DOCKER (ЕСЛИ ЕСТЬ) ИЛИ NODE.JS (С АВТОУСТАНОВКОЙ)
:: ============================================================================
echo.
echo [4/5] Проверка среды выполнения (Docker Desktop / Node.js)...

docker info >nul 2>&1
if %errorLevel% equ 0 (
    echo       [DOCKER] Обнаружен запущенный Docker! Сборка и запуск контейнера...
    docker compose up -d --build
    if %errorLevel% equ 0 (
        echo.
        echo ============================================================================
        echo   [ГОТОВО] СЕРВЕР КАФИС УСПЕШНО ЗАПУЩЕН В DOCKER!
        echo   Все устройства в одной сети Wi-Fi могут открывать ссылки выше.
        echo ============================================================================
        start http://localhost:3000
        pause
        exit /b 0
    )
    echo       [!] Не удалось запустить через Docker, переключаемся на прямой запуск Node.js...
) else (
    echo       [i] Docker не запущен или не установлен — используем прямой автономный запуск Node.js.
)

:: Проверяем наличие Node.js; если нет — устанавливаем автоматически через winget
where node >nul 2>&1
if %errorLevel% neq 0 (
    echo       [!] Node.js не найден. Автоматическая установка Node.js LTS в 1 клик...
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
    set "PATH=%PATH%;C:\Program Files\nodejs"
)

where node >nul 2>&1
if %errorLevel% neq 0 (
    echo [ОШИБКА] Не удалось автоматически установить Node.js.
    echo Установите Node.js LTS с https://nodejs.org/ и запустите этот файл снова.
    pause
    exit /b 1
)

:: Разрешаем node.exe в Брандмауэре Windows напрямую
for /f "delims=" %%i in ('where node') do (
    netsh advfirewall firewall delete rule name="KafIS_NodeJS_Binary" >nul 2>&1
    netsh advfirewall firewall add rule name="KafIS_NodeJS_Binary" dir=in action=allow program="%%i" enable=yes profile=any >nul 2>&1
)

:: ============================================================================
:: 5. УСТАНОВКА ЗАВИСИМОСТЕЙ, СБОРКА И ЗАПУСК СЕРВЕРА С АВТОПЕРЕЗАПУСКОМ
:: ============================================================================
echo.
echo [5/5] Подготовка зависимостей и сборка фронтенда...

if not exist "node_modules" (
    echo       Установка пакетов npm ^(выполняется один раз при первом запуске^)...
    call npm install --legacy-peer-deps
)

echo       Сборка актуальной версии интерфейса ^(npm run build^)...
call npm run build

:: Останавливаем старый процесс на порту 3000, если он был запущен ранее
for /f "tokens=5" %%p in ('netstat -aon ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%p >nul 2>&1
)

echo.
echo ============================================================================
echo   [ГОТОВО] СЕРВЕР «КАФИС» ЗАПУЩЕН И ДОСТУПЕН В СЕТИ WI-FI НА ПОРТУ 3000!
echo   Логин зав. кафедрой: head / head12345  ^|  Админ: admin / admin12345
echo   Сервер работает в режиме автоперезапуска 24/7. Не закрывайте это окно.
echo ============================================================================
start http://localhost:3000

:watchdog_loop
node --expose-gc --max-old-space-size=2048 server.js
echo [КафИС] Перезапуск сервера через 3 секунды...
timeout /t 3 /nobreak >nul
goto watchdog_loop
