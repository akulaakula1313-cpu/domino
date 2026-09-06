const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(__dirname));

const DB_FILE = path.join(__dirname, 'players_db.json');
let playersDB = {};

if (fs.existsSync(DB_FILE)) {
    try {
        playersDB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
        console.error("Ошибка базы данных, создаем новую:", e);
        playersDB = {};
    }
}

function saveDB() {
    fs.writeFileSync(DB_FILE, JSON.stringify(playersDB, null, 2), 'utf8');
}

let rooms = {}; 

function createDominoPack() {
    let pack = [];
    for (let i = 0; i <= 6; i++) {
        for (let j = i; j <= 6; j++) { pack.push([i, j]); }
    }
    for (let i = pack.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pack[i], pack[j]] = [pack[j], pack[i]];
    }
    return pack;
}

function calculateFinalPoints(hand, room) {
    let sum = 0;
    hand.forEach(bone => {
        if (bone[0] === 0 && bone[1] === 0) {
            sum += room.penalty00 ? 25 : 0;
        } else if (bone[0] === 6 && bone[1] === 6) {
            sum += room.penalty66 ? 50 : 12;
        } else {
            sum += bone[0] + bone[1];
        }
    });
    return sum;
}

function hasAnyValidMoves(hand, leftVal, rightVal) {
    if (leftVal === null && rightVal === null) return true;
    return hand.some(bone => bone[0] === leftVal || bone[1] === leftVal || bone[0] === rightVal || bone[1] === rightVal);
}

app.post('/api/get-account', (req, res) => {
    let { playerId } = req.body;
    if (!playerId || !playersDB[playerId]) {
        playerId = 'player_' + Math.random().toString(36).substring(2, 11);
        playersDB[playerId] = {
            name: 'SaniPark_' + Math.random().toString(36).substring(2, 6).toUpperCase(),
            coins: 300,
            gems: 10,
            bonusDay: 1,
            lastBonusTime: 0,
            stars: 1,
            rankName: 'Бронзовый IV',
            ownedDesigns: ['design_default'],
            currentDesign: 'design_default',
            botStats: { rating: 1000, maxRating: 1000, minRating: 1000, gamesPlayed: 0, wins: 0, draws: 0, losses: 0 },
            onlineStats: { rating: 1000, maxRating: 1000, minRating: 1000, gamesPlayed: 0, wins: 0, draws: 0, losses: 0 }
        };
        saveDB();
    }
    res.json({ playerId, account: playersDB[playerId] });
});

app.post('/api/claim-bonus', (req, res) => {
    const { playerId } = req.body;
    if (!playerId || !playersDB[playerId]) return res.status(400).json({ error: 'Игрок не найден' });

    const player = playersDB[playerId];
    const now = new Date().getTime();
    const oneDayInMs = 24 * 60 * 60 * 1000;

    if (player.lastBonusTime && (now - player.lastBonusTime) < oneDayInMs) {
        const timeLeft = oneDayInMs - (now - player.lastBonusTime);
        const hoursLeft = Math.ceil(timeLeft / (1000 * 60 * 60));
        return res.json({ 
            success: false, 
            message: `Вы уже забрали сегодняшний бонус! Следующий будет доступен через ${hoursLeft} ч.`,
            account: player 
        });
    }

    const currentDay = player.bonusDay || 1;
    const rewards = { 
        1: { coins: 10, gems: 1 }, 2: { coins: 20, gems: 2 }, 3: { coins: 30, gems: 3 }, 
        4: { coins: 40, gems: 4 }, 5: { coins: 50, gems: 5 }, 6: { coins: 100, gems: 10 }, 7: { coins: 300, gems: 30 } 
    };
    
    const prize = rewards[currentDay] || { coins: 10, gems: 1 };
    player.coins += prize.coins;
    player.gems += prize.gems;
    player.lastBonusTime = now;
    player.bonusDay = currentDay >= 7 ? 1 : currentDay + 1;
    
    saveDB();
    res.json({ success: true, account: player, prize });
});

app.post('/api/buy-design', (req, res) => {
    const { playerId, designId, price } = req.body;
    const player = playersDB[playerId];
    if (!player) return res.status(400).json({ error: 'Ошибка' });
    if (player.ownedDesigns.includes(designId)) return res.json({ success: false, message: 'Уже куплено!' });
    if (player.gems < price) return res.json({ success: false, message: 'Недостаточно алмазов!' });

    player.gems -= price;
    player.ownedDesigns.push(designId);
    player.currentDesign = designId;
    saveDB();
    res.json({ success: true, account: player });
});

app.post('/api/select-design', (req, res) => {
    const { playerId, designId } = req.body;
    const player = playersDB[playerId];
    if (!player || !player.ownedDesigns.includes(designId)) return res.json({ success: false, message: 'Ошибка' });
    player.currentDesign = designId;
    saveDB();
    res.json({ success: true, account: player });
});

let globalChatHistory = [];
app.post('/api/get-global-chat', (req, res) => {
    const now = new Date().getTime();
    globalChatHistory = globalChatHistory.filter(msg => (now - msg.timestamp) < (24 * 60 * 60 * 1000));
    res.json({ messages: globalChatHistory });
});

app.post('/api/send-global-chat', (req, res) => {
    const { playerId, text } = req.body;
    const player = playersDB[playerId];
    if (!player || !text.trim()) return res.status(400).json({ error: 'Ошибка' });
    
    globalChatHistory.push({ senderName: player.name, text: text.trim().substring(0, 150), timestamp: new Date().getTime() });
    res.json({ success: true, messages: globalChatHistory });
});

