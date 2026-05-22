#!/bin/bash

# Проверяем, запущен ли скрипт от имени root (нужно для перезапуска systemd)
if [ "$EUID" -ne 0 ]; then
  echo "❌ Ошибка: Пожалуйста, запустите этот скрипт от имени root."
  echo "Используйте команду: sudo bash update_ubuntu.sh"
  exit
fi

echo "========================================"
echo "🔄 Обновление проекта с GitHub"
echo "========================================"
echo ""

PROJECT_DIR=$(pwd)
APP_USER=${SUDO_USER:-root}

# Переходим в папку проекта на всякий случай
cd $PROJECT_DIR

echo "⏳ [1/4] Сброс локальных изменений (если они были) и скачивание новых..."
# Сбрасываем изменения (если вы случайно поменяли код на сервере)
sudo -u $APP_USER git reset --hard
# Скачиваем новые данные из GitHub
sudo -u $APP_USER git pull origin main

echo ""
echo "⏳ [2/4] Проверка новых библиотек Python..."
# Обновляем зависимости (на случай, если они добавились)
sudo -u $APP_USER ./.venv/bin/pip install Flask flask-socketio flask-compress gevent gevent-websocket

echo ""
echo "⏳ [3/4] Перезагрузка сервера Nginx..."
systemctl restart nginx

echo ""
echo "⏳ [4/4] Перезагрузка основного сервера Rave..."
systemctl daemon-reload
systemctl restart rave

echo ""
echo "========================================"
echo "✅ ПРОЕКТ УСПЕШНО ОБНОВЛЕН!"
echo "========================================"
echo "Вы можете проверить работу сайта."
