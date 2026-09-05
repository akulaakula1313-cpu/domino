const canvas = document.getElementById('boardCanvas');
const ctx = canvas.getContext('2d');
const menuScreen = document.getElementById('menuScreen');
const gameScreen = document.getElementById('gameScreen');
const statusUpdate = document.getElementById('statusUpdate');
const chatBox = document.getElementById('chatBox');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const gameOverScreen = document.getElementById('gameOverScreen');
const resultTitle = document.getElementById('resultTitle');
const resultText = document.getElementById('resultText');
const rematchBtn = document.getElementById('rematchBtn');
const bgMusic = document.getElementById('bgMusic');
const musicToggleBtn = document.getElementById('musicToggleBtn');

const fxCanvas = document.getElementById('fxCanvas');
const fxCtx = fxCanvas.getContext('2d');

const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
const ws = new WebSocket(`${protocol}${window.location.host}`);

let myHand = [];
let tableLine = [];
let myColor = null;
let currentTurn = null;
let selectedBoneIndex = null;
let fireworks = [];
let fireworkTimer = null;

const virtualSize = 400;

function resizeFxCanvas() {
    fxCanvas.width = window.innerWidth;
    fxCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeFxCanvas);
resizeFxCanvas();

function toggleMusic() {
    if (bgMusic.paused) {
        bgMusic.play().catch(e => console.log(e));
        musicToggleBtn.style.opacity = "1";
        musicToggleBtn.style.background = "linear-gradient(to bottom, #22c55e, #16a34a)"; 
    } else {
        bgMusic.pause();
        musicToggleBtn.style.opacity = "0.6";
        musicToggleBtn.style.background = ""; 
    }
}

function playTurnSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        let osc = audioCtx.createOscillator(); let gain = audioCtx.createGain();
        osc.type = 'sine'; osc.frequency.setValueAtTime(600, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(); osc.stop(audioCtx.currentTime + 0.15);
    } catch (e) {}
}

function playErrorSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        let osc = audioCtx.createOscillator(); let gain = audioCtx.createGain();
        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(140, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(); osc.stop(audioCtx.currentTime + 0.25);
    } catch(e){}
}

function playWinSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        [523, 659, 783].forEach((f, idx) => {
            let osc = audioCtx.createOscillator(); let gain = audioCtx.createGain();
            osc.frequency.value = f; gain.gain.setValueAtTime(0.06, audioCtx.currentTime + idx*0.05);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
            osc.connect(gain); gain.connect(audioCtx.destination); osc.start(); osc.stop(audioCtx.currentTime + 0.6);
        });
    } catch(e){}
}

function startGame(mode) {
    menuScreen.style.display = 'none';
    gameScreen.style.display = 'flex';
    chatBox.style.display = mode === 'pvp' ? 'block' : 'none';
    ws.send(JSON.stringify({ type: 'START_GAME', mode }));
    if(bgMusic.paused) { toggleMusic(); }
}

function backToMenu() { window.location.reload(); }
function toggleChat() { chatBox.style.display = chatBox.style.display === 'block' ? 'none' : 'block'; }

function sendChatMessage() {
    const textValue = chatInput.value.trim();
    if(!textValue) return;
    ws.send(JSON.stringify({ type: 'CHAT_MSG', text: textValue }));
    chatInput.value = '';
}
function sendQuickEmoji(emoji) { ws.send(JSON.stringify({ type: 'CHAT_MSG', text: emoji })); }

