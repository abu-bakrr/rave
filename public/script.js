const socket = io({ 
    reconnection: true, 
    reconnectionDelay: 1000,
    transports: ['websocket']
});
const video = document.getElementById('main-video');
const ytContainer = document.getElementById('yt-container');
const videoWrapper = document.getElementById('video-wrapper');
const videoUrlInput = document.getElementById('video-url');
const loadUrlBtn = document.getElementById('load-url-btn');
const statusOverlay = document.getElementById('status-overlay');
const joinOverlay = document.getElementById('join-overlay');
const joinBtn = document.getElementById('join-btn');
const fsBtn = document.getElementById('fs-btn');

// Чат и имена
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');
const chatMessages = document.getElementById('chat-messages');
const namePrompt = document.getElementById('name-prompt');
const userNameInput = document.getElementById('user-name-input');
const saveNameBtn = document.getElementById('save-name-btn');

// Поиск фильмов
const movieSearchInput = document.getElementById('movie-search-input');
const movieSearchBtn = document.getElementById('movie-search-btn');
const movieResults = document.getElementById('movie-results');

const urlParams = new URLSearchParams(window.location.search);
const isAdmin = urlParams.has('admin');
const roomId = window.location.pathname.split('/').pop();

if (isAdmin) {
    document.body.classList.add('is-admin');
    video.controls = true;
} else {
    video.controls = false;
}

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
let myName = localStorage.getItem('rave_user_name'); 
let isWatchingNow = false; 
video.muted = true; 

// === ПЛЕЕР ===
let currentMode = 'html5'; // 'html5' или 'youtube'
let ytPlayer = null;
let ytReady = false;
let hlsInstance = null;
let lastVideoUrl = '';

// Инициализация YouTube API
function onYouTubeIframeAPIReady() {
    ytPlayer = new YT.Player('yt-player', {
        height: '100%',
        width: '100%',
        videoId: '',
        playerVars: {
            'autoplay': 0,
            'controls': isAdmin ? 1 : 0,
            'disablekb': isAdmin ? 0 : 1,
            'rel': 0,
            'modestbranding': 1
        },
        events: {
            'onReady': () => { ytReady = true; },
            'onStateChange': onYtStateChange
        }
    });
}

function extractYtId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

function stopCurrentPlayback() {
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (ytReady && currentMode === 'youtube') {
        ytPlayer.stopVideo();
    }
}

// Превращает любой не-YouTube URL в проксированный
function proxyUrl(url) {
    if (url.startsWith('/api/proxy')) return url;
    return '/api/proxy?url=' + encodeURIComponent(url);
}

function setMediaSource(url, time = 0, play = false) {
    if (lastVideoUrl === url) return;
    lastVideoUrl = url;
    stopCurrentPlayback();

    const ytId = extractYtId(url);
    if (ytId) {
        currentMode = 'youtube';
        video.style.display = 'none';
        ytContainer.style.display = 'block';
        if (ytReady) {
            if (play) ytPlayer.loadVideoById(ytId, time);
            else ytPlayer.cueVideoById(ytId, time);
        } else {
            setTimeout(() => setMediaSource(url, time, play), 1000);
        }
        return;
    }

    // HTML5 (mp4, m3u8 через прокси)
    currentMode = 'html5';
    ytContainer.style.display = 'none';
    video.style.display = 'block';

    // Определяем, нужен ли HLS
    if (url.includes('.m3u8')) {
        const proxiedUrl = proxyUrl(url);
        if (Hls.isSupported()) {
            hlsInstance = new Hls();
            hlsInstance.loadSource(proxiedUrl);
            hlsInstance.attachMedia(video);
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = proxiedUrl;
        }
    } else {
        // Обычное видео (mp4 и т.д.) — тоже через прокси если внешняя ссылка
        if (url.startsWith('http')) {
            video.src = proxyUrl(url);
        } else {
            video.src = url;
        }
    }

    video.currentTime = time;
    if (play) video.play().catch(() => {});
}

