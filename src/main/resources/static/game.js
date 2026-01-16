// [Face Gomoku] game.js - 이미지 전송 기능 통합 및 경로 수정 완료

// --- 1. 전역 변수 및 초기화 ---
let stompClient = null;
let myNickname = "";
let myUniqueId = generateUUID();
let currentRoomId = "";
let mySkinUrl = "";
let myStoneType = 0;     // 1: 흑, 2: 백, 0: 관전
let currentTurn = 1;     // 1: 흑 차례, 2: 백 차례
let isGameEnded = false;
let pendingConfirmCallback = null; // 확인 모달용 콜백

// 오목판 설정
const canvas = document.getElementById('gameCanvas');
const ctx = canvas ? canvas.getContext('2d') : null;
const BOARD_SIZE = 15;
const CELL_SIZE = 40;
const PADDING = 20;

// DOM 헬퍼
const getEl = (id) => document.getElementById(id);

function generateUUID() { return Math.random().toString(36).substr(2, 9); }

// 페이지 로드 시 실행
window.addEventListener('load', () => {
    init();
});

function init() {
    // 테마 적용
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') document.body.classList.add('dark-mode');
    const themeBtn = getEl('themeBtn');
    if(themeBtn) themeBtn.innerText = (savedTheme === 'dark') ? 'Light' : 'Dark';

    // 자동 로그인 확인
    const savedNick = localStorage.getItem('nickname');
    if (savedNick) {
        const input = getEl('nicknameInput');
        if(input) {
            input.value = savedNick;
            input.disabled = true;
        }
    }
}

// --- 2. [핵심] 이미지 압축 함수 ---
function compressImage(file, maxWidth, quality, callback) {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = function (event) {
        const img = new Image();
        img.src = event.target.result;
        img.onload = function () {
            let width = img.width;
            let height = img.height;

            // 비율 유지하면서 리사이징
            if (width > maxWidth) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // 압축된 Blob 생성 (JPEG, 퀄리티 0.7)
            canvas.toBlob(function (blob) {
                // 원본 파일명을 유지한 새 파일 객체 생성
                const compressedFile = new File([blob], file.name, {
                    type: 'image/jpeg',
                    lastModified: Date.now(),
                });
                callback(compressedFile);
            }, 'image/jpeg', quality);
        };
    };
}

// --- 3. 입장 및 업로드 (압축 적용) ---
function uploadAndEnter() {
    const nick = getEl('nicknameInput').value.trim();
    if (!nick) return showAlert("닉네임을 입력하세요.");

    myNickname = nick;
    localStorage.setItem('nickname', nick);

    const fileInput = getEl('skinInput');

    if (fileInput.files.length > 0) {
        const file = fileInput.files[0];

        // ★ 압축 진행 (최대 너비 100px - 스킨은 작아도 됨)
        compressImage(file, 150, 0.8, function(compressedFile) {
            const formData = new FormData();
            formData.append("file", compressedFile);

            fetch('/Oh_Mock/api/upload', { method: 'POST', body: formData })
                .then(res => res.text())
                .then(url => {
                    mySkinUrl = url;
                    enterLobby();
                })
                .catch(err => {
                    console.error("Upload failed:", err);
                    enterLobby();
                });
        });
    } else {
        enterLobby();
    }
}

function enterLobby() {
    getEl('welcome-msg').innerText = `환영합니다, ${myNickname}님!`;

    // 로그인 정보 표시
    const loggedInArea = getEl('loggedInArea');
    const userNickname = getEl('userNickname');
    if(loggedInArea) loggedInArea.classList.remove('hidden');
    if(userNickname) userNickname.innerText = myNickname;

    getEl('login-screen').classList.add('hidden');
    getEl('lobby-screen').classList.remove('hidden');

    loadRooms();
}

