const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(__dirname));

let rooms = {}; 

function createDominoPack() {
    let pack = [];
    for (let i = 0; i <= 6; i++) {
        for (let j = i; j <= 6; j++) {
            pack.push([i, j]);
        }
    }
    for (let i = pack.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pack[i], pack[j]] = [pack[j], pack[i]];
    }
    return pack;
}

function generateRoomCode() {
    const digits = '0123456789';
    let code = '';
    for (let i = 0; i < 4; i++) { code += digits.charAt(Math.floor(Math.random() * digits.length)); }
    return code;
}

function countHandPoints(hand) {
    let sum = 0;
    hand.forEach(bone => {
        if (bone[0] === 0 && bone[1] === 0 && hand.length === 1) { sum += 25; }
        else { sum += bone[0] + bone[1]; }
    });
    return sum;
}

function hasAnyValidMoves(hand, leftVal, rightVal) {
    if (leftVal === null && rightVal === null) return true;
    return hand.some(bone => bone[0] === leftVal || bone[1] === leftVal || bone[0] === rightVal || bone[1] === rightVal);
}

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
                    mode: 'bot',
                    bazar: pack.slice(14),
                    line: [],
                    leftValue: null,
                    rightValue: null,
                    turn: 'w',
                    hands: { w: pack.slice(0, 7), b: pack.slice(7, 14) },
                    players: { w: ws, b: null },
                    rematchRequests: { w: false, b: false }
                };
                ws.send(JSON.stringify({ type: 'GAME_STARTED', color: 'w', mode: 'bot', hand: rooms[currentRoomCode].hands.w, line: [], turn: 'w', bazarCount: rooms[currentRoomCode].bazar.length }));
                return;
            }

            if (data.type === 'CREATE_ROOM') {
                let code = generateRoomCode();
                while (rooms[code]) { code = generateRoomCode(); }
                currentRoomCode = code;
                myColor = 'w';
                let pack = createDominoPack();
                rooms[code] = {
                    mode: 'pvp',
                    bazar: pack.slice(14),
                    line: [],
                    leftValue: null,
                    rightValue: null,
                    turn: 'w',
                    hands: { w: pack.slice(0, 7), b: pack.slice(7, 14) },
                    players: { w: ws, b: null },
                    rematchRequests: { w: false, b: false }
                };
                ws.send(JSON.stringify({ type: 'WAITING', message: 'Код стола создан', code: code }));
                return;
            }

            if (data.type === 'JOIN_ROOM') {
                let code = data.roomCode;
                if (rooms[code] && rooms[code].mode === 'pvp' && !rooms[code].players.b) {
                    currentRoomCode = code;
                    myColor = 'b';
                    rooms[code].players.b = ws;
                    
                    rooms[code].players.w.send(JSON.stringify({ type: 'GAME_STARTED', color: 'w', mode: 'pvp', hand: rooms[code].hands.w, line: [], turn: 'w', bazarCount: rooms[code].bazar.length }));
                    rooms[code].players.b.send(JSON.stringify({ type: 'GAME_STARTED', color: 'b', mode: 'pvp', hand: rooms[code].hands.b, line: [], turn: 'w', bazarCount: rooms[code].bazar.length }));
                } else {
                    ws.send(JSON.stringify({ type: 'WAITING', message: 'Стол не найден или занят!' }));
                }
                return;
            }

            if (!currentRoomCode || !rooms[currentRoomCode]) return;
            const room = rooms[currentRoomCode];

            if (data.type === 'TAKE_BAZAR') {
                if (room.turn !== myColor) return;
                if (room.bazar.length > 0 && !hasAnyValidMoves(room.hands[myColor], room.leftValue, room.rightValue)) {
                    let newBone = room.bazar.pop();
                    room.hands[myColor].push(newBone);
                    broadcastState(room);
                }
            }

            if (data.type === 'PASS_TURN') {
                if (room.turn !== myColor) return;
                if (room.bazar.length === 0 && !hasAnyValidMoves(room.hands[myColor], room.leftValue, room.rightValue)) {
                    room.turn = room.turn === 'w' ? 'b' : 'w';
                    checkRoundEndOrContinue(room);
                }
            }

            if (data.type === 'MAKE_MOVE') {
                if (room.turn !== myColor) return;
                const { boneIndex, direction } = data;
                let bone = room.hands[myColor][boneIndex];
                if (!bone) {
                    ws.send(JSON.stringify({ type: 'MOVE_ERROR' }));
                    return;
                }

                let success = false;
                if (room.line.length === 0) {
                    room.line.push(bone);
                    room.leftValue = bone[0];
                    room.rightValue = bone[1];
                    success = true;
                } else {
                    if (direction === 'left') {
                        if (bone[1] === room.leftValue) {
                            room.line.unshift(bone);
                            room.leftValue = bone[0];
                            success = true;
                        } else if (bone[0] === room.leftValue) {
                            let flipped = [bone[1], bone[0]];
                            room.line.unshift(flipped);
                            room.leftValue = bone[1];
                            success = true;
                        }
                    } else if (direction === 'right') {
                        if (bone[0] === room.rightValue) {
                            room.line.push(bone);
                            room.rightValue = bone[1];
                            success = true;
                        } else if (bone[1] === room.rightValue) {
                            let flipped = [bone[1], bone[0]];
                            room.line.push(flipped);
                            room.rightValue = bone[0];
                            success = true;
                        }
                    }
                }

                if (success) {
                    room.hands[myColor].splice(boneIndex, 1);
                    if (room.hands[myColor].length === 0) {
                        sendGameOver(room, myColor, 'Выставил все кости!');
                    } else {
                        room.turn = room.turn === 'w' ? 'b' : 'w';
                        checkRoundEndOrContinue(room);
                    }
                } else {
                    ws.send(JSON.stringify({ type: 'MOVE_ERROR' }));
                }
            }

            if (data.type === 'REQUEST_REMATCH') {
                room.rematchRequests[myColor] = true;
                let oppColor = myColor === 'w' ? 'b' : 'w';

                if (room.mode === 'bot') {
                    let pack = createDominoPack();
                    room.bazar = pack.slice(14);
                    room.line = [];
                    room.leftValue = null;
                    room.rightValue = null;
                    room.turn = 'w';
                    room.hands.w = pack.slice(0, 7);
                    room.hands.b = pack.slice(7, 14);
                    room.rematchRequests = { w: false, b: false };
                    ws.send(JSON.stringify({ type: 'GAME_STARTED', color: 'w', mode: 'bot', hand: room.hands.w, line: [], turn: 'w', bazarCount: room.bazar.length }));
                } else {
                    if (room.rematchRequests[oppColor]) {
                        let pack = createDominoPack();
                        room.bazar = pack.slice(14);
                        room.line = [];
                        room.leftValue = null;
                        room.rightValue = null;
                        room.turn = 'w';
                        room.hands.w = pack.slice(0, 7);
                        room.hands.b = pack.slice(7, 14);
                        room.rematchRequests = { w: false, b: false };

                        if (room.players.w && room.players.w.readyState === WebSocket.OPEN) {
                            room.players.w.send(JSON.stringify({ type: 'GAME_STARTED', color: 'w', mode: 'pvp', hand: room.hands.w, line: [], turn: 'w', bazarCount: room.bazar.length }));
                        }
                        if (room.players.b && room.players.b.readyState === WebSocket.OPEN) {
                            room.players.b.send(JSON.stringify({ type: 'GAME_STARTED', color: 'b', mode: 'pvp', hand: room.hands.b, line: [], turn: 'w', bazarCount: room.bazar.length }));
                        }
                    } else {
                        if (room.players[oppColor] && room.players[oppColor].readyState === WebSocket.OPEN) {
                            room.players[oppColor].send(JSON.stringify({ type: 'REMATCH_REQUESTED' }));
                        }
                    }
                }
            }

            if (data.type === 'CHAT_MSG') {
                if (room.mode !== 'pvp') return;
                if (!data.text || typeof data.text !== 'string' || data.text.trim() === '') return;
                const payload = JSON.stringify({ type: 'CHAT_MSG', sender: myColor === 'w' ? 'Белый' : 'Черный', text: data.text.trim() });
                if (room.players.w && room.players.w.readyState === WebSocket.OPEN) room.players.w.send(payload);
                if (room.players.b && room.players.b.readyState === WebSocket.OPEN) room.players.b.send(payload);
            }
        } catch (e) { console.error(e); }
    });

    ws.on('close', () => {
        if (currentRoomCode && rooms[currentRoomCode]) {
            const room = rooms[currentRoomCode];
            let oppColor = myColor === 'w' ? 'b' : 'w';
            if (room.players[oppColor] && room.players[oppColor].readyState === WebSocket.OPEN) {
                room.players[oppColor].send(JSON.stringify({ type: 'OPPONENT_DISCONNECTED' }));
            }
            delete rooms[currentRoomCode];
        }
    });
});

