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

const MAX_PLAYERS = 9;

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

function generateRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  if (rooms.has(code)) {
    return generateRoomCode();
  }
  return code;
}

function getRoom(roomCode) {
  return rooms.get(roomCode);
}

function createRoom(settings) {
  const code = generateRoomCode();
  const room = {
    code,
    settings,
    players: [],
    hostId: null,
    deck: [],
    board: [],
    stage: 'waiting',
    hand: 0,
    dealerSeat: null,
    smallBlindSeat: null,
    bigBlindSeat: null,
    currentPlayerSeat: null,
    currentBet: 0,
    minRaise: settings.bigBlind,
    pot: 0,
  };
  rooms.set(code, room);
  return room;
}

function serializePlayers(room) {
  return room.players.map((player) => ({
    id: player.id,
    name: player.name,
    seat: player.seat,
    stack: player.stack,
    bet: player.bet,
    connected: player.connected,
    ready: player.ready,
    folded: player.folded,
    allIn: player.allIn,
    position: player.position,
  }));
}

function broadcastRoom(room) {
  io.to(room.code).emit('room:update', {
    code: room.code,
    settings: room.settings,
    players: serializePlayers(room),
    hostId: room.hostId,
    board: room.board,
    stage: room.stage,
    hand: room.hand,
    dealerSeat: room.dealerSeat,
    smallBlindSeat: room.smallBlindSeat,
    bigBlindSeat: room.bigBlindSeat,
    currentPlayerSeat: room.currentPlayerSeat,
    currentBet: room.currentBet,
    minRaise: room.minRaise,
    pot: room.pot,
  });
}

function getActivePlayers(room) {
  return room.players.filter((player) => player.connected && player.stack > 0);
}

function getPlayersInHand(room) {
  return room.players.filter((player) => player.connected && !player.folded && player.stack > 0);
}

function findPlayerBySeat(room, seat) {
  return room.players.find((player) => player.seat === seat);
}

function nextSeat(room, startSeat, predicate) {
  if (!room.players.length) return null;
  const seats = room.players.map((player) => player.seat).sort((a, b) => a - b);
  const startIndex = seats.indexOf(startSeat);
  for (let offset = 1; offset <= seats.length; offset += 1) {
    const seat = seats[(startIndex + offset) % seats.length];
    const player = findPlayerBySeat(room, seat);
    if (player && predicate(player)) {
      return seat;
    }
  }
  return null;
}

function assignPositions(room) {
  room.players.forEach((player) => {
    player.position = 'Spectator';
  });

  const activeSeats = getActivePlayers(room).map((player) => player.seat).sort((a, b) => a - b);
  if (activeSeats.length < 2) {
    room.dealerSeat = null;
    room.smallBlindSeat = null;
    room.bigBlindSeat = null;
    return;
  }

  if (!room.dealerSeat || !activeSeats.includes(room.dealerSeat)) {
    room.dealerSeat = activeSeats[0];
  } else {
    room.dealerSeat = nextSeat(room, room.dealerSeat, (player) => player.connected && player.stack > 0);
  }

  room.smallBlindSeat = nextSeat(room, room.dealerSeat, (player) => player.connected && player.stack > 0);
  room.bigBlindSeat = nextSeat(room, room.smallBlindSeat, (player) => player.connected && player.stack > 0);

  const dealer = findPlayerBySeat(room, room.dealerSeat);
  const smallBlind = findPlayerBySeat(room, room.smallBlindSeat);
  const bigBlind = findPlayerBySeat(room, room.bigBlindSeat);

  if (dealer) dealer.position = 'Dealer';
  if (smallBlind) smallBlind.position = 'Small Blind';
  if (bigBlind) bigBlind.position = 'Big Blind';
}

function resetBets(room) {
  room.players.forEach((player) => {
    player.bet = 0;
  });
  room.currentBet = 0;
  room.minRaise = room.settings.bigBlind;
}

function postBlind(room, seat, amount) {
  const player = findPlayerBySeat(room, seat);
  if (!player) return;
  const blind = Math.min(amount, player.stack);
  player.stack -= blind;
  player.bet += blind;
  if (player.stack === 0) player.allIn = true;
  room.pot += blind;
  room.currentBet = Math.max(room.currentBet, player.bet);
}

