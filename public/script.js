const socket = io({ 
    reconnection: true, 
    reconnectionDelay: 1000,
    transports: ['websocket'] // Принудительно используем только сверхбыстрые сокеты
});
const video = document.getElementById('main-video');
const videoWrapper = document.getElementById('video-wrapper');
const videoUrlInput = document.getElementById('video-url');
const loadUrlBtn = document.getElementById('load-url-btn');
const statusOverlay = document.getElementById('status-overlay');
const joinOverlay = document.getElementById('join-overlay');
const joinBtn = document.getElementById('join-btn');
const fsBtn = document.getElementById('fs-btn');

// Чат
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');
const chatMessages = document.getElementById('chat-messages');
const floatingChat = document.getElementById('floating-chat');

// Имена
const namePrompt = document.getElementById('name-prompt');
const userNameInput = document.getElementById('user-name-input');
const saveNameBtn = document.getElementById('save-name-btn');

const urlParams = new URLSearchParams(window.location.search);
const isAdmin = urlParams.has('admin');

// Извлекаем ID комнаты из пути /room/1234
const roomId = window.location.pathname.split('/').pop();

if (isAdmin) {
    document.body.classList.add('is-admin');
    video.controls = true;
    // Убрали joinOverlay.style.display = 'none' отсюда, чтобы админ тоже жал "Войти" если надо
} else {
    video.controls = false;
}

// Установка ссылки-приглашения
const inviteUrlInput = document.getElementById('invite-url');
const copyInviteBtn = document.getElementById('copy-invite-btn');
if (inviteUrlInput) {
    inviteUrlInput.value = window.location.origin + window.location.pathname;
}
if (copyInviteBtn) {
    copyInviteBtn.onclick = () => {
        inviteUrlInput.select();
        document.execCommand('copy');
        copyInviteBtn.textContent = 'Скопировано!';
        setTimeout(() => copyInviteBtn.textContent = 'Копировать', 2000);
    };
}

let isRemoteAction = false;
let myName = localStorage.getItem('rave_user_name'); // Новый ключ
let isWatchingNow = false; 

// --- Логика Имени ---
video.muted = true; 

// Если имя пустое или это стандартный "Гость", просим ввести нормальное
if (!myName || myName.startsWith('Гость')) {
    namePrompt.style.display = 'flex';
} else {
    namePrompt.style.display = 'none';
    if (!isAdmin) joinOverlay.style.display = 'flex';
    initConnection();
}

function saveMyName() {
    const name = userNameInput.value.trim();
    if (name && name.length >= 2) {
        myName = name;
        localStorage.setItem('rave_user_name', name);
        namePrompt.style.display = 'none';
        if (!isAdmin) joinOverlay.style.display = 'flex';
        initConnection();
        console.log("Имя сохранено:", myName);
    } else {
        alert("Введите имя (минимум 2 буквы)");
    }
}

saveNameBtn.onclick = saveMyName;
userNameInput.onkeydown = (e) => { if (e.key === 'Enter') saveMyName(); };

function initConnection() {
    if (myName) {
        socket.emit('join', { name: myName, watching: isWatchingNow, room_id: roomId });
    }
}

document.getElementById('reset-session-btn').onclick = () => {
    localStorage.clear();
    location.reload();
};

socket.on('connect', () => {
    initConnection();
    socket.emit('get_sync', { room_id: roomId });
});

// --- Логика Чата ---
// --- Логика звука чата (Web Audio API) ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playChatSound() {
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.type = 'sine'; // Мягкая волна
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // Высокая нота (Ля)
    oscillator.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.1); // Спад

    gainNode.gain.setValueAtTime(0.02, audioCtx.currentTime); // Очень тихо (2%)
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2); // Плавное затухание

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.2);
}

