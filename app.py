from gevent import monkey
monkey.patch_all()

import os
import sys
import uuid
import json
import requests as http_requests
from urllib.parse import quote, unquote
import gevent
from flask import Flask, request, send_from_directory, make_response, redirect, jsonify, Response
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_compress import Compress
from gevent.pywsgi import WSGIServer
from geventwebsocket.handler import WebSocketHandler

app = Flask(__name__, static_folder='public', static_url_path='')
app.config['SECRET_KEY'] = 'rave-ultra-fast-2024'
app.config['COMPRESS_MIMETYPES'] = ['text/html', 'text/css', 'text/javascript', 'application/json']
Compress(app)

socketio = SocketIO(app, 
    cors_allowed_origins="*", 
    async_mode='gevent',
    ping_timeout=5,
    ping_interval=2,
    cookie=None
)

# === КОНФИГ ===
def load_config():
    try:
        with open('config.json') as f:
            return json.load(f)
    except:
        return {}

# === КОМНАТЫ ===
rooms = {}

def get_room(room_id):
    if room_id not in rooms:
        rooms[room_id] = {
            "video_state": {'playing': False, 'currentTime': 0, 'videoUrl': None},
            "users": {},
            "chat_history": [],
            "guest_counter": 0
        }
    return rooms[room_id]

# === СТРАНИЦЫ ===
@app.route('/')
def index():
    return send_from_directory('public', 'home.html')

@app.route('/create_room', methods=['POST'])
def create_room():
    room_id = str(uuid.uuid4())[:8]
    return {'room_id': room_id}

@app.route('/room/<room_id>')
def serve_room(room_id):
    return send_from_directory('public', 'index.html')

# === API: ПОИСК ФИЛЬМОВ (TMDB) ===
@app.route('/api/search')
def api_search():
    query = request.args.get('q', '')
    if not query:
        return jsonify({'results': []})
    
    config = load_config()
    tmdb_key = config.get('tmdb_api_key', '')
    if not tmdb_key:
        return jsonify({'error': 'TMDB API ключ не настроен. Добавьте его в config.json', 'results': []})
    
    try:
        resp = http_requests.get(
            'https://api.themoviedb.org/3/search/multi',
            params={'api_key': tmdb_key, 'query': query, 'language': 'ru-RU'},
            timeout=10
        )
        data = resp.json()
        results = []
        for item in data.get('results', []):
            if item.get('media_type') not in ('movie', 'tv'):
                continue
            results.append({
                'id': item.get('id'),
                'title': item.get('title') or item.get('name', ''),
                'original_title': item.get('original_title') or item.get('original_name', ''),
                'year': (item.get('release_date') or item.get('first_air_date') or '')[:4],
                'poster': f"https://image.tmdb.org/t/p/w300{item['poster_path']}" if item.get('poster_path') else None,
                'overview': item.get('overview', ''),
                'rating': item.get('vote_average', 0),
                'type': item.get('media_type')
            })
        return jsonify({'results': results[:12]})
    except Exception as e:
        return jsonify({'error': str(e), 'results': []})

# === API: ВИДЕО ПРОКСИ (ОБХОД CORS) ===
@app.route('/api/proxy')
def api_proxy():
    url = request.args.get('url', '')
    if not url:
        return 'Missing URL', 400
    
    # Заголовки для имитации обычного браузера
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    # Пробрасываем Range заголовок (для перемотки видео)
    if 'Range' in request.headers:
        headers['Range'] = request.headers['Range']
    # Пробрасываем Referer если передан
    referer = request.args.get('referer', '')
    if referer:
        headers['Referer'] = referer
    
    try:
        resp = http_requests.get(url, headers=headers, stream=True, timeout=30)
    except Exception as e:
        return str(e), 502
    
    content_type = resp.headers.get('Content-Type', 'application/octet-stream')
    
    # Для m3u8 манифестов: переписываем URL сегментов через наш прокси
    if '.m3u8' in url or 'mpegurl' in content_type.lower():
        content = resp.text
        base_url = url.rsplit('/', 1)[0] + '/'
        lines = content.split('\n')
        new_lines = []
        for line in lines:
            stripped = line.strip()
            if stripped and not stripped.startswith('#'):
                # Это URL сегмента — переписываем через наш прокси
                if not stripped.startswith('http'):
                    stripped = base_url + stripped
                stripped = '/api/proxy?url=' + quote(stripped, safe='')
            new_lines.append(stripped if stripped else line)
        
        response = make_response('\n'.join(new_lines))
        response.headers['Content-Type'] = 'application/vnd.apple.mpegurl'
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response
    
    # Для всего остального (ts-сегменты, mp4) — стримим напрямую
    def generate():
        for chunk in resp.iter_content(chunk_size=65536):
            yield chunk
    
    flask_resp = Response(generate(), status=resp.status_code)
    flask_resp.headers['Content-Type'] = content_type
    flask_resp.headers['Access-Control-Allow-Origin'] = '*'
    if 'Content-Range' in resp.headers:
        flask_resp.headers['Content-Range'] = resp.headers['Content-Range']
    if 'Content-Length' in resp.headers:
        flask_resp.headers['Content-Length'] = resp.headers['Content-Length']
    if 'Accept-Ranges' in resp.headers:
        flask_resp.headers['Accept-Ranges'] = resp.headers['Accept-Ranges']
    
    return flask_resp