function startHand(room) {
  room.deck = createDeck();
  room.board = [];
  room.stage = 'pre-flop';
  room.hand += 1;
  room.pot = 0;
  room.players.forEach((player) => {
    player.hand = [];
    player.bet = 0;
    player.folded = false;
    player.allIn = false;
  });

  assignPositions(room);

  room.players.forEach((player) => {
    if (player.connected && player.stack > 0) {
      player.hand = [room.deck.pop(), room.deck.pop()];
    }
  });

  postBlind(room, room.smallBlindSeat, room.settings.smallBlind);
  postBlind(room, room.bigBlindSeat, room.settings.bigBlind);
  room.minRaise = room.settings.bigBlind;
  room.currentPlayerSeat = nextSeat(room, room.bigBlindSeat, (player) => player.connected && !player.folded && !player.allIn && player.stack > 0);
}

function shouldEndHand(room) {
  return getPlayersInHand(room).length <= 1;
}

function isBettingRoundComplete(room) {
  const active = room.players.filter((player) => player.connected && !player.folded && !player.allIn);
  if (active.length === 0) return true;
  return active.every((player) => player.bet === room.currentBet);
}

function advanceStage(room) {
  if (shouldEndHand(room)) {
    room.stage = 'showdown';
    room.currentPlayerSeat = null;
    return;
  }

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

  if (room.stage !== 'showdown' && room.stage !== 'waiting') {
    resetBets(room);
    room.currentPlayerSeat = nextSeat(room, room.dealerSeat, (player) => player.connected && !player.folded && !player.allIn && player.stack > 0);
  } else {
    room.currentPlayerSeat = null;
  }
}

function applyAction(room, player, action) {
  if (!player || player.folded || player.allIn || player.stack <= 0) {
    return { error: 'Action not allowed.' };
  }

  const callAmount = room.currentBet - player.bet;
  if (action.type === 'fold') {
    player.folded = true;
    return { success: true };
  }

  if (action.type === 'check') {
    if (callAmount > 0) {
      return { error: 'Cannot check when there is a bet to call.' };
    }
    return { success: true };
  }

  if (action.type === 'call') {
    const amountToCall = Math.min(callAmount, player.stack);
    player.stack -= amountToCall;
    player.bet += amountToCall;
    room.pot += amountToCall;
    if (player.stack === 0) player.allIn = true;
    return { success: true };
  }

  if (action.type === 'raise') {
    const totalBet = Number(action.amount);
    if (!Number.isFinite(totalBet)) {
      return { error: 'Enter a valid raise amount.' };
    }

    const minTotalBet = room.currentBet === 0 ? room.settings.bigBlind : room.currentBet + room.minRaise;
    const desiredTotal = Math.max(totalBet, player.bet);
    const maxTotal = player.bet + player.stack;
    if (desiredTotal > maxTotal) {
      return { error: 'Raise exceeds available stack.' };
    }

    if (desiredTotal < minTotalBet && desiredTotal < maxTotal) {
      return { error: `Minimum raise is ${minTotalBet}.` };
    }

    const raiseAmount = desiredTotal - player.bet;
    player.stack -= raiseAmount;
    player.bet = desiredTotal;
    room.pot += raiseAmount;
    if (player.stack === 0) player.allIn = true;

    room.minRaise = player.bet - room.currentBet;
    room.currentBet = player.bet;
    return { success: true };
  }

  return { error: 'Unknown action.' };
}