function addChatMessage(data) {
    console.log("DEBUG CHAT DATA:", data);
    
    let displayName = data.name;
    
    // ЕСЛИ ПРИШЕЛ ОБЪЕКТ - ДОСТАЕМ ИМЯ ИЗНУТРИ
    if (typeof displayName === 'object' && displayName !== null) {
        displayName = displayName.name || "Гость";
    }
    
    if (!displayName) displayName = "Гость";
    
    const msg = document.createElement('div');
    msg.className = (displayName === myName) ? 'msg own' : 'msg';
    
    msg.innerHTML = `<span class="name">${displayName}</span>${data.text}`;
    
    chatMessages.appendChild(msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    if (displayName !== myName) playChatSound();
}

function sendMsg() {
    const text = chatInput.value.trim();
    // Если имя вдруг пропало из переменной, пробуем взять из памяти еще раз
    if (!myName) myName = localStorage.getItem('rave_user_name');

    if (text && myName) {
        socket.emit('chat_message', { text: text, name: myName, room_id: roomId });
        chatInput.value = '';
    } else if (!myName) {
        namePrompt.style.display = 'flex'; // Принудительно просим имя
    }
}

sendChatBtn.onclick = sendMsg;
chatInput.onkeydown = (e) => { if (e.key === 'Enter') sendMsg(); };

socket.on('chat_message', addChatMessage);

// --- Переключение вкладок (для всех) ---
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.sidebar-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        const tabId = btn.dataset.tab;
        document.getElementById(tabId).classList.add('active');
    };
});

// --- Логика Админки ---
if (isAdmin) {
    loadUrlBtn.onclick = () => {
        let url = videoUrlInput.value.trim();
        if (url) {
            if (!url.startsWith('http') && !url.startsWith('/')) url = '/' + url;
            socket.emit('change_video', { url: url, isAdmin: true, room_id: roomId });
        }
    };
}

// --- Полноэкранный режим (Двусторонний Toggle) ---
function toggleFullScreen() {
    const isFullScreen = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;

    if (!isFullScreen) {
        // ВХОДИМ В ПОЛНЫЙ ЭКРАН
        if (videoWrapper.requestFullscreen) {
            videoWrapper.requestFullscreen();
        } else if (videoWrapper.webkitRequestFullscreen) {
            videoWrapper.webkitRequestFullscreen();
        } else if (video.webkitEnterFullscreen) {
            // Специфично для iPhone
            video.webkitEnterFullscreen();
        }
        
        // Пытаемся развернуть экран горизонтально (для Android)
        if (screen.orientation && screen.orientation.lock) {
            screen.orientation.lock('landscape').catch(() => {});
        }
    } else {
        // ВЫХОДИМ ИЗ ПОЛНОГО ЭКРАНА
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
        
        if (screen.orientation && screen.orientation.unlock) {
            screen.orientation.unlock();
        }
    }
}

fsBtn.onclick = toggleFullScreen;

// Следим за системным изменением (например, если нажали Esc или кнопку "Назад")
document.addEventListener('fullscreenchange', updateFsButton);
document.addEventListener('webkitfullscreenchange', updateFsButton);

function updateFsButton() {
    const isFS = document.fullscreenElement || document.webkitFullscreenElement;
    fsBtn.textContent = isFS ? '✖ Выйти' : '⛶ Во весь экран';
}

// --- Синхронизация Видео ---
joinBtn.onclick = () => {
    joinOverlay.style.opacity = '0';
    setTimeout(() => joinOverlay.style.display = 'none', 500);
    video.muted = false; 
    
    // Помечаем, что мы вошли
    isWatchingNow = true;
    socket.emit('start_watching', { room_id: roomId });
    
    video.play().then(() => {
        socket.emit('get_sync', { room_id: roomId });
    }).catch(() => {});
    initConnection();
};

socket.on('sync', (state) => {
    // 1. ПОДГРУЖАЕМ ИСТОРИЮ ЧАТА (только один раз при входе)
    if (state.chat_history && chatMessages.children.length === 0) {
        state.chat_history.forEach(msg => addChatMessage(msg));
    }

    // 2. СИНХРОНИЗАЦИЯ ФАЙЛА
    if (state.videoUrl) {
        const currentSrc = video.getAttribute('src') || '';
        if (currentSrc !== state.videoUrl && !video.src.endsWith(state.videoUrl)) {
            isRemoteAction = true;
            video.src = state.videoUrl;
        }
    }

    // 3. ЖЕСТКАЯ СИНХРОНИЗАЦИЯ ВРЕМЕНИ И ПАУЗЫ
    const diff = Math.abs(video.currentTime - state.currentTime);
    
    // Если админ на паузе — СТОП И ВОЗВРАТ В МОМЕНТ
    if (!state.playing) {
        if (!video.paused || diff > 0.1) {
            isRemoteAction = true;
            video.currentTime = state.currentTime;
            video.pause();
        }
    } 
    // Если админ играет
    else {
        if (diff > 1.0) {
            isRemoteAction = true;
            video.currentTime = state.currentTime;
        }
        if (video.paused) {
            isRemoteAction = true;
            video.play().catch(() => {});
        }
    }

    video.playbackRate = 1.0;
    setTimeout(() => isRemoteAction = false, 50);
});