function checkRoundEndOrContinue(room) {
    if (room.bazar.length === 0 && !hasAnyValidMoves(room.hands.w, room.leftValue, room.rightValue) && !hasAnyValidMoves(room.hands.b, room.leftValue, room.rightValue)) {
        let ptsW = countHandPoints(room.hands.w);
        let ptsB = countHandPoints(room.hands.b);
        if (ptsW < ptsB) {
            sendGameOver(room, 'w', 'Рыба! У вас меньше очков: ' + ptsW + ' против ' + ptsB);
        } else if (ptsB < ptsW) {
            sendGameOver(room, 'b', 'Рыба! У соперника меньше очков: ' + ptsB + ' против ' + ptsW);
        } else {
            sendGameOver(room, 'draw', 'Ничья по очкам при Рыбе!');
        }
        return;
    }

    if (room.mode === 'bot' && room.turn === 'b') {
        setTimeout(() => makeBotAiMove(room), 800);
    } else {
        broadcastState(room);
    }
}

function makeBotAiMove(room) {
    let hand = room.hands.b;
    let moved = false;
    for (let i = 0; i < hand.length; i++) {
        let bone = hand[i];
        if (room.line.length === 0) {
            room.line.push(bone);
            room.leftValue = bone[0]; room.rightValue = bone[1];
            hand.splice(i, 1); moved = true; break;
        } else if (bone[0] === room.leftValue || bone[1] === room.leftValue) {
            if (bone[1] === room.leftValue) { room.line.unshift(bone); room.leftValue = bone[0]; }
            else { room.line.unshift([bone[1], bone[0]]); room.leftValue = bone[1]; }
            hand.splice(i, 1); moved = true; break;
        } else if (bone[0] === room.rightValue || bone[1] === room.rightValue) {
            if (bone[0] === room.rightValue) { room.line.push(bone); room.rightValue = bone[1]; }
            else { room.line.push([bone[1], bone[0]]); room.rightValue = bone[0]; }
            hand.splice(i, 1); moved = true; break;
        }
    }

    if (moved) {
        if (room.hands.b.length === 0) {
            sendGameOver(room, 'b', 'Бот выставил все кости!');
        } else {
            room.turn = 'w';
            checkRoundEndOrContinue(room);
        }
    } else {
        if (room.bazar.length > 0) {
            room.hands.b.push(room.bazar.pop());
            if (room.bazar.length === 0 && !hasAnyValidMoves(room.hands.w, room.leftValue, room.rightValue) && !hasAnyValidMoves(room.hands.b, room.leftValue, room.rightValue)) {
                checkRoundEndOrContinue(room);
            } else {
                makeBotAiMove(room);
            }
        } else {
            room.turn = 'w';
            checkRoundEndOrContinue(room);
        }
    }
}

