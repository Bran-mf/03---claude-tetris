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

// ---- Skin system ----
const SKIN_PALETTES = {
  retro: COLORS,
  neon: COLORS,  // same palette as base; visual difference is glow rendering
  pastel: [
    null,
    '#b5ead7', // I - mint
    '#ffdac1', // O - peach
    '#c7ceea', // T - lavender
    '#e2f0cb', // S - soft lime
    '#ffb7b2', // Z - salmon pink
    '#b5d5ff', // J - baby blue
    '#ffe0b5', // L - light orange
    '#37474f', // 8 - bomb (keep original)
  ],
  pixel: COLORS,
};

let activeSkin = localStorage.getItem('tetris.skin') || 'retro';

function applyNeonBodyClass() {
  if (activeSkin === 'neon') {
    document.body.classList.add('skin-neon');
  } else {
    document.body.classList.remove('skin-neon');
  }
}

function getSkinColor(colorIndex) {
  const palette = SKIN_PALETTES[activeSkin] || SKIN_PALETTES.retro;
  return palette[colorIndex] || COLORS[colorIndex];
}

function drawRoundRect(context, x, y, width, height, radius) {
  if (context.roundRect) {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    context.fill();
  } else {
    // Fallback using arcs
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + width - r, y);
    context.arcTo(x + width, y, x + width, y + r, r);
    context.lineTo(x + width, y + height - r);
    context.arcTo(x + width, y + height, x + width - r, y + height, r);
    context.lineTo(x + r, y + height);
    context.arcTo(x, y + height, x, y + height - r, r);
    context.lineTo(x, y + r);
    context.arcTo(x, y, x + r, y, r);
    context.closePath();
    context.fill();
  }
}

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

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;

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
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
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
  const color = getSkinColor(colorIndex);
  context.globalAlpha = alpha ?? 1;

  if (colorIndex === 8) {
    // Bomb: dark background square + circular body + fuse dot
    const px = x * size + 1;
    const py = y * size + 1;
    const s = size - 2;
    context.fillStyle = COLORS[8];
    context.fillRect(px, py, s, s);
    // bomb body circle
    const bcx = px + s / 2;
    const bcy = py + s / 2 + s * 0.05;
    const br = s * 0.32;
    context.beginPath();
    context.arc(bcx, bcy, br, 0, Math.PI * 2);
    context.fillStyle = '#1a2a2a';
    context.fill();
    // highlight on circle
    context.beginPath();
    context.arc(bcx - br * 0.28, bcy - br * 0.28, br * 0.25, 0, Math.PI * 2);
    context.fillStyle = 'rgba(255,255,255,0.3)';
    context.fill();
    // fuse spark
    context.beginPath();
    context.arc(bcx + br * 0.5, py + s * 0.12, br * 0.18, 0, Math.PI * 2);
    context.fillStyle = '#ffcc00';
    context.fill();
  } else if (activeSkin === 'neon') {
    // Neon: glow effect
    context.shadowBlur = 12;
    context.shadowColor = color;
    context.fillStyle = color;
    context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
    context.shadowBlur = 0;
    context.shadowColor = 'transparent';
  } else if (activeSkin === 'pastel') {
    // Pastel: rounded corners
    const px = x * size + 2;
    const py = y * size + 2;
    const s = size - 4;
    context.fillStyle = color;
    drawRoundRect(context, px, py, s, s, 5);
    // soft highlight
    context.fillStyle = 'rgba(255,255,255,0.25)';
    drawRoundRect(context, px, py, s, Math.floor(s * 0.3), 5);
  } else if (activeSkin === 'pixel') {
    // Pixel art: internal grid texture
    const px = x * size + 1;
    const py = y * size + 1;
    const s = size - 2;
    context.fillStyle = color;
    context.fillRect(px, py, s, s);
    // Draw internal 4x4 mini-pixel grid with alternating darkened cells
    const gridSize = 4;
    const cellW = s / gridSize;
    const cellH = s / gridSize;
    // Darken helper: parse hex and darken
    const darkColor = darkenColor(color, 0.25);
    for (let gr = 0; gr < gridSize; gr++) {
      for (let gc = 0; gc < gridSize; gc++) {
        if ((gr + gc) % 2 === 1) {
          context.fillStyle = darkColor;
          context.fillRect(
            px + gc * cellW,
            py + gr * cellH,
            cellW,
            cellH
          );
        }
      }
    }
    // highlight strip at top
    context.fillStyle = 'rgba(255,255,255,0.12)';
    context.fillRect(px, py, s, 3);
  } else {
    // Retro (default): flat fill with highlight
    context.fillStyle = color;
    context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
    // highlight
    context.fillStyle = 'rgba(255,255,255,0.12)';
    context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  }

  context.globalAlpha = 1;
}

function darkenColor(hex, amount) {
  // Parse #rrggbb and return a darkened version
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const dr = Math.max(0, Math.floor(r * (1 - amount)));
  const dg = Math.max(0, Math.floor(g * (1 - amount)));
  const db = Math.max(0, Math.floor(b * (1 - amount)));
  return `rgb(${dr},${dg},${db})`;
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

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
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
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

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

themeBtn.addEventListener('click', () => {
  const isLight = document.body.classList.toggle('light');
  themeBtn.textContent = isLight ? 'Dark' : 'Light';
});

const skinSelect = document.getElementById('skin-select');
skinSelect.value = activeSkin;
applyNeonBodyClass();

skinSelect.addEventListener('change', () => {
  activeSkin = skinSelect.value;
  localStorage.setItem('tetris.skin', activeSkin);
  applyNeonBodyClass();
  // Always redraw both canvases so they stay in sync with the new skin,
  // even after game over. draw() only reads board/current/ghost (all valid
  // after game ends). Skip only when paused with game still running, since
  // the overlay is up and the board hasn't changed.
  if (!paused || gameOver) {
    draw();
  }
  drawNext();
});

init();
