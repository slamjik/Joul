# 🗺️ KafIS — Навигатор по документации проекта

> **Стек:** Python 3.11 · Django 4.2 · DRF · PostgreSQL · Redis · React 18 · Docker

---

## 📂 Документы проекта

| # | Документ | Что внутри |
|---|----------|-----------|
| 0 | **[project_understanding.md](./project_understanding.md)** | Общее понимание проекта, контекст, роли |
| 1 | **[tz_and_plan.md](./tz_and_plan.md)** | ТЗ, ER-диаграмма, API-список, этапы разработки |
| 2 | **[backend_guide.md](./backend_guide.md)** | Структура Django-проекта, модели, API, бизнес-логика, тесты |
| 3 | **[frontend_guide.md](./frontend_guide.md)** | Структура React, дизайн-система, компоненты, графики |
| 4 | **[database_guide.md](./database_guide.md)** | Детали БД: индексы, миграции, запросы, Redis |
| 5 | **[lms_integration.md](./lms_integration.md)** | Абстракция LMS: заглушка + реальный Moodle API |
| 6 | **[deploy_guide.md](./deploy_guide.md)** | Docker Compose, Nginx, HTTPS, деплой на сервер |

---

## 🏗️ Архитектура одной строкой

```
React (Vite) → REST API → Django (DRF) → PostgreSQL
                                       → Redis (кэш)
                                       → LMS Adapter (stub/Moodle)
                                       → Excel Parser (openpyxl)
                                       → PDF/Excel Export
```

---

## 📦 Структура репозитория

```
kafis/
├── backend/                    # Django-проект
│   ├── config/                 # settings, urls, wsgi
│   ├── apps/
│   │   ├── auth_app/           # JWT, роли, пользователи
│   │   ├── workload/           # учебная нагрузка
│   │   ├── grades/             # успеваемость
│   │   ├── kpi/                # дашборд KPI
│   │   ├── reports/            # экспорт PDF/Excel
│   │   ├── imports/            # парсинг Excel / LMS
│   │   └── audit/              # журнал изменений
│   ├── requirements.txt
│   └── Dockerfile
│
├── frontend/                   # React + Vite
│   ├── src/
│   │   ├── api/                # axios-клиент
│   │   ├── components/         # переиспользуемые UI-компоненты
│   │   ├── pages/              # страницы приложения
│   │   ├── hooks/              # кастомные хуки
│   │   └── store/              # zustand / context
│   └── Dockerfile
│
├── nginx/                      # конфиг Nginx
├── docker-compose.yml
└── README.md
```

---

## ✅ Роли и права доступа

| Действие | Завкафедрой | Преподаватель | Администратор |
|---------|:-----------:|:-------------:|:-------------:|
| Просмотр всех данных | ✅ | ❌ (только своё) | ✅ |
| Редактирование нагрузки | ✅ | ❌ | ✅ |
| Импорт Excel | ✅ | ❌ | ✅ |
| Экспорт отчётов | ✅ | ✅ (свои) | ✅ |
| Управление пользователями | ❌ | ❌ | ✅ |
| Просмотр аудит-лога | ✅ | ❌ | ✅ |

---

## 🚀 Установка и запуск в 1 клик (Windows 10/11 + Wi-Fi / Локальная сеть)

После клонирования или скачивания репозитория с GitHub просто запустите файл:
```bat
START_WINDOWS_SERVER.bat
```
Скрипт автоматически:
1. Запросит права Администратора и переведёт текущий профиль Wi-Fi в режим **«Частная сеть» (`Private`)**, чтобы все ноутбуки, ПК и смартфоны в одной Wi-Fi сети видели сервер.
2. Откроет порты **`3000`** и **`80`** в Брандмауэре Windows, разрешит `ping` (ICMPv4/v6) и настроит переадресацию порта `80 -> 3000`.
3. Автоматически запустит проект через **Docker Desktop** (`docker compose up -d --build`), а если Docker не установлен — через **Node.js** (при отсутствии Node.js автоматически установит `Node.js LTS` через `winget`, выполнит `npm install` и `npm run build`).
4. Настроит автозапуск при включении ПК и выведет готовые ссылки `http://<IP-адрес>:3000` для входа с других устройств в Wi-Fi сети.

---

### Вариант 2: Запуск через Docker Compose вручную (Linux / macOS / Windows)

```bash
# Собрать и запустить контейнер КафИС (порт 3000, база сохраняется в ./server/data)
docker compose up --build -d
```
Приложение будет доступно по адресу: **http://localhost:3000** (и по локальному IP компьютера в сети Wi-Fi).

---

### Вариант 2: Локальный запуск для разработки

#### 1. Backend (Django)
```bash
cd backend
python -m venv venv
venv\Scripts\activate       # Windows (или source venv/bin/activate на Linux/macOS)
pip install -r requirements.txt

# Запуск миграций и загрузка демо-данных
python manage.py migrate
python manage.py seed_demo_data

# Запуск dev-сервера
python manage.py runserver 127.0.0.1:8000
```

#### 2. Frontend (React + Vite)
```bash
cd frontend
npm install
npm run dev
```
Фронтенд запустится на **http://localhost:3000** с автоматическим проксированием запросов `/api` на бэкенд.

#### 3. Запуск тестов
```bash
cd backend
pytest -c pytest.ini apps/
```

---

## 🔑 Демонстрационные учетные записи

| Логин | Пароль | Роль | Описание |
|---|---|---|---|
| `head` | `head12345` | `head` | Заведующий кафедрой (полный доступ к аналитике, нагрузке, аудиту) |
| `teacher1` | `teacher12345` | `teacher` | Преподаватель (Иванов А.А., доступ к своей нагрузке и оценкам) |
| `teacher2` | `teacher22345` | `teacher` | Преподаватель (Петрова Е.В.) |
| `admin` | `admin12345` | `admin` | Системный администратор (управление пользователями, аудит, Django Admin) |

---

## 🗓️ Дедлайны (напоминание)

| Срок | Задача |
|------|--------|
| **16 окт.** | Макеты экранов + прототипы (Глава 2) |
| **6 нояб.** | Верстка + интеграция модулей с API (Глава 3) |
| **13 нояб.** | Готовая пояснительная записка |
| **16–20 нояб.** | Предзащита |
| **20–25 нояб.** | Публичная защита |

