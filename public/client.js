const socket = io();

const connectionStatus = document.getElementById('connectionStatus');
const createButton = document.getElementById('createTable');
const createNameInput = document.getElementById('createName');
const createStackInput = document.getElementById('createStack');
const minBuyInInput = document.getElementById('minBuyIn');
const maxBuyInInput = document.getElementById('maxBuyIn');
const smallBlindInput = document.getElementById('smallBlind');
const bigBlindInput = document.getElementById('bigBlind');

const joinButton = document.getElementById('joinRoom');
const playerNameInput = document.getElementById('playerName');
const roomCodeInput = document.getElementById('roomCode');
const playerStackInput = document.getElementById('playerStack');

const readyToggle = document.getElementById('readyToggle');
const startHandButton = document.getElementById('startHand');
const resetTableButton = document.getElementById('resetTable');

const boardCards = document.getElementById('boardCards');
const handCards = document.getElementById('handCards');
const playersList = document.getElementById('playersList');
const tableStatus = document.getElementById('tableStatus');
const tableSettings = document.getElementById('tableSettings');
const logList = document.getElementById('logList');
const potValue = document.getElementById('potValue');
const currentBetValue = document.getElementById('currentBet');
const minRaiseValue = document.getElementById('minRaise');

const checkButton = document.getElementById('checkButton');
const callButton = document.getElementById('callButton');
const foldButton = document.getElementById('foldButton');
const raiseButton = document.getElementById('raiseButton');
const raiseAmountInput = document.getElementById('raiseAmount');
const turnIndicator = document.getElementById('turnIndicator');

let currentPlayerId = null;
let currentRoom = null;
let currentSeat = null;
let currentStage = 'waiting';
let currentBet = 0;
let currentTurnSeat = null;
let readyState = false;

function logMessage(message) {
  const entry = document.createElement('li');
  entry.textContent = message;
  logList.prepend(entry);
}

function renderCards(container, cards) {
  container.innerHTML = '';
  if (!cards || cards.length === 0) {
    const placeholder = document.createElement('div');
    placeholder.className = 'hint';
    placeholder.textContent = 'No cards yet.';
    container.appendChild(placeholder);
    return;
  }

  cards.forEach((card) => {
    const cardEl = document.createElement('div');
    const isRed = card.suit === '♥' || card.suit === '♦';
    cardEl.className = `card ${isRed ? 'red' : ''}`;
    cardEl.textContent = `${card.rank}${card.suit}`;
    container.appendChild(cardEl);
  });
}

function stageLabel(stage) {
  const labels = {
    waiting: 'Waiting for players',
    'pre-flop': 'Pre-flop',
    flop: 'Flop',
    turn: 'Turn',
    river: 'River',
    showdown: 'Showdown',
  };
  return labels[stage] || stage;
}

function updateActionControls(room) {
  const isMyTurn = currentSeat && room.currentPlayerSeat === currentSeat;
  const canAct = isMyTurn && room.stage !== 'waiting' && room.stage !== 'showdown';

  checkButton.disabled = !canAct;
  callButton.disabled = !canAct;
  foldButton.disabled = !canAct;
  raiseButton.disabled = !canAct;

  if (!currentSeat) {
    turnIndicator.textContent = 'Join a table to see action controls.';
    return;
  }

  if (room.stage === 'waiting') {
    turnIndicator.textContent = 'Waiting for the next hand.';
  } else if (room.stage === 'showdown') {
    turnIndicator.textContent = 'Showdown — start a new hand when ready.';
  } else if (isMyTurn) {
    turnIndicator.textContent = 'Your turn to act.';
  } else {
    turnIndicator.textContent = `Seat ${room.currentPlayerSeat} is acting.`;
  }
}

function updateControls(room) {
  const isHost = room.hostId === currentPlayerId;
  const allReady = room.players.every((player) => player.connected && player.ready);
  readyToggle.disabled = !currentSeat;
  readyToggle.textContent = readyState ? 'Ready ✓' : 'Ready up';

  startHandButton.disabled = !isHost || !allReady || room.stage !== 'waiting';
  resetTableButton.disabled = !isHost;
}