// --- 3. 방 관리 ---
function loadRooms() {
    // [경로 수정] /Oh_Mock 추가
    fetch('/Oh_Mock/api/rooms').then(res => res.json()).then(rooms => {
        const list = getEl('room-list');
        if(!list) return;

        list.innerHTML = rooms.length ? '' : '<li style="padding:20px; text-align:center; color:var(--text-secondary);">방이 없습니다.</li>';
        rooms.forEach(room => {
            const li = document.createElement('li');
            li.className = 'room-item';
            li.innerHTML = `
                <span style="font-weight:600;">${room.roomName}</span> 
                <button class="btn-default" onclick="joinRoom('${room.roomId}', '${room.roomName}')" style="font-size:12px;">입장</button>
            `;
            list.appendChild(li);
        });
    }).catch(err => console.error(err));
}

function createRoom() {
    const name = getEl('roomNameInput').value;
    if(!name) return showAlert("방 제목을 입력하세요.");
    fetch(`/Oh_Mock/api/rooms?name=${encodeURIComponent(name)}`, { method: 'POST' })
        .then(res => res.json())
        .then(room => joinRoom(room.roomId, room.roomName));
}

function joinRoom(roomId, roomName) {
    currentRoomId = roomId;
    getEl('room-title-text').innerText = roomName;
    getEl('lobby-screen').classList.add('hidden');
    getEl('game-screen').classList.remove('hidden');
    getEl('messages').innerHTML = '';

    drawBoard();
    connectSocket();
}

// --- 4. 웹소켓 및 게임 로직 ---
function connectSocket() {
    const socket = new SockJS('/Oh_Mock/ws');
    stompClient = Stomp.over(socket);
    stompClient.debug = null;

    stompClient.connect({}, function () {
        showChat('SYSTEM', '서버에 연결되었습니다.');

        // 1. 착수 정보 구독
        stompClient.subscribe(`/topic/${currentRoomId}/stone`, function (msg) {
            const body = JSON.parse(msg.body);
            renderStone(body.row, body.col, body.skinUrl, body.stoneType);
            currentTurn = (body.stoneType === 1) ? 2 : 1;
            updateTurnIndicator();
        });

        // 2. 채팅 정보 구독
        stompClient.subscribe(`/topic/${currentRoomId}/chat`, function (msg) {
            const body = JSON.parse(msg.body);
            handleChatMessage(body);
        });

        // 입장 메시지 전송
        stompClient.send(`/app/${currentRoomId}/join`, {}, JSON.stringify({
            type: 'JOIN', sender: myNickname, senderId: myUniqueId, skinUrl: mySkinUrl
        }));
    });
}

function handleChatMessage(msg) {
    // 내 돌 상태 업데이트
    if (msg.senderId === myUniqueId && msg.stoneType) {
        myStoneType = msg.stoneType;
        const typeText = myStoneType === 1 ? "흑돌 (⚫)" : (myStoneType === 2 ? "백돌 (⚪)" : "관전 모드");
        getEl('my-stone-status').innerText = typeText;
        const startBtn = getEl('startBtn');
        if(startBtn) startBtn.style.display = (myStoneType !== 0) ? 'inline-block' : 'none';
    }

    // 플레이어 프로필 갱신
    if ((msg.type === 'JOIN' || msg.type === 'STONE') && msg.stoneType) {
        updatePlayerProfile(msg.stoneType, msg.sender, msg.skinUrl);
    }

    if (msg.type === 'START') {
        isGameEnded = false;
        currentTurn = 1;
        drawBoard();
        updateTurnIndicator();
        showChat("SYSTEM", msg.content);
        const startBtn = getEl('startBtn');
        if(startBtn) startBtn.style.display = 'none';

    } else if (msg.type === 'GAME_OVER') {
        isGameEnded = true;
        getEl('turn-indicator').style.display = 'none';
        fireConfetti();

        const modal = getEl('ranking-modal');
        const img = getEl('winnerImage');
        const name = getEl('winnerName');

        const winnerName = msg.winnerName || msg.sender;
        const winnerSkin = msg.winnerSkin || msg.skinUrl;

        img.src = winnerSkin || "https://placehold.co/150x150/000000/FFFFFF?text=WINNER";
        img.onerror = () => { img.src = "https://placehold.co/150x150/000000/FFFFFF?text=WINNER"; };
        name.innerText = winnerName;
        modal.classList.remove('hidden');

        showChat('SYSTEM', msg.content);

        if (myStoneType !== 0) {
            const startBtn = getEl('startBtn');
            if(startBtn) startBtn.style.display = 'inline-block';
        }

    } else if (msg.type === 'EXIT') {
        if(msg.senderId === myUniqueId) location.reload();
        else showChat("SYSTEM", msg.content);

    } else {
        showChat(msg.sender, msg.content);
    }
}