function takeFromBazar() { ws.send(JSON.stringify({ type: 'TAKE_BAZAR' })); }
function passTurn() { ws.send(JSON.stringify({ type: 'PASS_TURN' })); }
function requestRematch() { ws.send(JSON.stringify({ type: 'REQUEST_REMATCH' })); }

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'WAITING') {
        statusUpdate.innerText = data.message;
        if(data.code) { document.getElementById('generatedCode').innerText = data.code; }
    } else if (data.type === 'GAME_STARTED' || data.type === 'STATE_UPDATE') {
        menuScreen.style.display = 'none';
        document.getElementById('waitingScreen').style.display = 'none';
        gameOverScreen.style.display = 'none';
        gameScreen.style.display = 'flex';
        stopFireworks();

        myHand = data.hand;
        tableLine = data.line;
        
        if (data.turn !== currentTurn && data.turn === myColor) { playTurnSound(); }
        currentTurn = data.turn;
        if (data.color) myColor = data.color;

        document.getElementById('p1Name').innerText = myColor === 'w' ? 'ВЫ (Белые)' : 'ВЫ (Черные)';
        document.getElementById('p2Name').innerText = data.mode === 'bot' ? 'БОТ ИИ' : 'ИГРОК';
        document.getElementById('bazarCounter').innerText = 'БАЗАР: ' + data.bazarCount;
        statusUpdate.innerText = currentTurn === myColor ? 'ВАШ ХОД!' : 'ОЖИДАНИЕ ХОДА...';
        drawGame();
    } else if (data.type === 'MOVE_ERROR') {
        playErrorSound();
    } else if (data.type === 'CHAT_MSG') {
        const msgContainer = document.createElement('div');
        msgContainer.innerHTML = '<b>' + data.sender + ':</b> ' + data.text;
        chatMessages.appendChild(msgContainer);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    } else if (data.type === 'GAME_OVER') {
        gameOverScreen.style.display = 'flex';
        document.getElementById('resultReason').innerText = data.reason;
        if (data.result === 'WIN') {
            resultTitle.innerText = '🎉 ПОБЕДА! 🎉'; resultTitle.className = 'result-title win-style';
            playWinSound(); startFireworks();
        } else {
            resultTitle.innerText = '💀 ПОРАЖЕНИЕ 💀'; resultTitle.className = 'result-title lose-style';
        }
    } else if (data.type === 'REMATCH_REQUESTED') {
        rematchBtn.innerText = '⚡ СОПЕРНИК ХОЧЕТ ИГРАТЬ СНОВА! НАЖМИТЕ';
        rematchBtn.style.background = 'linear-gradient(to bottom, #10b981, #047857)'; 
    } else if (data.type === 'OPPONENT_DISCONNECTED') {
        statusUpdate.innerText = 'Соперник покинул игру.';
    }
};

canvas.addEventListener('click', (e) => {
    if (currentTurn !== myColor) return;

    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;
    const scaleX = virtualSize / rect.width;
    const scaleY = virtualSize / rect.height;
    const vx = clientX * scaleX;
    const vy = clientY * scaleY;

    if (vy > 320) {
        let bCount = myHand.length;
        let bWidth = 35; let bGap = 6;
        let startX = (virtualSize - (bCount * bWidth + (bCount - 1) * bGap)) / 2;

        for (let i = 0; i < bCount; i++) {
            let x1 = startX + i * (bWidth + bGap);
            let x2 = x1 + bWidth;
            if (vx >= x1 && vx <= x2 && vy >= 330 && vy <= 390) {
                selectedBoneIndex = i;
                drawGame();
                return;
            }
        }
    } 
    else if (selectedBoneIndex !== null) {
        let side = vx < (virtualSize / 2) ? 'left' : 'right';
        ws.send(JSON.stringify({ type: 'MAKE_MOVE', boneIndex: selectedBoneIndex, direction: side }));
        selectedBoneIndex = null;
    }
});

