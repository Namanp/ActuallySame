const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));

function createDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const deck = [];
  suits.forEach((suit) => {
    ranks.forEach((rank) => {
      deck.push({ suit, rank });
    });
  });
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function serializePlayers(room) {
  return room.players.map((player) => ({
    id: player.id,
    name: player.name,
    seat: player.seat,
    connected: player.connected,
  }));
}

function getRoom(roomCode) {
  if (!rooms.has(roomCode)) {
    rooms.set(roomCode, {
      code: roomCode,
      players: [],
      hostId: null,
      deck: [],
      board: [],
      stage: 'waiting',
      hand: 0,
    });
  }
  return rooms.get(roomCode);
}

function broadcastRoom(room) {
  io.to(room.code).emit('room:update', {
    code: room.code,
    players: serializePlayers(room),
    hostId: room.hostId,
    board: room.board,
    stage: room.stage,
    hand: room.hand,
  });
}

function deal(room) {
  room.deck = createDeck();
  room.board = [];
  room.stage = 'pre-flop';
  room.hand += 1;
  room.players.forEach((player) => {
    player.hand = [room.deck.pop(), room.deck.pop()];
  });
}

function advanceBoard(room) {
  if (room.stage === 'pre-flop') {
    room.board = room.board.concat([room.deck.pop(), room.deck.pop(), room.deck.pop()]);
    room.stage = 'flop';
  } else if (room.stage === 'flop') {
    room.board = room.board.concat([room.deck.pop()]);
    room.stage = 'turn';
  } else if (room.stage === 'turn') {
    room.board = room.board.concat([room.deck.pop()]);
    room.stage = 'river';
  } else if (room.stage === 'river') {
    room.stage = 'showdown';
  } else if (room.stage === 'showdown') {
    room.stage = 'waiting';
  }
}

io.on('connection', (socket) => {
  socket.on('room:join', ({ name, roomCode }) => {
    const trimmedName = (name || '').trim().slice(0, 20) || 'Player';
    const trimmedRoom = (roomCode || '').trim().toUpperCase().slice(0, 6);
    if (!trimmedRoom) {
      socket.emit('room:error', 'Enter a room code.');
      return;
    }

    const room = getRoom(trimmedRoom);
    const existing = room.players.find((player) => player.id === socket.id);
    if (!existing) {
      room.players.push({
        id: socket.id,
        name: trimmedName,
        seat: room.players.length + 1,
        connected: true,
        hand: [],
      });
    }

    if (!room.hostId) {
      room.hostId = socket.id;
    }

    socket.join(trimmedRoom);
    socket.data.roomCode = trimmedRoom;

    broadcastRoom(room);
    socket.emit('player:hand', existing?.hand || []);
  });

  socket.on('room:start', () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;
    const room = getRoom(roomCode);
    if (room.hostId !== socket.id) {
      socket.emit('room:error', 'Only the host can start the hand.');
      return;
    }
    if (room.players.length < 2) {
      socket.emit('room:error', 'Need at least 2 players to start.');
      return;
    }
    deal(room);
    room.players.forEach((player) => {
      io.to(player.id).emit('player:hand', player.hand);
    });
    broadcastRoom(room);
  });

  socket.on('room:advance', () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;
    const room = getRoom(roomCode);
    if (room.hostId !== socket.id) {
      socket.emit('room:error', 'Only the host can advance the board.');
      return;
    }
    if (room.stage === 'waiting') {
      socket.emit('room:error', 'Start a hand first.');
      return;
    }
    advanceBoard(room);
    broadcastRoom(room);
  });

  socket.on('room:reset', () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;
    const room = getRoom(roomCode);
    if (room.hostId !== socket.id) {
      socket.emit('room:error', 'Only the host can reset the table.');
      return;
    }
    room.board = [];
    room.stage = 'waiting';
    room.players.forEach((player) => {
      player.hand = [];
      io.to(player.id).emit('player:hand', []);
    });
    broadcastRoom(room);
  });

  socket.on('disconnect', () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    const player = room.players.find((entry) => entry.id === socket.id);
    if (player) {
      player.connected = false;
    }
    if (room.hostId === socket.id) {
      const nextHost = room.players.find((entry) => entry.connected);
      room.hostId = nextHost ? nextHost.id : null;
    }
    if (room.players.every((entry) => !entry.connected)) {
      rooms.delete(roomCode);
      return;
    }
    broadcastRoom(room);
  });
});

server.listen(PORT, () => {
  console.log(`Texas Hold'em app running on http://localhost:${PORT}`);
});