// --- 5. 렌더링 (오목판) ---
function drawBoard() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#faf6ed";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < BOARD_SIZE; i++) {
        ctx.moveTo(PADDING, PADDING + i * CELL_SIZE);
        ctx.lineTo(PADDING + (BOARD_SIZE - 1) * CELL_SIZE, PADDING + i * CELL_SIZE);
        ctx.moveTo(PADDING + i * CELL_SIZE, PADDING);
        ctx.lineTo(PADDING + i * CELL_SIZE, PADDING + (BOARD_SIZE - 1) * CELL_SIZE);
    }
    ctx.stroke();
}

function renderStone(row, col, imageUrl, stoneType) {
    const x = PADDING + col * CELL_SIZE;
    const y = PADDING + row * CELL_SIZE;
    const radius = 17;
    const color = (stoneType == 1) ? "#000000" : "#ffffff";

    const drawCircle = (c) => {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = c;
        ctx.fill();
        ctx.strokeStyle = "#000";
        ctx.stroke();
        ctx.shadowColor = "rgba(0,0,0,0.3)";
        ctx.shadowBlur = 5; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
        ctx.stroke();
        ctx.shadowColor = "transparent";
    };

    if (imageUrl) {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = imageUrl;
        img.onload = () => {
            ctx.save();
            ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.clip();
            ctx.drawImage(img, x - radius, y - radius, radius * 2, radius * 2);
            ctx.restore();
            ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.strokeStyle = "rgba(0,0,0,0.2)"; ctx.stroke();
        };
        img.onerror = () => drawCircle(color);
    } else {
        drawCircle(color);
    }
}

canvas.addEventListener('click', e => {
    if (isGameEnded) return;
    if (myStoneType === 0) return showAlert("관전자는 돌을 둘 수 없습니다.");
    if (myStoneType != currentTurn) return showAlert("상대방 차례입니다!");

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const col = Math.round((x - PADDING) / CELL_SIZE);
    const row = Math.round((y - PADDING) / CELL_SIZE);

    if (col < 0 || col >= BOARD_SIZE || row < 0 || row >= BOARD_SIZE) return;

    stompClient.send(`/app/${currentRoomId}/stone`, {}, JSON.stringify({
        sender: myNickname, senderId: myUniqueId,
        row: row, col: col, stoneType: myStoneType, skinUrl: mySkinUrl
    }));
});

// --- 6. 채팅 및 유틸리티 ---
function sendChat() {
    const val = getEl('chatInput').value.trim();
    if (!val) return;
    stompClient.send(`/app/${currentRoomId}/chat`, {}, JSON.stringify({ type: 'CHAT', sender: myNickname, senderId: myUniqueId, content: val }));
    getEl('chatInput').value = '';
}

// [추가] 이미지 전송 함수 (참고한 파일에서 가져옴)
function sendImageMessage(url) {
    if (!stompClient || !currentRoomId) return;
    // 이미지 태그 형태로 전송
    const imgTag = `<img src="${url}" class="chat-img">`;
    stompClient.send(`/app/${currentRoomId}/chat`, {}, JSON.stringify({
        type: 'CHAT', sender: myNickname, senderId: myUniqueId, content: imgTag
    }));
}