createButton.addEventListener('click', () => {
  socket.emit('table:create', {
    name: createNameInput.value,
    stack: createStackInput.value,
    minBuyIn: minBuyInInput.value,
    maxBuyIn: maxBuyInInput.value,
    smallBlind: smallBlindInput.value,
    bigBlind: bigBlindInput.value,
  });
});

joinButton.addEventListener('click', () => {
  socket.emit('room:join', {
    name: playerNameInput.value,
    roomCode: roomCodeInput.value,
    stack: playerStackInput.value,
  });
});

readyToggle.addEventListener('click', () => {
  readyState = !readyState;
  socket.emit('player:ready', { ready: readyState });
});

startHandButton.addEventListener('click', () => {
  socket.emit('room:start');
});

resetTableButton.addEventListener('click', () => {
  socket.emit('room:reset');
});

checkButton.addEventListener('click', () => {
  socket.emit('player:action', { type: 'check' });
});

callButton.addEventListener('click', () => {
  socket.emit('player:action', { type: 'call' });
});

foldButton.addEventListener('click', () => {
  socket.emit('player:action', { type: 'fold' });
});

raiseButton.addEventListener('click', () => {
  socket.emit('player:action', { type: 'raise', amount: raiseAmountInput.value });
});

socket.on('connect', () => {
  currentPlayerId = socket.id;
  connectionStatus.textContent = 'Connected';
  connectionStatus.style.background = '#14532d';
});

socket.on('disconnect', () => {
  connectionStatus.textContent = 'Disconnected';
  connectionStatus.style.background = '#7f1d1d';
});

socket.on('table:created', ({ roomCode }) => {
  roomCodeInput.value = roomCode;
  playerNameInput.value = createNameInput.value;
  playerStackInput.value = createStackInput.value;
  logMessage(`Table created. Share code ${roomCode}.`);
});

socket.on('room:update', (room) => {
  currentRoom = room.code;
  currentStage = room.stage;
  currentBet = room.currentBet;
  currentTurnSeat = room.currentPlayerSeat;

  renderCards(boardCards, room.board);
  tableStatus.textContent = `${stageLabel(room.stage)} · Hand #${room.hand}`;
  tableSettings.textContent = `Blinds ${room.settings.smallBlind}/${room.settings.bigBlind} · Buy-in ${room.settings.minBuyIn}-${room.settings.maxBuyIn}`;
  potValue.textContent = room.pot;
  currentBetValue.textContent = room.currentBet;
  minRaiseValue.textContent = room.minRaise;

  playersList.innerHTML = '';
  currentSeat = null;
  let selfReady = false;
  room.players.forEach((player) => {
    if (player.id === currentPlayerId) {
      currentSeat = player.seat;
      selfReady = player.ready;
    }
    const playerEl = document.createElement('div');
    playerEl.className = 'player';
    playerEl.innerHTML = `
      <strong>${player.name}</strong>
      <div>Seat ${player.seat} · ${player.position}</div>
      <div>Stack: ${player.stack}</div>
      <div>Bet: ${player.bet}</div>
      <div>${player.connected ? '✅ Connected' : '⚠️ Disconnected'}</div>
      <div>${player.ready ? '🟢 Ready' : '🟡 Not ready'}</div>
    `;
    if (player.id === room.hostId) {
      const badge = document.createElement('div');
      badge.className = 'badge';
      badge.textContent = 'Host';
      playerEl.appendChild(badge);
    }
    if (player.seat === room.currentPlayerSeat) {
      const pill = document.createElement('div');
      pill.className = 'pill';
      pill.textContent = 'Acting';
      playerEl.appendChild(pill);
    }
    playersList.appendChild(playerEl);
  });

  readyState = selfReady;
  updateControls(room);
  updateActionControls(room);
  logMessage(`Table updated: ${stageLabel(room.stage)}.`);
});

socket.on('player:hand', (hand) => {
  renderCards(handCards, hand);
});

socket.on('room:error', (message) => {
  logMessage(`⚠️ ${message}`);
});
