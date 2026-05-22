from gevent import monkey
monkey.patch_all()

import os
import sys
import uuid
from flask import Flask, request, send_from_directory, make_response, redirect
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

# Формат rooms:
# {
#    "room_id": {
#        "video_state": {'playing': False, 'currentTime': 0, 'videoUrl': None},
#        "users": { sid: {'name': '...', 'watching': False} },
#        "chat_history": [],
#        "guest_counter": 0
#    }
# }
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

@socketio.on('connect')
def handle_connect():
    pass # Будем инициализировать при 'join'

@socketio.on('join')
def handle_join(data):
    room_id = data.get('room_id')
    if not room_id:
        return
        
    join_room(room_id)
    room = get_room(room_id)
    room['guest_counter'] += 1
    
    # Получаем старые данные или создаем новые
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

@socketio.on('disconnect')
def handle_disconnect():
    # Ищем пользователя во всех комнатах
    for room_id, room in list(rooms.items()):
        if request.sid in room['users']:
            user_data = room['users'].pop(request.sid)
            print(f"<<< {user_data['name']} ушел из {room_id}", file=sys.stderr)
            emit('update_users', list(room['users'].values()), room=room_id)
            leave_room(room_id)
            # Если в комнате никого нет, можно очищать ее, чтобы не забивать память
            if not room['users']:
                del rooms[room_id]

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