const PlayerAPI = {
    getCurrentTime: () => {
        if (currentMode === 'youtube' && ytReady) return ytPlayer.getCurrentTime() || 0;
        return video.currentTime || 0;
    },
    setCurrentTime: (t) => {
        if (currentMode === 'youtube' && ytReady) ytPlayer.seekTo(t, true);
        else video.currentTime = t;
    },
    play: () => {
        if (currentMode === 'youtube' && ytReady) ytPlayer.playVideo();
        else video.play().catch(() => {});
    },
    pause: () => {
        if (currentMode === 'youtube' && ytReady) ytPlayer.pauseVideo();
        else video.pause();
    },
    isPaused: () => {
        if (currentMode === 'youtube' && ytReady) return ytPlayer.getPlayerState() !== 1;
        return video.paused;
    },
    setMuted: (m) => {
        if (currentMode === 'youtube' && ytReady) { if (m) ytPlayer.mute(); else ytPlayer.unMute(); }
        video.muted = m;
    }
};

// === ИМЯ И СОЕДИНЕНИЕ ===
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
    } else {
        alert("Введите имя (минимум 2 буквы)");
    }
}
saveNameBtn.onclick = saveMyName;
userNameInput.onkeydown = (e) => { if (e.key === 'Enter') saveMyName(); };

function initConnection() {
    if (myName) socket.emit('join', { name: myName, watching: isWatchingNow, room_id: roomId });
}

document.getElementById('reset-session-btn').onclick = () => {
    localStorage.clear();
    location.reload();
};

socket.on('connect', () => {
    initConnection();
    socket.emit('get_sync', { room_id: roomId });
});

// === ЧАТ ===
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playChatSound() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.1);
    gainNode.gain.setValueAtTime(0.02, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.2);
}

function addChatMessage(data) {
    let displayName = data.name;
    if (typeof displayName === 'object' && displayName !== null) displayName = displayName.name || "Гость";
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
    if (!myName) myName = localStorage.getItem('rave_user_name');
    if (text && myName) {
        socket.emit('chat_message', { text: text, name: myName, room_id: roomId });
        chatInput.value = '';
    } else if (!myName) {
        namePrompt.style.display = 'flex';
    }
}
sendChatBtn.onclick = sendMsg;
chatInput.onkeydown = (e) => { if (e.key === 'Enter') sendMsg(); };
socket.on('chat_message', addChatMessage);

// Вкладки сайдбара
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.sidebar-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
    };
});

// === ПОИСК ФИЛЬМОВ ===
if (isAdmin && movieSearchBtn && movieSearchInput) {
    const doSearch = async () => {
        const query = movieSearchInput.value.trim();
        if (!query) return;
        
        movieResults.innerHTML = '<div style="color: #9ca3af; padding: 10px; text-align: center;">Ищем...</div>';
        
        try {
            const resp = await fetch('/api/search?q=' + encodeURIComponent(query));
            const data = await resp.json();
            
            if (data.error) {
                movieResults.innerHTML = `<div style="color: #ef4444; padding: 10px; font-size: 0.85rem;">${data.error}</div>`;
                return;
            }
            
            if (!data.results || data.results.length === 0) {
                movieResults.innerHTML = '<div style="color: #9ca3af; padding: 10px; text-align: center;">Ничего не найдено</div>';
                return;
            }
            
            movieResults.innerHTML = '';
            data.results.forEach(movie => {
                const card = document.createElement('div');
                card.className = 'movie-card';
                
                const posterHtml = movie.poster 
                    ? `<img src="${movie.poster}" onerror="this.style.display='none'">`
                    : `<div style="width: 48px; height: 72px; border-radius: 8px; background: #1f1f23; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 1.2rem;">🎬</div>`;
                
                const typeLabel = movie.type === 'tv' ? '📺 Сериал' : '🎬 Фильм';
                const ratingColor = movie.rating >= 7 ? '#10b981' : movie.rating >= 5 ? '#f59e0b' : '#ef4444';
                
                card.innerHTML = `
                    ${posterHtml}
                    <div class="movie-info">
                        <div class="movie-title">${movie.title}</div>
                        <div class="movie-meta">${movie.year} · ${typeLabel} · <span style="color: ${ratingColor}">★ ${movie.rating.toFixed(1)}</span></div>
                        <div class="movie-desc">${movie.overview || ''}</div>
                    </div>
                `;
                
                card.onclick = () => {
                    // Открываем Google с поиском фильма для быстрого нахождения ссылки
                    const searchQuery = `${movie.title} ${movie.year} смотреть онлайн`;
                    window.open('https://www.google.com/search?q=' + encodeURIComponent(searchQuery), '_blank');
                };
                
                movieResults.appendChild(card);
            });
        } catch (err) {
            movieResults.innerHTML = `<div style="color: #ef4444; padding: 10px;">Ошибка: ${err.message}</div>`;
        }
    };
    
    movieSearchBtn.onclick = doSearch;
    movieSearchInput.onkeydown = (e) => { if (e.key === 'Enter') doSearch(); };
}