# === SOCKET.IO ===
@socketio.on('connect')
def handle_connect():
    pass

@socketio.on('join')
def handle_join(data):
    room_id = data.get('room_id')
    if not room_id:
        return
        
    join_room(room_id)
    room = get_room(room_id)
    room['guest_counter'] += 1
    
    user_data = room['users'].get(request.sid, {'name': f"Гость #{room['guest_counter']}", 'watching': False})
    
    new_name = data.get('name', '').strip()
    if new_name:
        user_data['name'] = new_name
    
    user_data['watching'] = data.get('watching', False)
    user_data['room_id'] = room_id
    room['users'][request.sid] = user_data
    
    print(f">>> {user_data['name']} вошел в комнату {room_id}", file=sys.stderr)
    emit('sync', {**room['video_state'], 'chat_history': room['chat_history']}, to=request.sid)
    emit('update_users', list(room['users'].values()), room=room_id)

@socketio.on('start_watching')
def handle_start_watching(data):
    room_id = data.get('room_id')
    if not room_id or room_id not in rooms: return
    room = rooms[room_id]
    
    if request.sid in room['users']:
        room['users'][request.sid]['watching'] = True
        emit('update_users', list(room['users'].values()), room=room_id)

def delete_room_if_empty(room_id):
    if room_id in rooms and not rooms[room_id]['users']:
        del rooms[room_id]
        print(f"--- Комната {room_id} удалена из-за неактивности", file=sys.stderr)

@socketio.on('disconnect')
def handle_disconnect():
    for room_id, room in list(rooms.items()):
        if request.sid in room['users']:
            user_data = room['users'].pop(request.sid)
            print(f"<<< {user_data['name']} ушел из {room_id}", file=sys.stderr)
            emit('update_users', list(room['users'].values()), room=room_id)
            leave_room(room_id)
            if not room['users']:
                # Даем 10 секунд на переподключение (например, при обновлении страницы)
                gevent.spawn_later(10, delete_room_if_empty, room_id)

def get_real_name(sid, room, data):
    name = data.get('name')
    if name and name.strip() and not name.startswith('Гость'):
        return name
    
    user_info = room['users'].get(sid)
    if user_info and user_info.get('name') and not user_info.get('name').startswith('Гость'):
        return user_info.get('name')
        
    if user_info:
        return user_info.get('name', 'Незнакомец')
    
    return "Странник"

@socketio.on('chat_message')
def handle_chat(data):
    room_id = data.get('room_id')
    if not room_id or room_id not in rooms: return
    room = rooms[room_id]
    
    message = data.get('text', '')
    
    name = get_real_name(request.sid, room, data)
    
    if message:
        print(f"CHAT_LOG [{room_id}]: {name} -> {message}", file=sys.stderr)
        msg_obj = {'name': str(name), 'text': message}
        room['chat_history'].append(msg_obj)
        if len(room['chat_history']) > 100: room['chat_history'].pop(0)
        emit('chat_message', msg_obj, room=room_id)

@socketio.on('get_sync')
def handle_get_sync(data):
    room_id = data.get('room_id')
    if not room_id or room_id not in rooms: return
    room = rooms[room_id]
    emit('sync', {**room['video_state'], 'chat_history': room['chat_history']}, to=request.sid)

@socketio.on('play')
def handle_play(data):
    if not data.get('isAdmin'): return
    room_id = data.get('room_id')
    if not room_id or room_id not in rooms: return
    room = rooms[room_id]
    
    room['video_state']['playing'] = True
    room['video_state']['currentTime'] = data.get('currentTime', 0)
    emit('play', data, room=room_id, include_self=False)

@socketio.on('pause')
def handle_pause(data):
    if not data.get('isAdmin'): return
    room_id = data.get('room_id')
    if not room_id or room_id not in rooms: return
    room = rooms[room_id]
    
    room['video_state']['playing'] = False
    room['video_state']['currentTime'] = data.get('currentTime', 0)
    emit('pause', data, room=room_id, include_self=False)

@socketio.on('seek')
def handle_seek(data):
    if not data.get('isAdmin'): return
    room_id = data.get('room_id')
    if not room_id or room_id not in rooms: return
    room = rooms[room_id]
    
    room['video_state']['currentTime'] = data.get('currentTime', 0)
    emit('seek', data, room=room_id, include_self=False)

@socketio.on('change_video')
def handle_change_video(data):
    if not data.get('isAdmin'): return
    room_id = data.get('room_id')
    if not room_id or room_id not in rooms: return
    room = rooms[room_id]
    
    room['video_state']['videoUrl'] = data.get('url')
    room['video_state']['currentTime'] = 0
    room['video_state']['playing'] = False
    emit('change_video', data, room=room_id)

@socketio.on('heartbeat')
def handle_heartbeat(data):
    if not data.get('isAdmin'): return
    room_id = data.get('room_id')
    if not room_id or room_id not in rooms: return
    room = rooms[room_id]
    
    room['video_state']['currentTime'] = data.get('currentTime', 0)
    room['video_state']['playing'] = data.get('playing', False)
    emit('sync', room['video_state'], room=room_id, include_self=False)

if __name__ == '__main__':
    print("🚀 RAVE SERVER RUNNING...", file=sys.stderr)
    http_server = WSGIServer(('0.0.0.0', 3000), app, handler_class=WebSocketHandler)
    http_server.serve_forever()
