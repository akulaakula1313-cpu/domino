const canvas = document.getElementById('boardCanvas');
const ctx = canvas.getContext('2d');
const menuScreen = document.getElementById('menuScreen');
const gameScreen = document.getElementById('gameScreen');

const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
const ws = new WebSocket(`${protocol}${window.location.host}`);

let myHand = []; let tableLine = []; let myColor = null; let currentTurn = null; let selectedBoneIndex = null;
let currentPlayerId = localStorage.getItem('domino_server_player_id') || null;
let useHints = false; let selectedBotName = "Робот"; let localCacheAccountData = null;

const virtualWidth = 800; const virtualHeight = 600;
let activeDesignTheme = { id: 'design_default', bg: '', boneGradStart: '#ffffff', boneGradEnd: '#f7f4eb', dotsColor: '#4a4035' };

const designsConfig = [
    { id: 'design_default', name: 'Классика', price: 0, bg: 'radial-gradient(circle, #fbcfe8 0%, #fed7aa 100%)', start: '#ffffff', end: '#f7f4eb', dots: '#4a4035' },
    { id: 'design_dark', name: 'Матовый', price: 3, bg: '#18181b', start: '#3f3f46', end: '#18181b', dots: '#ffffff' },
    { id: 'design_emerald', name: 'Изумруд', price: 3, bg: '#064e3b', start: '#059669', end: '#047857', dots: '#ffffff' },
    { id: 'design_gold', name: 'Золото', price: 5, bg: '#451a03', start: '#fef08a', end: '#eab308', dots: '#451a03' }
];

function initPlayerAccount() {
    fetch('/api/get-account', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: currentPlayerId })
    })
    .then(res => res.json())
    .then(data => {
        currentPlayerId = data.playerId;
        localStorage.setItem('domino_server_player_id', currentPlayerId);
        updateMenuBalanceDisplay(data.account.coins, data.account.gems);
        if (data.account.currentDesign) applySavedDesignTheme(data.account.currentDesign);
        
        const now = new Date().getTime();
        if (!data.account.lastBonusTime || (now - parseInt(data.account.lastBonusTime)) >= 86400000) {
            document.getElementById('bonusModal').style.display = 'flex';
        }
    });
}

function applySavedDesignTheme(designId) {
    const theme = designsConfig.find(d => d.id === designId);
    if (theme) {
        activeDesignTheme = { id: theme.id, bg: theme.bg, boneGradStart: theme.start, boneGradEnd: theme.end, dotsColor: theme.dots };
        document.body.style.background = theme.bg;
    }
}

function updateMenuBalanceDisplay(coins, gems) {
    if(document.getElementById('menuCoins')) document.getElementById('menuCoins').innerText = coins;
    if(document.getElementById('menuGems')) document.getElementById('menuGems').innerText = gems;
}