socket.on('play', (data) => {
    isRemoteAction = true;
    video.currentTime = data.currentTime;
    video.muted = false; // Принудительно включаем звук при старте
    video.play().catch(() => {});
    setTimeout(() => isRemoteAction = false, 50);
});

socket.on('pause', (data) => {
    isRemoteAction = true;
    video.currentTime = data.currentTime;
    video.pause();
    setTimeout(() => isRemoteAction = false, 50);
});

socket.on('seek', (data) => {
    isRemoteAction = true;
    video.currentTime = data.currentTime;
    setTimeout(() => isRemoteAction = false, 50);
});

socket.on('change_video', (data) => {
    isRemoteAction = true;
    video.src = data.url;
    video.currentTime = 0;
    video.play().catch(() => {});
    setTimeout(() => isRemoteAction = false, 50);
});

socket.on('update_users', (userList) => {
    document.getElementById('participant-count').textContent = userList.length;
    const list = document.getElementById('user-list');
    list.innerHTML = ''; 
    
    userList.forEach(user => {
        const li = document.createElement('li');
        li.className = 'user-item';
        
        // Проверяем, мы ли это (теперь учитываем Гость #)
        const isGuest = user.name.startsWith('Гость #');
        const isMe = user.name === myName || (isGuest && !myName);
        const isWatching = isMe ? isWatchingNow : user.watching;
        
        const statusDot = document.createElement('span');
        statusDot.className = isWatching ? 'status-dot online' : 'status-dot offline';
        
        const nameSpan = document.createElement('span');
        nameSpan.style.fontWeight = isMe ? '800' : '500';
        nameSpan.textContent = isMe ? `${user.name} (Вы)` : user.name;
        
        const statusText = document.createElement('span');
        statusText.className = 'status-text';
        
        if (isWatching) {
            statusText.textContent = 'смотрит';
            statusText.style.color = '#10b981';
        } else {
            statusText.textContent = isGuest ? 'вводит имя...' : 'в лобби...';
            statusText.style.color = '#6b7280';
        }

        li.appendChild(statusDot);
        li.appendChild(nameSpan);
        li.appendChild(statusText);
        list.appendChild(li);
    });
});

// --- Блокировка системных кнопок (MediaSession) ---
function lockMediaSession() {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('seekbackward', null);
        navigator.mediaSession.setActionHandler('seekforward', null);
        navigator.mediaSession.setActionHandler('seekto', null);
    }
}

if (isAdmin) {
    video.onplay = () => { if (!isRemoteAction) socket.emit('play', { currentTime: video.currentTime, isAdmin: true, room_id: roomId }); };
    video.onpause = () => { if (!isRemoteAction) socket.emit('pause', { currentTime: video.currentTime, isAdmin: true, room_id: roomId }); };
    video.onseeked = () => { if (!isRemoteAction) socket.emit('seek', { currentTime: video.currentTime, isAdmin: true, room_id: roomId }); };

    // Сердечный ритм админа: раз в секунду для максимальной точности
    setInterval(() => {
        if (!video.paused) {
            socket.emit('heartbeat', { 
                currentTime: video.currentTime, 
                playing: !video.paused, 
                isAdmin: true,
                room_id: roomId
            });
        }
    }, 1000);
} else {
    // МГНОВЕННАЯ синхронизация и блокировка действий для зрителей
    const forceSync = () => {
        if (!isRemoteAction) {
            console.log("Попытка вмешательства! Блокируем...");
            // Немедленно возвращаем состояние админа
            socket.emit('get_sync', { room_id: roomId });
            
            // Если админ играет, а зритель нажал паузу — принудительно запускаем
            if (video.paused) {
                video.play().catch(() => {});
            }
            lockMediaSession();
        }
    };
    video.onplay = forceSync;
    video.onpause = forceSync;
    video.onseeking = forceSync;
    video.onratechange = () => { video.playbackRate = 1.0; }; // Запрещаем менять скорость
}

lockMediaSession();
socket.emit('get_sync', { room_id: roomId });
