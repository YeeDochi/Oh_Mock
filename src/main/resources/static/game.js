// [Face Gomoku] game.js

// --- Theme Logic ---
function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
}
if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark-mode');

// --- Game Logic ---
function generateUUID() { return Math.random().toString(36).substr(2, 9); }

let stompClient = null;
let myNickname = "";
let myUniqueId = generateUUID();
let currentRoomId = "";
let mySkinUrl = "";      // 업로드한 내 이미지 URL
let myStoneType = 0;     // 1: 흑, 2: 백, 0: 관전
let isGameEnded = false;

// 오목판 설정 (15x15)
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const BOARD_SIZE = 15;
const CELL_SIZE = 40; // 격자 간격
const PADDING = 20;   // 테두리 여백

// 1. 입장 프로세스 (파일 업로드 -> 로비 이동)
function uploadAndEnter() {
    const nick = document.getElementById('nicknameInput').value.trim();
    if (!nick) return alert("닉네임을 입력하세요.");
    myNickname = nick;

    const fileInput = document.getElementById('skinInput');
    if (fileInput.files.length > 0) {
        const formData = new FormData();
        formData.append("file", fileInput.files[0]);

        fetch('/Oh_Mock/api/upload', { method: 'POST', body: formData })
            .then(res => res.text())
            .then(url => {
                mySkinUrl = url;
                enterLobby();
            })
            .catch(err => {
                alert("이미지 업로드 실패! 기본 스킨을 사용합니다.");
                enterLobby();
            });
    } else {
        enterLobby();
    }
}

function enterLobby() {
    document.getElementById('welcome-msg').innerText = `환영합니다, ${myNickname}님!`;
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('lobby-screen').classList.remove('hidden');
    loadRooms();
}

// 2. 방 관리 (목록 조회, 생성, 입장)
function loadRooms() {
    fetch('/Oh_Mock/api/rooms').then(res => res.json()).then(rooms => {
        const list = document.getElementById('room-list');
        list.innerHTML = rooms.length ? '' : '<li style="padding:20px; text-align:center;">방이 없습니다.</li>';
        rooms.forEach(room => {
            const li = document.createElement('li');
            li.className = 'room-item';
            li.innerHTML = `<span>${room.roomName}</span> 
                            <button class="btn-default" onclick="joinRoom('${room.roomId}', '${room.roomName}')">입장</button>`;
            list.appendChild(li);
        });
    });
}

function createRoom() {
    const name = document.getElementById('roomNameInput').value;
    if(!name) return alert("방 제목을 입력하세요.");
    fetch(`/Oh_Mock/api/rooms?name=${encodeURIComponent(name)}`, { method: 'POST' })
        .then(res => res.json())
        .then(room => joinRoom(room.roomId, room.roomName));
}

function joinRoom(roomId, roomName) {
    currentRoomId = roomId;
    document.getElementById('room-title-text').innerText = roomName;
    document.getElementById('lobby-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');

    // 오목판 초기화
    drawBoard();
    connectSocket();
}

// 3. 웹소켓 연결
function connectSocket() {
    const socket = new SockJS('/Oh_Mock/ws');
    stompClient = Stomp.over(socket);
    stompClient.debug = null;

    stompClient.connect({}, function () {
        // 입장 메시지 전송 (내 스킨 정보 포함)
        stompClient.send(`/app/${currentRoomId}/join`, {}, JSON.stringify({
            type: 'JOIN', sender: myNickname, senderId: myUniqueId, skinUrl: mySkinUrl
        }));

        // 구독: 착수(Stone) 정보
        stompClient.subscribe(`/topic/${currentRoomId}/stone`, function (msg) {
            const body = JSON.parse(msg.body);
            renderStone(body.row, body.col, body.skinUrl);
        });

        // 구독: 채팅 및 시스템 메시지
        stompClient.subscribe(`/topic/${currentRoomId}/chat`, function (msg) {
            const body = JSON.parse(msg.body);
            handleChatMessage(body);
        });
    });
}