function claimDailyBonus() {
    fetch('/api/claim-bonus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: currentPlayerId }) })
    .then(res => res.json()).then(data => {
        updateMenuBalanceDisplay(data.account.coins, data.account.gems);
        closeModal('bonusModal');
        alert(`Получен ежедневный бонус!`);
    });
}

function openBotSelectModal() { document.getElementById('botSelectModal').style.display = 'flex'; }
function selectBotAndStart(name, rank, avatar, difficulty) {
    selectedBotName = name;
    closeModal('botSelectModal');
    document.getElementById('setupBotName').innerText = `Оппонент: ${name} (Рейтинг: ${rank})`;
    document.getElementById('matchSetupModal').style.display = 'flex';
}

function confirmSetupAndStart() {
    closeModal('matchSetupModal');
    menuScreen.style.display = 'none';
    gameScreen.style.display = 'flex';
    ws.send(JSON.stringify({
        type: 'START_GAME', mode: 'bot', botName: selectedBotName,
        penalty66: document.getElementById('penalty66Check').checked,
        penalty00: document.getElementById('penalty00Check').checked
    }));
}

function openFullProfileModal() {
    fetch('/api/get-account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: currentPlayerId }) })
    .then(res => res.json()).then(data => {
        localCacheAccountData = data.account;
        document.getElementById('profNickName').innerText = localCacheAccountData.name;
        document.getElementById('profRankName').innerText = localCacheAccountData.rankName;
        document.getElementById('profStarsCount').innerText = localCacheAccountData.stars;
        switchProfileMode('bot');
        document.getElementById('fullProfileModal').style.display = 'flex';
    });
}

function switchProfileMode(mode) {
    document.getElementById('profTabBot').classList.toggle('active', mode === 'bot');
    document.getElementById('profTabOnline').classList.toggle('active', mode === 'online');
    const s = mode === 'bot' ? localCacheAccountData.botStats : localCacheAccountData.onlineStats;
    document.getElementById('profCurrentRating').innerText = s.rating;
    document.getElementById('profMaxRating').innerText = s.maxRating;
    document.getElementById('profMinRating').innerText = s.minRating;
    document.getElementById('profGamesCount').innerText = s.gamesPlayed;
    document.getElementById('countWins').innerText = s.wins;
    document.getElementById('countDraws').innerText = s.draws;
    document.getElementById('countLosses').innerText = s.losses;
}

function openDesignModal() {
    fetch('/api/get-account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: currentPlayerId }) })
    .then(res => res.json()).then(data => {
        const container = document.getElementById('designGridContainer'); container.innerHTML = '';
        designsConfig.forEach(d => {
            const isOwned = data.account.ownedDesigns.includes(d.id);
            const isActive = data.account.currentDesign === d.id;
            let btn = isOwned ? `<button class="design-buy-btn" style="background:#6b7a52;" onclick="selectDesignServer('${d.id}')">${isActive?'Выбран':'Надеть'}</button>` : `<button class="design-buy-btn" onclick="buyDesignServer('${d.id}', ${d.price})">💎 ${d.price}</button>`;
            container.innerHTML += `<div class="design-item-card ${isActive?'active':''}"><div class="design-preview-box" style="background:${d.bg};"></div><div>${d.name}</div>${btn}</div>`;
        });
        document.getElementById('designModal').style.display = 'flex';
    });
}

function selectDesignServer(designId) {
    fetch('/api/select-design', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: currentPlayerId, designId }) })
    .then(res => res.json()).then(data => { if(data.success) { applySavedDesignTheme(designId); openDesignModal(); } });
}

function buyDesignServer(designId, price) {
    fetch('/api/buy-design', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: currentPlayerId, designId, price }) })
    .then(res => res.json()).then(data => { if(data.success) { updateMenuBalanceDisplay(data.account.coins, data.account.gems); openDesignModal(); } else { alert(data.message); } });
}

function drawBone(x, y, bone, isSelected, isHorizontal) {
    let w = isHorizontal ? 50 : 26; let h = isHorizontal ? 26 : 50;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.15)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 4;
    let g = ctx.createLinearGradient(x, y, x + w, y + h);
    if(isSelected) { g.addColorStop(0, '#fffbeb'); g.addColorStop(1, '#fef08a'); }
    else { g.addColorStop(0, activeDesignTheme.boneGradStart); g.addColorStop(1, activeDesignTheme.boneGradEnd); }
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill(); ctx.restore();

    ctx.strokeStyle = '#d6cfc7'; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.stroke();
    ctx.strokeStyle = '#b0a89f'; ctx.lineWidth = 1; ctx.beginPath();
    if (isHorizontal) { ctx.moveTo(x + w/2, y+2); ctx.lineTo(x + w/2, y + h-2); }
    else { ctx.moveTo(x+2, y + h/2); ctx.lineTo(x + w-2, y + h/2); }
    ctx.stroke();

    function drawDots(cx, cy, count) {
        ctx.fillStyle = activeDesignTheme.dotsColor; let r = 2.2; let d = 5.5;
        if ([1, 3, 5].includes(count)) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill(); }
        if ([2, 3, 4, 5, 6].includes(count)) { ctx.beginPath(); ctx.arc(cx - d, cy - d, r, 0, Math.PI*2); ctx.arc(cx + d, cy + d, r, 0, Math.PI*2); ctx.fill(); }
        if ([4, 5, 6].includes(count)) { ctx.beginPath(); ctx.arc(cx + d, cy - d, r, 0, Math.PI*2); ctx.arc(cx - d, cy + d, r, 0, Math.PI*2); ctx.fill(); }
        if (count === 6) { ctx.beginPath(); ctx.arc(cx - d, cy, r, 0, Math.PI*2); ctx.arc(cx + d, cy, r, 0, Math.PI*2); ctx.fill(); }
    }
    if (isHorizontal) { drawDots(x + w/4, y + h/2, bone[0]); drawDots(x + (3*w)/4, y + h/2, bone[1]); }
    else { drawDots(x + w/2, y + h/4, bone[0]); drawDots(x + w/2, y + (3*h)/4, bone[1]); }
}

