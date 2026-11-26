'use strict';
// ホッピング人魚さん - 試作 v0.3
// 本家に寄せて質素に: 全画面 / 灰色ブロック / 赤エリア / 青台+赤旗チェックポイント。
// 核は変えない: 尾びれが着地した瞬間に体の軸方向へ跳ねる。頭が当たればミス。
// 操作: ←→ / A D で傾ける。R でチェックポイントに戻る。

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const elTime = document.getElementById('time');
const elDeaths = document.getElementById('deaths');
const elMsg = document.getElementById('msg');

const W = canvas.width, H = canvas.height;
const WORLD_W = 3900;
const GRAVITY = 1500;
const BOUNCE = 660;
const ROT_SPEED = 2.7;
const MAX_TILT = 1.2;
const GROUND = 420;

// 地形: 全部ただの灰色ブロック
const platforms = [
  { x: 0,    y: GROUND, w: 1050, h: 120 }, // 大きな台地
  { x: 260,  y: 360, w: 70,  h: 60 },       // 台地の上の出っ張り (本家のあれ)
  { x: 1130, y: 370, w: 170, h: 34 },       // 浮きブロック
  { x: 1400, y: 370, w: 170, h: 34 },
  { x: 1750, y: GROUND, w: 950, h: 120 },   // 中間の台地
  { x: 2050, y: 360, w: 70,  h: 60 },
  { x: 2780, y: 370, w: 170, h: 34 },
  { x: 3050, y: 370, w: 170, h: 34 },
  { x: 3300, y: GROUND, w: 600, h: 120 },   // ゴールの台地
];
// 赤エリア: 触れたらミス (本家と同じ、ただの赤い矩形)
const hazards = [
  { x: 1050, y: 480, w: 700, h: 60 },
  { x: 2700, y: 480, w: 600, h: 60 },
];
// チェックポイント: 青い台は最初からある。旗は到達した瞬間に立ち上がる
const checkpoints = [
  { x: 120,  spawnX: 120,  spawnY: 360, label: '', active: true,  animAt: -1000 },
  { x: 1850, spawnX: 1850, spawnY: 360, label: '', active: false, animAt: 0 },
  { x: 3400, spawnX: 3400, spawnY: 360, label: '', active: false, animAt: 0 },
];
const goal = { x: 3740, y: 356, w: 46, h: 64 };

const player = { x: 120, y: 360, vx: 0, vy: 0, angle: 0, squash: 0, cooldown: 0 };
let respawn = checkpoints[0];
let deaths = 0;
let startAt = performance.now();
let elapsed = 0;
let cleared = false;
let camX = 0;

const keys = { left: false, right: false };
addEventListener('keydown', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') { keys.left = true; e.preventDefault(); }
  if (e.code === 'ArrowRight' || e.code === 'KeyD') { keys.right = true; e.preventDefault(); }
  if (e.code === 'KeyR') die(false);
});
addEventListener('keyup', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = false;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
});
function bindHold(id, prop) {
  const el = document.getElementById(id);
  el.addEventListener('pointerdown', (e) => { keys[prop] = true; e.preventDefault(); });
  const off = () => { keys[prop] = false; };
  el.addEventListener('pointerup', off);
  el.addEventListener('pointerleave', off);
  el.addEventListener('pointercancel', off);
}
bindHold('btn-left', 'left');
bindHold('btn-right', 'right');

function upVec() { return { x: Math.sin(player.angle), y: -Math.cos(player.angle) }; }
function headPos() { const u = upVec(); return { x: player.x + u.x * 26, y: player.y + u.y * 26 }; }
function tailPos() {
  const u = upVec();
  const len = 38 - player.squash * 13;
  return { x: player.x - u.x * len, y: player.y - u.y * len };
}
function circleRect(cx, cy, r, rect) {
  const nx0 = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const ny0 = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - nx0, dy = cy - ny0;
  const d2 = dx * dx + dy * dy;
  if (d2 > r * r) return null;
  if (d2 > 0.0001) { const d = Math.sqrt(d2); return { nx: dx / d, ny: dy / d, depth: r - d }; }
  const left = cx - rect.x, right = rect.x + rect.w - cx;
  const top = cy - rect.y, bottom = rect.y + rect.h - cy;
  const m = Math.min(left, right, top, bottom);
  if (m === top) return { nx: 0, ny: -1, depth: top + r };
  if (m === bottom) return { nx: 0, ny: 1, depth: bottom + r };
  if (m === left) return { nx: -1, ny: 0, depth: left + r };
  return { nx: 1, ny: 0, depth: right + r };
}

