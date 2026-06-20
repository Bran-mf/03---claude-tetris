'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - pale blue
  '#ffb74d', // L - orange
  '#37474f', // 8 - bomb (dark slate)
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

// ---- Power-up registry ----
// Each entry: { color (COLORS index), shape, chance (0-1), onLock(piece) }
// Add new power-ups here to extend the system.
const POWERUPS = {
  bomb: {
    color: 8,
    shape: [[8]], // single 1×1 block
    chance: 0.08, // ~8% per spawn
    onLock(piece) { explode(piece.x, piece.y); },
  },
};

// ---- localStorage keys ----
const LS_HIGHSCORES = 'tetris.highscores';
const LS_MAXLINES = 'tetris.maxlines';

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeBtn = document.getElementById('theme-btn');
const startOverlay = document.getElementById('start-overlay');
const playBtn = document.getElementById('play-btn');
const resetScoresBtn = document.getElementById('reset-scores-btn');
const saveScoreSection = document.getElementById('save-score-section');
const playerNameInput = document.getElementById('player-name');
const saveBtn = document.getElementById('save-btn');
const startHighscoresEl = document.getElementById('start-highscores');
const gameoverHighscoresEl = document.getElementById('gameover-highscores');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let comboCount, maxCombo;
let lastSavedIndex; // index of the newly saved score entry for highlighting

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  // Roll for a power-up first
  for (const [name, def] of Object.entries(POWERUPS)) {
    if (Math.random() < def.chance) {
      const shape = def.shape.map(row => [...row]);
      return {
        type: def.color,
        shape,
        powerup: name,
        x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2),
        y: 0,
      };
    }
  }
  // Normal tetromino
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    comboCount++;
    if (comboCount > maxCombo) maxCombo = comboCount;
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  } else {
    comboCount = 0;
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function explode(cx, cy) {
  let destroyed = 0;
  for (let r = cy - 1; r <= cy + 1; r++)
    for (let c = cx - 1; c <= cx + 1; c++)
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c]) {
        board[r][c] = 0;
        destroyed++;
      }
  score += destroyed * 10;
  updateHUD();
}

function lockPiece() {
  merge();
  if (current.powerup) POWERUPS[current.powerup].onLock(current);
  clearLines();
  // Combo bonus: if comboCount > 0, award extra points
  if (comboCount > 1) {
    score += (comboCount - 1) * 50 * level;
    updateHUD();
  }
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;

  if (colorIndex === 8) {
    // Bomb: dark background square + circular body + fuse dot
    const px = x * size + 1;
    const py = y * size + 1;
    const s = size - 2;
    context.fillStyle = color;
    context.fillRect(px, py, s, s);
    // bomb body circle
    const cx = px + s / 2;
    const cy = py + s / 2 + s * 0.05;
    const r = s * 0.32;
    context.beginPath();
    context.arc(cx, cy, r, 0, Math.PI * 2);
    context.fillStyle = '#1a2a2a';
    context.fill();
    // highlight on circle
    context.beginPath();
    context.arc(cx - r * 0.28, cy - r * 0.28, r * 0.25, 0, Math.PI * 2);
    context.fillStyle = 'rgba(255,255,255,0.3)';
    context.fill();
    // fuse spark
    context.beginPath();
    context.arc(cx + r * 0.5, py + s * 0.12, r * 0.18, 0, Math.PI * 2);
    context.fillStyle = '#ffcc00';
    context.fill();
  } else {
    // Normal block
    context.fillStyle = color;
    context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
    // highlight
    context.fillStyle = 'rgba(255,255,255,0.12)';
    context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  }

  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--color-grid').trim();
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

// ---- High scores ----

function getHighScores() {
  try {
    return JSON.parse(localStorage.getItem(LS_HIGHSCORES)) || [];
  } catch (_) {
    return [];
  }
}

function saveHighScores(scores) {
  localStorage.setItem(LS_HIGHSCORES, JSON.stringify(scores));
}

function getMaxLines() {
  return parseInt(localStorage.getItem(LS_MAXLINES) || '0', 10);
}

function saveMaxLines(n) {
  if (n > getMaxLines()) {
    localStorage.setItem(LS_MAXLINES, String(n));
  }
}

function addHighScore(name, scoreVal, linesVal, maxComboVal) {
  const scores = getHighScores();
  const entry = { name: name.trim() || 'Anónimo', score: scoreVal, lines: linesVal, maxCombo: maxComboVal };
  scores.push(entry);
  scores.sort((a, b) => b.score - a.score);
  if (scores.length > 5) scores.length = 5;
  const idx = scores.indexOf(entry);
  saveHighScores(scores);
  saveMaxLines(linesVal);
  return idx; // -1 if entry was trimmed off (didn't make top 5)
}

function renderHighScores(containerEl, highlightIdx) {
  const scores = getHighScores();
  const maxLines = getMaxLines();

  if (scores.length === 0) {
    containerEl.innerHTML = '<p class="hs-empty">Sin récords aún</p>';
    return;
  }

  const rows = scores.map((entry, i) => {
    const isNew = i === highlightIdx;
    return `<tr class="${isNew ? 'new-record' : ''}">
      <td>${i + 1}</td>
      <td>${escapeHtml(entry.name)}</td>
      <td>${entry.score.toLocaleString()}</td>
      <td>${entry.lines}</td>
      <td>${entry.maxCombo}</td>
    </tr>`;
  }).join('');

  containerEl.innerHTML = `
    <table class="hs-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Nombre</th>
          <th>Puntuación</th>
          <th>Líneas</th>
          <th>Combo</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="hs-maxlines">Máx. líneas en una partida: <strong>${maxLines}</strong></p>
  `;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- End game ----

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  saveMaxLines(lines);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()} | Líneas: ${lines} | Combo: ${maxCombo}`;
  saveScoreSection.classList.remove('hidden');
  playerNameInput.value = '';
  lastSavedIndex = null;
  renderHighScores(gameoverHighscoresEl, null);
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    saveScoreSection.classList.add('hidden');
    gameoverHighscoresEl.innerHTML = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  if (gameOver || paused) return;
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  comboCount = 0;
  maxCombo = 0;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  startOverlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

// ---- Event listeners ----

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

playBtn.addEventListener('click', init);

resetScoresBtn.addEventListener('click', () => {
  localStorage.removeItem(LS_HIGHSCORES);
  localStorage.removeItem(LS_MAXLINES);
  renderHighScores(startHighscoresEl, null);
});

saveBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim() || 'Anónimo';
  const idx = addHighScore(name, score, lines, maxCombo);
  lastSavedIndex = idx;
  saveScoreSection.classList.add('hidden');
  renderHighScores(gameoverHighscoresEl, idx >= 0 ? idx : null);
});

// Allow pressing Enter to save score
playerNameInput.addEventListener('keydown', e => {
  if (e.code === 'Enter') saveBtn.click();
});

themeBtn.addEventListener('click', () => {
  const isLight = document.body.classList.toggle('light');
  themeBtn.textContent = isLight ? 'Dark' : 'Light';
});

// ---- Show start screen (do NOT auto-start) ----
renderHighScores(startHighscoresEl, null);