// Админ: Загрузка видео
if (isAdmin) {
    loadUrlBtn.onclick = () => {
        let url = videoUrlInput.value.trim();
        if (url) {
            socket.emit('change_video', { url: url, isAdmin: true, room_id: roomId });
        }
    };
}

// Полноэкранный режим
function toggleFullScreen() {
    const isFullScreen = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
    
    if (videoWrapper.requestFullscreen || videoWrapper.webkitRequestFullscreen) {
        if (!isFullScreen) {
            if (videoWrapper.requestFullscreen) videoWrapper.requestFullscreen();
            else if (videoWrapper.webkitRequestFullscreen) videoWrapper.webkitRequestFullscreen();
            if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
        } else {
            if (document.exitFullscreen) document.exitFullscreen();
            else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
            if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
        }
    } else {
        // Fallback для iPhone (где нет Fullscreen API для div)
        if (currentMode === 'html5' && video.webkitEnterFullscreen) {
            video.webkitEnterFullscreen();
        } else {
            videoWrapper.classList.toggle('fake-fullscreen');
            updateFsButton();
        }
    }
}
fsBtn.onclick = toggleFullScreen;
document.addEventListener('fullscreenchange', updateFsButton);
document.addEventListener('webkitfullscreenchange', updateFsButton);
function updateFsButton() {
    const isFS = document.fullscreenElement || document.webkitFullscreenElement || videoWrapper.classList.contains('fake-fullscreen');
    if (isFS) {
        fsBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg><span>Выйти</span>';
    } else {
        fsBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg><span>На весь экран</span>';
    }
}

// === СИНХРОНИЗАЦИЯ ===
joinBtn.onclick = () => {
    joinOverlay.style.opacity = '0';
    setTimeout(() => joinOverlay.style.display = 'none', 500);
    PlayerAPI.setMuted(false); 
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    isWatchingNow = true;
    socket.emit('start_watching', { room_id: roomId });
    
    PlayerAPI.play();
    socket.emit('get_sync', { room_id: roomId });
    initConnection();
};

socket.on('sync', (state) => {
    if (state.chat_history && chatMessages.children.length === 0) {
        state.chat_history.forEach(msg => addChatMessage(msg));
    }

    if (state.videoUrl && lastVideoUrl !== state.videoUrl) {
        isRemoteAction = true;
        setMediaSource(state.videoUrl, state.currentTime, state.playing);
        if (isAdmin && videoUrlInput) {
            videoUrlInput.value = state.videoUrl;
        }
    }

    if (state.videoUrl) {
        const diff = Math.abs(PlayerAPI.getCurrentTime() - state.currentTime);
        if (!state.playing) {
            if (!PlayerAPI.isPaused() || diff > 0.5) {
                isRemoteAction = true;
                PlayerAPI.setCurrentTime(state.currentTime);
                PlayerAPI.pause();
            }
        } else {
            if (diff > 1.5) {
                isRemoteAction = true;
                PlayerAPI.setCurrentTime(state.currentTime);
            }
            if (PlayerAPI.isPaused()) {
                isRemoteAction = true;
                PlayerAPI.play();
            }
        }
        video.playbackRate = 1.0;
        setTimeout(() => isRemoteAction = false, 100);
    }
});