function die(countIt = true) {
  if (countIt) deaths++;
  player.x = respawn.spawnX; player.y = respawn.spawnY;
  player.vx = 0; player.vy = 0; player.angle = 0; player.squash = 0; player.cooldown = 0;
}

function update(dt, now) {
  if (cleared) return;
  elapsed = (now - startAt) / 1000;
  if (keys.left) player.angle -= ROT_SPEED * dt;
  if (keys.right) player.angle += ROT_SPEED * dt;
  player.angle = Math.max(-MAX_TILT, Math.min(MAX_TILT, player.angle));

  player.vy += GRAVITY * dt;
  player.x += player.vx * dt;
  player.y += player.vy * dt;
  player.cooldown = Math.max(0, player.cooldown - dt);
  player.squash = Math.max(0, player.squash - dt * 5);

  const tail = tailPos();
  for (const p of platforms) {
    const hit = circleRect(tail.x, tail.y, 11, p);
    if (hit) {
      player.x += hit.nx * hit.depth;
      player.y += hit.ny * hit.depth;
      if (player.cooldown <= 0) {
        const u = upVec();
        player.vx = u.x * BOUNCE;
        player.vy = u.y * BOUNCE;
        player.squash = 1;
        player.cooldown = 0.12;
      }
    }
  }
  const head = headPos();
  for (const p of platforms) if (circleRect(head.x, head.y, 11, p)) { die(); return; }
  const pts = [headPos(), tailPos(), { x: player.x, y: player.y }];
  for (const hz of hazards) for (const pt of pts) if (circleRect(pt.x, pt.y, 10, hz)) { die(); return; }
  for (const cp of checkpoints) {
    if (player.x >= cp.x) {
      if (!cp.active) { cp.active = true; cp.animAt = now; } // 旗が立ち上がる瞬間
      respawn = cp;
    }
  }
  if (circleRect(player.x, player.y, 18, goal)) {
    cleared = true;
    elMsg.textContent = 'ゴール ' + elapsed.toFixed(2) + '秒 / ミス ' + deaths;
    elMsg.classList.add('clear');
  }
  if (player.y > H + 160) { die(); return; }
  if (player.x < 16) { player.x = 16; player.vx = Math.max(0, player.vx); }
  camX = Math.max(0, Math.min(WORLD_W - W, player.x - W * 0.38));
}