function showChat(sender, msg) {
    const msgs = getEl('messages');
    const div = document.createElement('div');
    const isMe = (sender === myNickname);
    const isSystem = (sender === 'SYSTEM');

    if (isSystem) {
        div.className = 'msg-system';
        div.innerHTML = `<span class="badge" style="background:var(--border-color); color:var(--text-primary);">${msg}</span>`;
    } else {
        div.className = isMe ? 'msg-row msg-right' : 'msg-row msg-left';
        let html = '';
        if (!isMe) html += `<div class="msg-name">${sender}</div>`;
        html += `<div class="msg-bubble">${msg}</div>`;
        div.innerHTML = html;
    }
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;

    // 이미지 로드 시 스크롤 보정
    const imgs = div.querySelectorAll('img');
    imgs.forEach(img => img.onload = () => msgs.scrollTop = msgs.scrollHeight);
}

function startGame() { stompClient.send(`/app/${currentRoomId}/start`, {}, JSON.stringify({ sender: myNickname })); }

function exitRoom() {
    if (stompClient) stompClient.send(`/app/${currentRoomId}/exit`, {}, JSON.stringify({ sender: myNickname, senderId: myUniqueId }));
    location.reload();
}

function updateTurnIndicator() {
    const indicator = getEl('turn-indicator');
    if (!isGameEnded && myStoneType == currentTurn) {
        indicator.style.display = 'inline-block';
        indicator.innerText = "🚩 내 차례입니다!";
    } else {
        indicator.style.display = 'none';
    }
}

function updatePlayerProfile(stoneType, nickname, skinUrl) {
    const defaultImg = stoneType === 1
        ? "https://placehold.co/40x40/000000/FFFFFF?text=B"
        : "https://placehold.co/40x40/FFFFFF/000000?text=W";
    const finalUrl = skinUrl || defaultImg;

    if (stoneType === 1) {
        getEl('p1-name').innerText = nickname;
        getEl('p1-img').src = finalUrl;
    } else if (stoneType === 2) {
        getEl('p2-name').innerText = nickname;
        getEl('p2-img').src = finalUrl;
    }
}

function logout() {
    showConfirm("로그아웃 하시겠습니까?", () => {
        localStorage.removeItem('nickname');
        if(stompClient) stompClient.disconnect();
        showAlert("로그아웃 되었습니다.");
        setTimeout(() => location.reload(), 500);
    });
}

function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    getEl('themeBtn').innerText = isDark ? 'Light' : 'Dark';
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

// 모달 관련 함수
function showAlert(msg) {
    const modal = getEl('alert-modal');
    if(modal) {
        getEl('alert-msg-text').innerText = msg;
        modal.classList.remove('hidden');
    } else alert(msg);
}
function closeAlert() { getEl('alert-modal').classList.add('hidden'); }

function showConfirm(msg, callback) {
    getEl('confirm-msg-text').innerText = msg;
    getEl('confirm-modal').classList.remove('hidden');
    pendingConfirmCallback = callback;
}
function closeConfirm() { getEl('confirm-modal').classList.add('hidden'); pendingConfirmCallback = null; }
function confirmOk() { if(pendingConfirmCallback) pendingConfirmCallback(); closeConfirm(); }

function fireConfetti() {
    const duration = 2000; const end = Date.now() + duration;
    (function frame() {
        confetti({ particleCount: 3, angle: 60, spread: 55, origin: { x: 0 } });
        confetti({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1 } });
        if (Date.now() < end) requestAnimationFrame(frame);
    }());
}