function drawGame() {
    ctx.clearRect(0, 0, virtualWidth, virtualHeight);
    if (activeDesignTheme.id !== 'design_default') {
        ctx.fillStyle = activeDesignTheme.bg; ctx.fillRect(0, 0, virtualWidth, virtualHeight);
    } else {
        let gradientBg = ctx.createLinearGradient(0, 0, virtualWidth, virtualHeight);
        gradientBg.addColorStop(0, '#fbcfe8'); gradientBg.addColorStop(0.5, '#fed7aa'); gradientBg.addColorStop(1, '#fcd34d');
        ctx.fillStyle = gradientBg; ctx.fillRect(0, 0, virtualWidth, virtualHeight);
    }

    let startLineY = virtualHeight / 2 - 25; let currentX = 100;
    tableLine.forEach(bone => {
        let isDub = bone[0] === bone[1];
        drawBone(currentX, isDub ? startLineY - 12 : startLineY, bone, false, !isDub);
        currentX += isDub ? 32 : 56;
    });

    let bCount = myHand.length; let bWidth = 40; let bGap = 8;
    let startHandX = (virtualWidth - (bCount * bWidth + (bCount - 1) * bGap)) / 2;
    for (let i = 0; i < bCount; i++) {
        drawBone(startHandX + i * (bWidth + bGap), selectedBoneIndex === i ? virtualHeight - 100 : virtualHeight - 85, myHand[i], selectedBoneIndex === i, false);
    }
}

canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const vx = (e.clientX - rect.left) * (virtualWidth / rect.width);
    const vy = (e.clientY - rect.top) * (virtualHeight / rect.height);
    if (vy > virtualHeight - 100) {
        let bCount = myHand.length; let bWidth = 40; let bGap = 8;
        let startX = (virtualWidth - (bCount * bWidth + (bCount - 1) * bGap)) / 2;
        for (let i = 0; i < bCount; i++) {
            let x1 = startX + i * (bWidth + bGap);
            if (vx >= x1 && vx <= x1 + bWidth) { selectedBoneIndex = i; drawGame(); return; }
        }
    } else if (selectedBoneIndex !== null) {
        let side = vx < (virtualWidth / 2) ? 'left' : 'right';
        ws.send(JSON.stringify({ type: 'MAKE_MOVE', boneIndex: selectedBoneIndex, direction: side }));
        selectedBoneIndex = null;
    }
});

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'GAME_STARTED' || data.type === 'STATE_UPDATE') {
        menuScreen.style.display = 'none'; gameScreen.style.display = 'flex';
        myHand = data.hand; tableLine = data.line; currentTurn = data.turn; if (data.color) myColor = data.color;
        document.getElementById('bazarCounter').innerText = 'БАЗАР: ' + data.bazarCount;
        document.getElementById('sbOpponentName').innerText = selectedBotName.toUpperCase();
        drawGame();
    } else if (data.type === 'GAME_OVER') { alert('Раунд завершен! ' + data.reason); backToMenu(); }
};

function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function openStoreModal() { document.getElementById('storeModal').style.display = 'flex'; }
function backToMenu() { gameScreen.style.display = 'none'; menuScreen.style.display = 'block'; }
function buyHintMidGame() { alert("Подсказки активированы!"); }
function toggleRules() { alert("Правила: Состыкуйте одинаковые цифры на краях."); }

let globalChatInterval = null;
function openGlobalChatModal() { 
    document.getElementById('globalChatModal').style.display = 'flex'; 
    loadGlobalChatFromServer(); 
    if(!globalChatInterval) globalChatInterval = setInterval(loadGlobalChatFromServer, 3000); 
}

function loadGlobalChatFromServer() {
    fetch('/api/get-global-chat', { method: 'POST' }).then(res => res.json()).then(data => {
        const container = document.getElementById('globalChatMessages'); container.innerHTML = '';
        data.messages.forEach(m => { container.innerHTML += `<div><b>${m.senderName}:</b> ${m.text}</div>`; });
    });
}

function sendGlobalChatMessage() {
    const input = document.getElementById('globalChatInput');
    fetch('/api/send-global-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: currentPlayerId, text: input.value }) }).then(() => { input.value = ''; loadGlobalChatFromServer(); });
}

setTimeout(initPlayerAccount, 150);