// 人魚: v0.1の姿に戻す (質素化した棒線版は「謎な者」になったので却下)
function drawMermaid(now) {
  const t = now / 1000;
  ctx.save();
  ctx.translate(player.x - camX, player.y);
  ctx.rotate(player.angle);
  const squash = player.squash;
  const wag = Math.sin(t * 5) * 3; // 尾のゆるい揺れ

  // --- 尾 (腰 y=4 から尾びれ先端まで) ---
  const tipY = 38 - squash * 13;
  const bendX = wag + squash * 10; // 着地時は尾がグニャッと曲がる
  ctx.beginPath();
  ctx.moveTo(-8, 2);
  ctx.quadraticCurveTo(-9 + bendX * 0.4, 22, bendX, tipY);
  ctx.quadraticCurveTo(bendX * 0.4 + 5, 22, 9, 2);
  ctx.closePath();
  ctx.fillStyle = '#1fb6a6';
  ctx.fill();
  // ウロコの線
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  for (let i = 1; i <= 3; i++) {
    const yy = 4 + (tipY - 4) * (i / 4);
    ctx.beginPath(); ctx.moveTo(-7 + bendX * (i / 5), yy); ctx.lineTo(7 + bendX * (i / 5), yy); ctx.stroke();
  }
  // 尾びれ
  ctx.beginPath();
  ctx.moveTo(bendX, tipY - 2);
  ctx.lineTo(bendX - 13, tipY + 11);
  ctx.quadraticCurveTo(bendX, tipY + 5, bendX + 13, tipY + 11);
  ctx.closePath();
  ctx.fillStyle = '#37d0bd';
  ctx.fill();

  // --- 上半身 ---
  ctx.fillStyle = '#ffd9b3'; // 肌
  ctx.fillRect(-6, -16, 12, 20); // 胴
  ctx.beginPath(); ctx.arc(-11, -8, 4, 0, Math.PI * 2); ctx.fill(); // 腕(左)
  ctx.beginPath(); ctx.arc(11, -8, 4, 0, Math.PI * 2); ctx.fill();  // 腕(右)
  ctx.fillStyle = '#8e5bd6'; // 貝殻トップ
  ctx.beginPath(); ctx.arc(-4, -8, 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(4, -8, 4.5, 0, Math.PI * 2); ctx.fill();

  // --- 頭 ---
  ctx.fillStyle = '#ffd9b3';
  ctx.beginPath(); ctx.arc(0, -27, 11, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ff7f6b'; // 髪
  ctx.beginPath(); ctx.arc(0, -31, 11.5, Math.PI, Math.PI * 2); ctx.fill();
  ctx.fillRect(-11.5, -31, 5, 20);
  ctx.fillStyle = '#222'; // 目
  ctx.beginPath(); ctx.arc(-4, -26, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(4, -26, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function draw(now) {
  // 海: 上が明るいだけのグラデーション + 泡が少し
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#a5d8ea'); g.addColorStop(1, '#4b96b5');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  for (let i = 0; i < 14; i++) {
    const bx = ((i * 211 - camX * 0.4) % (W + 30) + W + 30) % (W + 30) - 15;
    const by = (i * 131 + now / 40 * (1 + (i % 3) * 0.3)) % (H + 20) - 10;
    ctx.beginPath(); ctx.arc(bx, H - by, 3, 0, Math.PI * 2); ctx.fill();
  }
  // 赤エリア
  ctx.fillStyle = '#e5534b';
  for (const hz of hazards) ctx.fillRect(hz.x - camX, hz.y, hz.w, hz.h);
  // 灰色ブロック
  ctx.fillStyle = '#8b9094';
  for (const p of platforms) ctx.fillRect(p.x - camX, p.y, p.w, p.h);
  // チェックポイント: 青い台は常時。旗は到達した瞬間に0→52pxへ立ち上がる (350ms)
  for (const cp of checkpoints) {
    const topY = GROUND;
    ctx.fillStyle = cp.active ? '#5b8cff' : '#9db9e8';
    ctx.fillRect(cp.x - camX - 35, topY - 6, 70, 6);
    if (!cp.active) continue;
    const p = Math.min(1, (now - cp.animAt) / 350);
    const ease = 1 - (1 - p) * (1 - p);
    const poleH = 52 * ease;
    if (poleH < 2) continue;
    const px = cp.x - camX + 21, top = topY - poleH;
    ctx.strokeStyle = '#6b4a2f'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cp.x - camX + 18, topY); ctx.lineTo(px, top); ctx.stroke();
    ctx.fillStyle = '#e5534b';
    ctx.beginPath();
    ctx.moveTo(px, top);
    ctx.lineTo(px + 28 * ease, top + 8);
    ctx.lineTo(px, top + 16 * ease);
    ctx.closePath(); ctx.fill();
  }
  // ゴール旗 (金)
  ctx.strokeStyle = '#6b4a2f'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(goal.x - camX + 6, GROUND); ctx.lineTo(goal.x - camX + 6, GROUND - 64); ctx.stroke();
  ctx.fillStyle = '#ffd94d';
  ctx.beginPath();
  ctx.moveTo(goal.x - camX + 6, GROUND - 64);
  ctx.lineTo(goal.x - camX + 40, GROUND - 54);
  ctx.lineTo(goal.x - camX + 6, GROUND - 44);
  ctx.closePath(); ctx.fill();

  drawMermaid(now);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  update(dt, now);
  draw(now);
  elTime.textContent = elapsed.toFixed(2);
  elDeaths.textContent = deaths ? 'ミス ' + deaths : '';
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