wss.on('connection', (ws) => {
    let currentRoomCode = null;
    let myColor = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'START_GAME' && data.mode === 'bot') {
                currentRoomCode = 'BOT_' + Math.random().toString(36).substring(2, 7);
                myColor = 'w';
                let pack = createDominoPack();
                rooms[currentRoomCode] = {
                    mode: 'bot', botName: data.botName || 'БОТ ИИ', botDifficulty: data.botDifficulty || 'medium',
                    penalty66: data.penalty66, penalty00: data.penalty00, bazar: pack.slice(14), line: [],
                    leftValue: null, rightValue: null, turn: 'w', hands: { w: pack.slice(0, 7), b: pack.slice(7, 14) },
                    players: { w: ws, b: null }
                };
                ws.send(JSON.stringify({ type: 'GAME_STARTED', color: 'w', mode: 'bot', hand: rooms[currentRoomCode].hands.w, line: [], turn: 'w', bazarCount: rooms[currentRoomCode].bazar.length }));
            }

            if (data.type === 'MAKE_MOVE' && currentRoomCode) {
                const room = rooms[currentRoomCode];
                if (!room || room.turn !== myColor) return;
                const { boneIndex, direction } = data;
                let bone = room.hands[myColor][boneIndex];
                if (!bone) return;

                let success = false;
                if (room.line.length === 0) {
                    room.line.push(bone); room.leftValue = bone[0]; room.rightValue = bone[1]; success = true;
                } else {
                    if (direction === 'left') {
                        if (bone[1] === room.leftValue) { room.line.unshift(bone); room.leftValue = bone[0]; success = true; }
                        else if (bone[0] === room.leftValue) { room.line.unshift([bone[1], bone[0]]); room.leftValue = bone[1]; success = true; }
                    } else if (direction === 'right') {
                        if (bone[0] === room.rightValue) { room.line.push(bone); room.rightValue = bone[1]; success = true; }
                        else if (bone[1] === room.rightValue) { room.line.push([bone[1], bone[0]]); room.rightValue = bone[0]; success = true; }
                    }
                }

                if (success) {
                    room.hands[myColor].splice(boneIndex, 1);
                    if (room.hands[myColor].length === 0) { sendGameOver(room, myColor, 'Выставил все кости!'); }
                    else { room.turn = room.turn === 'w' ? 'b' : 'w'; checkRoundEndOrContinue(room); }
                } else { ws.send(JSON.stringify({ type: 'MOVE_ERROR' })); }
            }
        } catch (e) { console.error(e); }
    });
});

function checkRoundEndOrContinue(room) {
    if (room.bazar.length === 0 && !hasAnyValidMoves(room.hands.w, room.leftValue, room.rightValue) && !hasAnyValidMoves(room.hands.b, room.leftValue, room.rightValue)) {
        let ptsW = calculateFinalPoints(room.hands.w, room);
        let ptsB = calculateFinalPoints(room.hands.b, room);
        if (ptsW < ptsB) sendGameOver(room, 'w', 'Рыба! У вас меньше очков: ' + ptsW);
        else sendGameOver(room, 'b', 'Рыба! У бота меньше очков: ' + ptsB);
        return;
    }
    if (room.mode === 'bot' && room.turn === 'b') {
        let botDelay = room.botDifficulty === 'expert' ? 200 : (room.botDifficulty === 'hard' ? 500 : 1000);
        setTimeout(() => makeBotAiMove(room), botDelay);
    } else { broadcastState(room); }
}

function makeBotAiMove(room) {
    let hand = room.hands.b; let moved = false;
    for (let i = 0; i < hand.length; i++) {
        let bone = hand[i];
        if (bone[1] === room.leftValue) { room.line.unshift(bone); room.leftValue = bone[0]; hand.splice(i, 1); moved = true; break; }
        else if (bone[0] === room.leftValue) { room.line.unshift([bone[1], bone[0]]); room.leftValue = bone[1]; hand.splice(i, 1); moved = true; break; }
        else if (bone[0] === room.rightValue) { room.line.push(bone); room.rightValue = bone[1]; hand.splice(i, 1); moved = true; break; }
        else if (bone[1] === room.rightValue) { room.line.push([bone[1], bone[0]]); room.rightValue = bone[0]; hand.splice(i, 1); moved = true; break; }
    }
    if (moved) {
        if (room.hands.b.length === 0) sendGameOver(room, 'b', 'Бот победил!');
        else { room.turn = 'w'; broadcastState(room); }
    } else {
        if (room.bazar.length > 0) { 
            room.hands.b.push(room.bazar.pop()); 
            makeBotAiMove(room); 
        } else { 
            room.turn = 'w'; 
            checkRoundEndOrContinue(room); 
        }
    }
}

function sendGameOver(room, winnerColor, reason) {
    const payload = JSON.stringify({ type: 'GAME_OVER', result: winnerColor === 'w' ? 'WIN' : 'LOSE', reason });
    if (room.players.w) room.players.w.send(payload);
}

function broadcastState(room) {
    const payload = JSON.stringify({ type: 'STATE_UPDATE', hand: room.hands.w, line: room.line, turn: room.turn, mode: room.mode, bazarCount: room.bazar.length, leftValue: room.leftValue, rightValue: room.rightValue });
    if (room.players.w) room.players.w.send(payload);
}

server.listen(3000, () => console.log('Сервер запущен на порту 3000'));