// 4. 오목판 로직
function drawBoard() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 배경 (나무 질감 대신 단순 색상)
    ctx.fillStyle = "#e3c986";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;

    // 격자 그리기
    ctx.beginPath();
    for (let i = 0; i < BOARD_SIZE; i++) {
        // 가로줄
        ctx.moveTo(PADDING, PADDING + i * CELL_SIZE);
        ctx.lineTo(PADDING + (BOARD_SIZE - 1) * CELL_SIZE, PADDING + i * CELL_SIZE);
        // 세로줄
        ctx.moveTo(PADDING + i * CELL_SIZE, PADDING);
        ctx.lineTo(PADDING + i * CELL_SIZE, PADDING + (BOARD_SIZE - 1) * CELL_SIZE);
    }
    ctx.stroke();
}

// 클릭 이벤트: 좌표 계산 후 서버 전송
canvas.addEventListener('click', e => {
    if (isGameEnded || myStoneType === 0) return; // 관전자는 클릭 불가

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 격자 좌표로 변환 (반올림하여 가장 가까운 교차점 찾기)
    const col = Math.round((x - PADDING) / CELL_SIZE);
    const row = Math.round((y - PADDING) / CELL_SIZE);

    // 유효 범위 체크
    if (col < 0 || col >= BOARD_SIZE || row < 0 || row >= BOARD_SIZE) return;

    // 서버로 착수 요청
    stompClient.send(`/app/${currentRoomId}/stone`, {}, JSON.stringify({
        sender: myNickname,
        senderId: myUniqueId,
        row: row,
        col: col,
        stoneType: myStoneType,
        skinUrl: mySkinUrl
    }));
});

// 돌 그리기 (이미지 렌더링)
function renderStone(row, col, imageUrl) {
    const x = PADDING + col * CELL_SIZE;
    const y = PADDING + row * CELL_SIZE;

    const img = new Image();
    // 이미지가 없으면 기본 흑/백 원 그리기 (임시 fallback) 또는 기본 placeholder
    img.src = imageUrl || "https://via.placeholder.com/40/000000/FFFFFF?text=?";

    img.onload = () => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, 17, 0, Math.PI * 2); // 원형으로 자르기
        ctx.clip();
        ctx.drawImage(img, x - 17, y - 17, 34, 34);
        ctx.restore();
    };
}

// 5. 메시지 처리 핸들러
function handleChatMessage(msg) {
    if (msg.senderId === myUniqueId && msg.stoneType) {
        // 내 돌 정보(흑/백/관전) 업데이트
        myStoneType = msg.stoneType;
        const typeText = myStoneType === 1 ? "흑돌 (⚫)" : (myStoneType === 2 ? "백돌 (⚪)" : "관전");
        document.getElementById('my-stone-status').innerText = typeText;
    }

    if (msg.type === 'START') {
        isGameEnded = false;
        drawBoard(); // 새 게임 시작 시 판 초기화
        showChat("SYSTEM", "게임이 시작되었습니다!");
    } else if (msg.type === 'GAME_OVER') {
        isGameEnded = true;
        fireConfetti(); // 승리 축하 효과
        showChat("SYSTEM", msg.content);
    } else if (msg.type === 'EXIT') {
        if(msg.senderId === myUniqueId) location.reload();
        else showChat("SYSTEM", msg.content);
    } else {
        showChat(msg.sender, msg.content);
    }
}

function startGame() {
    stompClient.send(`/app/${currentRoomId}/start`, {}, JSON.stringify({ sender: myNickname }));
}

function sendChat() {
    const val = document.getElementById('chatInput').value.trim();
    if (!val) return;
    stompClient.send(`/app/${currentRoomId}/chat`, {}, JSON.stringify({ sender: myNickname, senderId: myUniqueId, content: val }));
    document.getElementById('chatInput').value = '';
}

function showChat(sender, msg) {
    const div = document.createElement('div');
    div.className = sender === 'SYSTEM' ? 'msg-system' : 'msg-item';
    div.innerHTML = sender === 'SYSTEM' ? msg : `<b>${sender}</b>: ${msg}`;

    const container = document.getElementById('messages');
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function exitRoom() {
    if (stompClient) stompClient.send(`/app/${currentRoomId}/exit`, {}, JSON.stringify({ sender: myNickname, senderId: myUniqueId }));
    location.reload();
}

// 승리 축하 효과
function fireConfetti() {
    const duration = 2000;
    const end = Date.now() + duration;
    (function frame() {
        confetti({ particleCount: 3, angle: 60, spread: 55, origin: { x: 0 } });
        confetti({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1 } });
        if (Date.now() < end) requestAnimationFrame(frame);
    }());
}