// --- 7. 이미지 갤러리 로직 (API 경로 /Oh_Mock 적용) ---
function openImageModal() {
    const modal = getEl('image-modal');
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    loadImages();
}
function closeImageModal() {
    getEl('image-modal').classList.add('hidden');
    getEl('image-modal').style.display = 'none';
    getEl('linkInput').value = '';
}
function loadImages() {
    const container = getEl('server-img-list');
    container.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:#888;">로딩 중...</div>';
    const filter = getEl('starFilterCheckbox');
    const isFilterOn = filter ? filter.checked : false;

    fetch(`/api/images/list?username=${encodeURIComponent(myNickname)}`)
        .then(res => res.json())
        .then(list => {
            container.innerHTML = '';
            if(!list || list.length === 0) {
                container.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:#888;">이미지가 없습니다.</div>';
                return;
            }
            if(isFilterOn) list = list.filter(img => img.isStarred);
            list.sort((a,b) => (a.isStarred === b.isStarred) ? b.id - a.id : (a.isStarred ? -1 : 1));

            list.forEach(img => {
                const div = document.createElement('div');
                div.style.cssText = `background-image: url('${img.url}'); background-size: cover; background-position: center; height: 100px; border-radius: 6px; cursor: pointer; border: 1px solid var(--border-color); position: relative;`;
                div.onclick = () => showConfirm("이 이미지를 전송하시겠습니까?", () => { sendImageMessage(img.url); closeImageModal(); });

                const star = document.createElement('div');
                star.innerHTML = img.isStarred ? '<i class="fas fa-star"></i>' : '<i class="far fa-star"></i>';
                star.style.cssText = `position: absolute; top: 5px; right: 5px; color: ${img.isStarred ? '#ffc107' : '#ccc'}; background: rgba(0,0,0,0.3); border-radius: 50%; width: 24px; height: 24px; display: flex; justify-content: center; align-items: center;`;
                star.onclick = (e) => { e.stopPropagation(); toggleStar(img.id); };

                const del = document.createElement('div');
                del.innerHTML = '<i class="fas fa-trash"></i>';
                del.style.cssText = `position: absolute; top: 5px; left: 5px; color: #ff6b6b; background: rgba(0,0,0,0.6); border-radius: 50%; width: 24px; height: 24px; display: flex; justify-content: center; align-items: center;`;
                del.onclick = (e) => { e.stopPropagation(); showConfirm("삭제하시겠습니까?", () => deleteImage(img.id)); };

                div.appendChild(star);
                div.appendChild(del);
                container.appendChild(div);
            });
        })
        .catch(err => container.innerHTML = '<div style="text-align:center;">로드 실패</div>');
}
function toggleStar(id) {
    fetch(`/api/images/${id}/star?username=${encodeURIComponent(myNickname)}`, { method: 'POST' })
        .then(() => loadImages());
}
function deleteImage(id) {
    fetch(`/api/images/${id}`, { method: 'DELETE' })
        .then(res => { if(res.ok) loadImages(); else showAlert("삭제 실패"); });
}
function uploadFile(input) {
    const file = input.files[0];
    if(!file) return;
    showConfirm(`'${file.name}' 업로드?`, () => {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("username", myNickname);
        formData.append("gameType", "oh_mock"); // [수정] 게임 타입

        fetch('/api/images/upload', { method: 'POST', body: formData }).then(res => {
            if(res.ok) loadImages(); else showAlert("업로드 실패");
        });
    });
}
function addExternalLink() {
    const url = getEl('linkInput').value.trim();
    if(!url) return showAlert("URL 입력!");
    showConfirm("링크 등록?", () => {
        const formData = new FormData();
        formData.append("url", url);
        formData.append("username", myNickname);
        formData.append("gameType", "oh_mock"); // [수정] 게임 타입

        fetch('/Oh_Mock/api/images/link', { method: 'POST', body: formData }).then(res => {
            if(res.ok) { getEl('linkInput').value=''; loadImages(); } else showAlert("등록 실패");
        });
    });
}

// window 등록 (중요: HTML에서 함수를 찾을 수 있게)
window.uploadAndEnter = uploadAndEnter;
window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.loadRooms = loadRooms;
window.startGame = startGame;
window.sendChat = sendChat;
window.exitRoom = exitRoom;
window.logout = logout;
window.toggleTheme = toggleTheme;
window.closeAlert = closeAlert;
window.closeConfirm = closeConfirm;
window.confirmOk = confirmOk;
window.openImageModal = openImageModal;
window.closeImageModal = closeImageModal;
window.loadImages = loadImages;
window.uploadFile = uploadFile;
window.addExternalLink = addExternalLink;