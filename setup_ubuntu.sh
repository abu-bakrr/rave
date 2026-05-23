#!/bin/bash

# Проверяем, запущен ли скрипт от имени root
if [ "$EUID" -ne 0 ]; then
  echo "❌ Ошибка: Пожалуйста, запустите этот скрипт от имени root."
  echo "Используйте команду: sudo bash setup_ubuntu.sh"
  exit
fi

echo "========================================"
echo "🚀 Автоматический установщик Rave"
echo "========================================"
echo ""

# Запрашиваем данные у пользователя
read -p "🌐 Введите ваш домен (например, watch.domain.com): " DOMAIN
if [ -z "$DOMAIN" ]; then
    echo "❌ Ошибка: Домен не указан. Отмена."
    exit 1
fi

echo ""
read -p "🎬 Введите ваш TMDB API ключ (или нажмите Enter, чтобы пропустить): " TMDB_KEY


PROJECT_DIR=$(pwd)
APP_USER=${SUDO_USER:-root}

echo ""
echo "📌 Конфигурация:"
echo "   - Домен: $DOMAIN"
echo "   - Папка проекта: $PROJECT_DIR"
echo "   - Пользователь: $APP_USER"
echo ""
read -p "Нажмите Enter, чтобы начать установку..."

echo ""
echo "⏳ [1/5] Установка системных пакетов (Nginx, Python, Certbot)..."
apt-get update
apt-get install -y python3-venv python3-pip nginx certbot python3-certbot-nginx

echo ""
echo "⏳ [2/5] Создание виртуального окружения и установка библиотек Python..."
python3 -m venv .venv
chown -R $APP_USER:$APP_USER .venv
sudo -u $APP_USER ./.venv/bin/pip install Flask flask-socketio flask-compress gevent gevent-websocket requests

echo ""
echo "⚙️  Создание config.json..."
cat > $PROJECT_DIR/config.json <<EOF
{
    "tmdb_api_key": "$TMDB_KEY"
}
EOF
chown $APP_USER:$APP_USER $PROJECT_DIR/config.json

echo ""
echo "⏳ [3/5] Настройка автозапуска сервиса (Systemd)..."
cat > /etc/systemd/system/rave.service <<EOF
[Unit]
Description=Rave Watch Server
After=network.target

[Service]
User=$APP_USER
WorkingDirectory=$PROJECT_DIR
ExecStart=$PROJECT_DIR/.venv/bin/python app.py
Restart=always

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable rave
systemctl start rave

echo ""
echo "⏳ [4/5] Настройка веб-сервера Nginx..."
cat > /etc/nginx/sites-available/rave <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
}
EOF

ln -sf /etc/nginx/sites-available/rave /etc/nginx/sites-enabled/
# Удаляем дефолтный сайт Nginx, чтобы он не перехватывал запросы
rm -f /etc/nginx/sites-enabled/default 
systemctl restart nginx

echo ""
echo "⏳ [5/5] Настройка защищенного соединения (SSL/HTTPS)..."
echo "ВАЖНО: Ваш домен ($DOMAIN) уже должен указывать на IP этого сервера!"
read -p "Запустить настройку SSL прямо сейчас? (y/n) [y]: " INSTALL_SSL
INSTALL_SSL=${INSTALL_SSL:-y}

if [[ "$INSTALL_SSL" == "y" || "$INSTALL_SSL" == "Y" || "$INSTALL_SSL" == "д" ]]; then
    certbot --nginx -d $DOMAIN
else
    echo "⚠️ Пропуск настройки SSL. Сайт будет доступен только по HTTP."
fi

echo ""
echo "========================================"
echo "✅ УСТАНОВКА УСПЕШНО ЗАВЕРШЕНА!"
echo "========================================"
echo "Ваш сервис запущен."
if [[ "$INSTALL_SSL" == "y" || "$INSTALL_SSL" == "Y" || "$INSTALL_SSL" == "д" ]]; then
    echo "Ссылка на ваш сайт: https://$DOMAIN"
else
    echo "Ссылка на ваш сайт: http://$DOMAIN"
fi
echo ""
echo "Чтобы посмотреть логи сервера, используйте команду:"
echo "sudo journalctl -u rave -f"