socket.on('play', (data) => {
    isRemoteAction = true;
    PlayerAPI.setCurrentTime(data.currentTime);
    PlayerAPI.setMuted(false);
    PlayerAPI.play();
    setTimeout(() => isRemoteAction = false, 100);
});

socket.on('pause', (data) => {
    isRemoteAction = true;
    PlayerAPI.setCurrentTime(data.currentTime);
    PlayerAPI.pause();
    setTimeout(() => isRemoteAction = false, 100);
});

socket.on('seek', (data) => {
    isRemoteAction = true;
    PlayerAPI.setCurrentTime(data.currentTime);
    setTimeout(() => isRemoteAction = false, 100);
});

socket.on('change_video', (data) => {
    isRemoteAction = true;
    setMediaSource(data.url, 0, true);
    setTimeout(() => isRemoteAction = false, 100);
});

socket.on('update_users', (userList) => {
    document.getElementById('participant-count').textContent = userList.length;
    const list = document.getElementById('user-list');
    list.innerHTML = ''; 
    userList.forEach(user => {
        const li = document.createElement('li');
        li.className = 'user-item';
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

// === СОБЫТИЯ ОТ ПЛЕЕРОВ К АДМИНУ ===
function onYtStateChange(event) {
    if (!isAdmin) {
        if (!isRemoteAction && (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.BUFFERING)) {
            socket.emit('get_sync', { room_id: roomId });
        }
        return;
    }
    if (!isRemoteAction) {
        if (event.data === YT.PlayerState.PLAYING) socket.emit('play', { currentTime: ytPlayer.getCurrentTime(), isAdmin: true, room_id: roomId });
        if (event.data === YT.PlayerState.PAUSED) socket.emit('pause', { currentTime: ytPlayer.getCurrentTime(), isAdmin: true, room_id: roomId });
    }
}

if (isAdmin) {
    video.onplay = () => { if (!isRemoteAction && currentMode === 'html5') socket.emit('play', { currentTime: video.currentTime, isAdmin: true, room_id: roomId }); };
    video.onpause = () => { if (!isRemoteAction && currentMode === 'html5') socket.emit('pause', { currentTime: video.currentTime, isAdmin: true, room_id: roomId }); };
    video.onseeked = () => { if (!isRemoteAction && currentMode === 'html5') socket.emit('seek', { currentTime: video.currentTime, isAdmin: true, room_id: roomId }); };

    setInterval(() => {
        if (!PlayerAPI.isPaused()) {
            socket.emit('heartbeat', { 
                currentTime: PlayerAPI.getCurrentTime(), 
                playing: true, 
                isAdmin: true,
                room_id: roomId
            });
        }
    }, 1000);
} else {
    const forceSync = () => {
        if (!isRemoteAction && currentMode === 'html5') {
            socket.emit('get_sync', { room_id: roomId });
            if (video.paused) video.play().catch(() => {});
        }
    };
    video.onplay = forceSync;
    video.onpause = forceSync;
    video.onseeking = forceSync;
    video.onratechange = () => { video.playbackRate = 1.0; };
}

function lockMediaSession() {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('seekbackward', null);
        navigator.mediaSession.setActionHandler('seekforward', null);
        navigator.mediaSession.setActionHandler('seekto', null);
    }
}
lockMediaSession();
socket.emit('get_sync', { room_id: roomId });