io.on('connection', (socket) => {
  socket.on('table:create', ({ name, stack, minBuyIn, maxBuyIn, smallBlind, bigBlind }) => {
    const trimmedName = (name || '').trim().slice(0, 20) || 'Player';
    const settings = {
      minBuyIn: Number(minBuyIn),
      maxBuyIn: Number(maxBuyIn),
      smallBlind: Number(smallBlind),
      bigBlind: Number(bigBlind),
    };

    if (!Number.isFinite(settings.minBuyIn) || !Number.isFinite(settings.maxBuyIn) || !Number.isFinite(settings.smallBlind) || !Number.isFinite(settings.bigBlind)) {
      socket.emit('room:error', 'Enter valid table settings.');
      return;
    }
    if (settings.minBuyIn <= 0 || settings.maxBuyIn < settings.minBuyIn) {
      socket.emit('room:error', 'Buy-in range is invalid.');
      return;
    }
    if (settings.smallBlind <= 0 || settings.bigBlind < settings.smallBlind) {
      socket.emit('room:error', 'Blinds are invalid.');
      return;
    }

    const buyIn = Number(stack);
    if (!Number.isFinite(buyIn) || buyIn < settings.minBuyIn || buyIn > settings.maxBuyIn) {
      socket.emit('room:error', `Starting stack must be between ${settings.minBuyIn} and ${settings.maxBuyIn}.`);
      return;
    }

    const room = createRoom(settings);
    const player = {
      id: socket.id,
      name: trimmedName,
      seat: room.players.length + 1,
      stack: buyIn,
      bet: 0,
      connected: true,
      ready: false,
      folded: false,
      allIn: false,
      hand: [],
      position: 'Dealer',
    };
    room.players.push(player);
    room.hostId = socket.id;

    socket.join(room.code);
    socket.data.roomCode = room.code;

    socket.emit('table:created', { roomCode: room.code });
    broadcastRoom(room);
  });

  socket.on('room:join', ({ name, roomCode, stack }) => {
    const trimmedName = (name || '').trim().slice(0, 20) || 'Player';
    const trimmedRoom = (roomCode || '').trim().toUpperCase().slice(0, 6);
    if (!trimmedRoom) {
      socket.emit('room:error', 'Enter a room code.');
      return;
    }

    const room = getRoom(trimmedRoom);
    if (!room) {
      socket.emit('room:error', 'Table not found.');
      return;
    }

    if (room.players.length >= MAX_PLAYERS) {
      socket.emit('room:error', 'Table is full (9 players max).');
      return;
    }

    const buyIn = Number(stack);
    if (!Number.isFinite(buyIn) || buyIn < room.settings.minBuyIn || buyIn > room.settings.maxBuyIn) {
      socket.emit('room:error', `Starting stack must be between ${room.settings.minBuyIn} and ${room.settings.maxBuyIn}.`);
      return;
    }

    const existing = room.players.find((player) => player.id === socket.id);
    if (!existing) {
      room.players.push({
        id: socket.id,
        name: trimmedName,
        seat: room.players.length + 1,
        stack: buyIn,
        bet: 0,
        connected: true,
        ready: false,
        folded: false,
        allIn: false,
        hand: [],
        position: 'Seat',
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

  socket.on('player:ready', ({ ready }) => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;
    const room = getRoom(roomCode);
    if (!room) return;
    const player = room.players.find((entry) => entry.id === socket.id);
    if (!player) return;
    player.ready = Boolean(ready);
    broadcastRoom(room);
  });

  socket.on('room:start', () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;
    const room = getRoom(roomCode);
    if (!room) return;
    if (room.hostId !== socket.id) {
      socket.emit('room:error', 'Only the host can start the hand.');
      return;
    }
    const readyPlayers = room.players.filter((player) => player.connected && player.ready);
    if (readyPlayers.length < 2 || readyPlayers.length !== room.players.filter((player) => player.connected).length) {
      socket.emit('room:error', 'All connected players must be ready to start.');
      return;
    }
    startHand(room);
    room.players.forEach((player) => {
      io.to(player.id).emit('player:hand', player.hand);
    });
    broadcastRoom(room);
  });

  socket.on('player:action', (action) => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;
    const room = getRoom(roomCode);
    if (!room) return;
    const player = room.players.find((entry) => entry.id === socket.id);
    if (!player) return;
    if (player.seat !== room.currentPlayerSeat) {
      socket.emit('room:error', 'It is not your turn.');
      return;
    }

    const result = applyAction(room, player, action);
    if (result.error) {
      socket.emit('room:error', result.error);
      return;
    }

    if (shouldEndHand(room)) {
      room.stage = 'showdown';
      room.currentPlayerSeat = null;
      broadcastRoom(room);
      return;
    }

    if (isBettingRoundComplete(room)) {
      advanceStage(room);
      broadcastRoom(room);
      return;
    }

    room.currentPlayerSeat = nextSeat(room, player.seat, (entry) => entry.connected && !entry.folded && !entry.allIn && entry.stack > 0);
    broadcastRoom(room);
  });

  socket.on('room:reset', () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;
    const room = getRoom(roomCode);
    if (!room) return;
    if (room.hostId !== socket.id) {
      socket.emit('room:error', 'Only the host can reset the table.');
      return;
    }
    room.board = [];
    room.stage = 'waiting';
    room.pot = 0;
    room.currentBet = 0;
    room.minRaise = room.settings.bigBlind;
    room.currentPlayerSeat = null;
    room.players.forEach((player) => {
      player.hand = [];
      player.bet = 0;
      player.folded = false;
      player.allIn = false;
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
      player.ready = false;
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