function sendGameOver(room, winnerColor, reason) {
    const payloadW = JSON.stringify({ type: 'GAME_OVER', winner: winnerColor, result: winnerColor === 'w' ? 'WIN' : (winnerColor === 'draw' ? 'DRAW' : 'LOSE'), reason });
    const payloadB = JSON.stringify({ type: 'GAME_OVER', winner: winnerColor, result: winnerColor === 'b' ? 'WIN' : (winnerColor === 'draw' ? 'DRAW' : 'LOSE'), reason });
    if (room.players.w && room.players.w.readyState === WebSocket.OPEN) room.players.w.send(payloadW);
    if (room.players.b && room.players.b.readyState === WebSocket.OPEN) room.players.b.send(payloadB);
}

function broadcastState(room) {
    const payloadW = JSON.stringify({ type: 'STATE_UPDATE', hand: room.hands.w, line: room.line, turn: room.turn, mode: room.mode, bazarCount: room.bazar.length, leftValue: room.leftValue, rightValue: room.rightValue });
    const payloadB = JSON.stringify({ type: 'STATE_UPDATE', hand: room.hands.b, line: room.line, turn: room.turn, mode: room.mode, bazarCount: room.bazar.length, leftValue: room.leftValue, rightValue: room.rightValue });
    if (room.players.w && room.players.w.readyState === WebSocket.OPEN) room.players.w.send(payloadW);
    if (room.players.b && room.players.b.readyState === WebSocket.OPEN) room.players.b.send(payloadB);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер ДОМИНО от SANI GROUP запущен на порту ${PORT}`));