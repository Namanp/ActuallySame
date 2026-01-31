const socket = io();

const connectionStatus = document.getElementById('connectionStatus');
const joinButton = document.getElementById('joinRoom');
const playerNameInput = document.getElementById('playerName');
const roomCodeInput = document.getElementById('roomCode');
const startHandButton = document.getElementById('startHand');
const advanceBoardButton = document.getElementById('advanceBoard');
const resetTableButton = document.getElementById('resetTable');
const boardCards = document.getElementById('boardCards');
const handCards = document.getElementById('handCards');
const playersList = document.getElementById('playersList');
const tableStatus = document.getElementById('tableStatus');
const logList = document.getElementById('logList');

let currentRoom = null;
let currentPlayerId = null;

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

function updateControls({ hostId, stage }) {
  const isHost = hostId === currentPlayerId;
  startHandButton.disabled = !isHost;
  advanceBoardButton.disabled = !isHost || stage === 'waiting' || stage === 'showdown';
  resetTableButton.disabled = !isHost;
}

function stageLabel(stage) {
  const labels = {
    waiting: 'Waiting for players',
    'pre-flop': 'Pre-flop: Hole cards dealt',
    flop: 'Flop',
    turn: 'Turn',
    river: 'River',
    showdown: 'Showdown',
  };
  return labels[stage] || stage;
}

joinButton.addEventListener('click', () => {
  const name = playerNameInput.value;
  const roomCode = roomCodeInput.value;
  socket.emit('room:join', { name, roomCode });
});

startHandButton.addEventListener('click', () => {
  socket.emit('room:start');
});

advanceBoardButton.addEventListener('click', () => {
  socket.emit('room:advance');
});

resetTableButton.addEventListener('click', () => {
  socket.emit('room:reset');
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

socket.on('room:update', (room) => {
  currentRoom = room.code;
  renderCards(boardCards, room.board);
  tableStatus.textContent = `${stageLabel(room.stage)} · Hand #${room.hand}`;

  playersList.innerHTML = '';
  room.players.forEach((player) => {
    const playerEl = document.createElement('div');
    playerEl.className = 'player';
    playerEl.innerHTML = `
      <strong>${player.name}</strong>
      <div>Seat ${player.seat}</div>
      <div>${player.connected ? '✅ Connected' : '⚠️ Disconnected'}</div>
    `;
    if (player.id === room.hostId) {
      const badge = document.createElement('div');
      badge.className = 'badge';
      badge.textContent = 'Host';
      playerEl.appendChild(badge);
    }
    playersList.appendChild(playerEl);
  });

  updateControls({ hostId: room.hostId, stage: room.stage });
  logMessage(`Table updated: ${stageLabel(room.stage)}.`);
});

socket.on('player:hand', (hand) => {
  renderCards(handCards, hand);
});

socket.on('room:error', (message) => {
  logMessage(`⚠️ ${message}`);
});