function drawBone(x, y, bone, isSelected, isHorizontal) {
    let w = isHorizontal ? 50 : 26;
    let h = isHorizontal ? 26 : 50;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 3;

    let g = ctx.createLinearGradient(x, y, x + w, y + h);
    if(isSelected) {
        g.addColorStop(0, '#fef08a'); g.addColorStop(1, '#eab308');
    } else {
        g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#e2e8f0');
    }
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 4); ctx.fill();
    ctx.restore();

    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);

    ctx.strokeStyle = '#475569'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (isHorizontal) { ctx.moveTo(x + w/2, y); ctx.lineTo(x + w/2, y + h); }
    else { ctx.moveTo(x, y + h/2); ctx.lineTo(x + w, y + h/2); }
    ctx.stroke();

    function drawDots(cx, cy, count) {
        ctx.fillStyle = '#0f172a';
        let r = 2.5;
        let d = 5;
        if (count === 1) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill(); }
        if (count === 2) {
            ctx.beginPath(); ctx.arc(cx - d, cy - d, r, 0, Math.PI*2); ctx.arc(cx + d, cy + d, r, 0, Math.PI*2); ctx.fill();
        }
        if (count === 3) {
            ctx.beginPath(); ctx.arc(cx - d, cy - d, r, 0, Math.PI*2); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.arc(cx + d, cy + d, r, 0, Math.PI*2); ctx.fill();
        }
        if (count === 4) {
            ctx.beginPath(); ctx.arc(cx - d, cy - d, r, 0, Math.PI*2); ctx.arc(cx + d, cy - d, r, 0, Math.PI*2); ctx.arc(cx - d, cy + d, r, 0, Math.PI*2); ctx.arc(cx + d, cy + d, r, 0, Math.PI*2); ctx.fill();
        }
        if (count === 5) {
            ctx.beginPath(); ctx.arc(cx - d, cy - d, r, 0, Math.PI*2); ctx.arc(cx + d, cy - d, r, 0, Math.PI*2); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.arc(cx - d, cy + d, r, 0, Math.PI*2); ctx.arc(cx + d, cy + d, r, 0, Math.PI*2); ctx.fill();
        }
        if (count === 6) {
            ctx.beginPath(); ctx.arc(cx - d, cy - d, r, 0, Math.PI*2); ctx.arc(cx + d, cy - d, r, 0, Math.PI*2); ctx.arc(cx - d, cy, r, 0, Math.PI*2); ctx.arc(cx + d, cy, r, 0, Math.PI*2); ctx.arc(cx - d, cy + d, r, 0, Math.PI*2); ctx.arc(cx + d, cy + d, r, 0, Math.PI*2); ctx.fill();
        }
    }

    if (isHorizontal) { drawDots(x + w/4, y + h/2, bone[0]); drawDots(x + (3*w)/4, y + h/2, bone[1]); }
    else { drawDots(x + w/2, y + h/4, bone[0]); drawDots(x + w/2, y + (3*h)/4, bone[1]); }
}

function drawGame() {
    ctx.clearRect(0, 0, virtualSize, virtualSize);
    let startLineY = 140;
    let currentX = 30;

    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    ctx.fillRect(0, 0, virtualSize/2, 280);
    ctx.fillRect(virtualSize/2, 0, virtualSize/2, 280);
    ctx.font = '10px Arial'; ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.textAlign = 'center';
    ctx.fillText('← КЛИК СЮДА: ВЫЛОЖИТЬ НАЛЕВО', 100, 20);
    ctx.fillText('КЛИК СЮДА: ВЫЛОЖИТЬ НАПРАВО →', 300, 20);

    tableLine.forEach(bone => {
        let isDub = bone[0] === bone[1];
        let rx = currentX;
        let ry = isDub ? startLineY - 12 : startLineY;
        drawBone(rx, ry, bone, false, !isDub);
        currentX += isDub ? 30 : 54;
    });

    let bCount = myHand.length;
    let bWidth = 35; let bGap = 6;
    let startHandX = (virtualSize - (bCount * bWidth + (bCount - 1) * bGap)) / 2;
    for (let i = 0; i < bCount; i++) {
        let hx = startHandX + i * (bWidth + bGap);
        let hy = selectedBoneIndex === i ? 335 : 345;
        drawBone(hx, hy, myHand[i], selectedBoneIndex === i, false);
    }
}

function createFireworkExplosion(x, y) {
    const colors = ['#eab308', '#f97316', '#ef4444', '#3b82f6', '#10b981'];
    let baseColor = colors[Math.floor(Math.random() * colors.length)];
    for (let i = 0; i < 40; i++) {
        let angle = Math.random() * Math.PI * 2; let speed = Math.random() * 4 + 2;
        fireworks.push({ x: x, y: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, alpha: 1, color: baseColor, size: Math.random() * 2 + 2 });
    }
}

function updateFireworksLoop() {
    fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
    for (let i = fireworks.length - 1; i >= 0; i--) {
        let p = fireworks[i]; p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.alpha -= 0.015;
        if (p.alpha <= 0) { fireworks.splice(i, 1); continue; }
        fxCtx.save(); fxCtx.globalAlpha = p.alpha; fxCtx.fillStyle = p.color;
        fxCtx.beginPath(); fxCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2); fxCtx.fill(); fxCtx.restore();
    }
    if (fireworks.length > 0 || fireworkTimer !== null) { requestAnimationFrame(updateFireworksLoop); }
}

function startFireworks() {
    if (fireworkTimer !== null) return;
    updateFireworksLoop();
    fireworkTimer = setInterval(() => {
        createFireworkExplosion(Math.random() * fxCanvas.width, Math.random() * (fxCanvas.height * 0.5) + 100);
    }, 450);
}

function stopFireworks() { clearInterval(fireworkTimer); fireworkTimer = null; fireworks = []; fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height); }
