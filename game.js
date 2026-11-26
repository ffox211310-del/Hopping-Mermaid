'use strict';
// ホッピング人魚さん - 試作 v0.1
// 核: ホッピング(棒)ではなく「自分の尾びれ」が着地した瞬間に、その反動で跳ねる。
// 操作: ←→ / A D で体を傾けるだけ。跳ねる方向は体の傾きで決まる。
// ミス: 頭が地形に触れる / ウニに触れる / 落下。

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const elTime = document.getElementById('time');
const elDeaths = document.getElementById('deaths');
const elCheck = document.getElementById('check');
const elMsg = document.getElementById('msg');

const W = canvas.width, H = canvas.height;
const WORLD_W = 3560;
const GRAVITY = 1500;
const BOUNCE = 660;          // 尾が着地したときの跳ねの強さ
const ROT_SPEED = 2.7;       // 傾ける速さ (rad/s)
const MAX_TILT = 1.2;        // 最大傾き (約69度)

// 地形: {x, y, w, h} 上面に尾で着地する。側面は壁蹴り的に跳ね返れる。
const platforms = [
  { x: 0,    y: 460, w: 480, h: 80 },
  { x: 540,  y: 460, w: 240, h: 80 },
  { x: 840,  y: 420, w: 200, h: 26 },
  { x: 1080, y: 360, w: 200, h: 26 },
  { x: 1320, y: 460, w: 300, h: 80 },
  { x: 1700, y: 340, w: 36,  h: 120 }, // 壁: 尾を当てて方向を変える/乗り越える
  { x: 1620, y: 460, w: 420, h: 80 },
  { x: 2100, y: 400, w: 180, h: 26 },
  { x: 2340, y: 340, w: 180, h: 26 },
  { x: 2580, y: 460, w: 340, h: 80 },
  { x: 2980, y: 400, w: 180, h: 26 },
  { x: 3200, y: 460, w: 360, h: 80 },
];
// ウニ: 頭でも尾でも触れたらミス
const hazards = [
  { x: 620,  y: 436, w: 48, h: 24 },
  { x: 1820, y: 436, w: 48, h: 24 },
  { x: 2700, y: 436, w: 48, h: 24 },
];
// 真珠貝チェックポイント: xを通過したら有効化
const checkpoints = [
  { x: 90,   spawnX: 90,   spawnY: 400, label: 'スタート' },
  { x: 1400, spawnX: 1450, spawnY: 400, label: '中間1' },
  { x: 2620, spawnX: 2660, spawnY: 400, label: '中間2' },
];
const goal = { x: 3380, y: 396, w: 64, h: 64 };

const player = {
  x: 90, y: 400, vx: 0, vy: 0,
  angle: 0,        // 0 = 直立。+で右傾き
  squash: 0,       // 尾の潰れ具合 0..1 (着地の瞬間に1、跳ねながら戻る)
  cooldown: 0,     // 連続着地判定の防止
  dead: false,
};
let respawn = { x: checkpoints[0].spawnX, y: checkpoints[0].spawnY, label: checkpoints[0].label };
let deaths = 0;
let startAt = performance.now();
let elapsed = 0;
let cleared = false;
let camX = 0;

const keys = { left: false, right: false };
addEventListener('keydown', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') { keys.left = true; e.preventDefault(); }
  if (e.code === 'ArrowRight' || e.code === 'KeyD') { keys.right = true; e.preventDefault(); }
  if (e.code === 'KeyR') die(false); // Rはミス数に数えずリスポーン
});
addEventListener('keyup', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = false;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
});
function bindHold(id, prop) {
  const el = document.getElementById(id);
  const on = (e) => { keys[prop] = true; e.preventDefault(); };
  const off = () => { keys[prop] = false; };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointerleave', off);
  el.addEventListener('pointercancel', off);
}
bindHold('btn-left', 'left');
bindHold('btn-right', 'right');
document.getElementById('btn-restart').addEventListener('click', () => die(false));

// 体の向きベクトル: 尾->頭 方向 (angle 0 で真上)
function upVec() { return { x: Math.sin(player.angle), y: -Math.cos(player.angle) }; }
function headPos() { const u = upVec(); return { x: player.x + u.x * 28, y: player.y + u.y * 28 }; }
function tailPos() {
  const u = upVec();
  const len = 38 - player.squash * 13; // 着地で尾が潰れて短くなる
  return { x: player.x - u.x * len, y: player.y - u.y * len };
}

// 円と矩形の重なり。重なっていれば {nx, ny, depth} (押し出し法線) を返す
function circleRect(cx, cy, r, rect) {
  const nx0 = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const ny0 = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - nx0, dy = cy - ny0;
  const d2 = dx * dx + dy * dy;
  if (d2 > r * r) return null;
  if (d2 > 0.0001) {
    const d = Math.sqrt(d2);
    return { nx: dx / d, ny: dy / d, depth: r - d };
  }
  // 中心が矩形の内側: 一番浅い辺から出す
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
  player.x = respawn.x; player.y = respawn.y;
  player.vx = 0; player.vy = 0; player.angle = 0; player.squash = 0; player.cooldown = 0;
  if (!cleared) elMsg.textContent = 'ミス… チェックポイントから再開';
}

function update(dt, now) {
  if (cleared) return;
  elapsed = (now - startAt) / 1000;

  // 傾け
  if (keys.left) player.angle -= ROT_SPEED * dt;
  if (keys.right) player.angle += ROT_SPEED * dt;
  player.angle = Math.max(-MAX_TILT, Math.min(MAX_TILT, player.angle));

  // 物理
  player.vy += GRAVITY * dt;
  player.x += player.vx * dt;
  player.y += player.vy * dt;
  player.cooldown = Math.max(0, player.cooldown - dt);
  player.squash = Math.max(0, player.squash - dt * 5);

  const tail = tailPos();
  const head = headPos();

  // 尾の着地 = 跳ねる (このゲームの心臓部)
  for (const p of platforms) {
    const hit = circleRect(tail.x, tail.y, 11, p);
    if (hit) {
      // 尾を地形の外へ押し戻す
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
  // 頭が地形に触れたらミス
  const head2 = headPos();
  for (const p of platforms) {
    if (circleRect(head2.x, head2.y, 11, p)) { die(); return; }
  }
  // ウニ
  const pts = [headPos(), tailPos(), { x: player.x, y: player.y }];
  for (const hz of hazards) {
    for (const pt of pts) {
      if (circleRect(pt.x, pt.y, 10, hz)) { die(); return; }
    }
  }
  // チェックポイント通過
  for (const cp of checkpoints) {
    if (player.x >= cp.x && respawn.x !== cp.spawnX) {
      respawn = { x: cp.spawnX, y: cp.spawnY, label: cp.label };
      elMsg.textContent = 'チェックポイント: ' + cp.label;
    }
  }
  // ゴール
  if (circleRect(player.x, player.y, 18, goal)) {
    cleared = true;
    elMsg.textContent = 'ゴール！ タイム ' + elapsed.toFixed(2) + '秒 / ミス ' + deaths + '回';
    elMsg.classList.add('clear');
  }
  // 落下
  if (player.y > H + 160) { die(); return; }
  // 左端より戻らない
  if (player.x < 16) { player.x = 16; player.vx = Math.max(0, player.vx); }

  camX = Math.max(0, Math.min(WORLD_W - W, player.x - W * 0.38));
}

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

  // 当たり判定の目安 (開発中だけ薄く表示)
  const hd = headPos(), tl = tailPos();
  ctx.fillStyle = 'rgba(255,80,80,0.5)';
  ctx.beginPath(); ctx.arc(hd.x - camX, hd.y, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(80,255,200,0.6)';
  ctx.beginPath(); ctx.arc(tl.x - camX, tl.y, 4, 0, Math.PI * 2); ctx.fill();
}

function draw(now) {
  // 海の背景
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0e4d6e'); g.addColorStop(1, '#07293d');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // 泡 (カメラでゆるく流れる)
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  for (let i = 0; i < 40; i++) {
    const bx = ((i * 173 - camX * 0.5) % (W + 40) + W + 40) % (W + 40) - 20;
    const by = (i * 97 + (now / 30) * (1 + (i % 3) * 0.4)) % (H + 20) - 10;
    ctx.beginPath(); ctx.arc(bx, H - by, 2 + (i % 4), 0, Math.PI * 2); ctx.fill();
  }
  // チェックポイントの真珠貝
  for (const cp of checkpoints) {
    const active = respawn.x === cp.spawnX;
    ctx.fillStyle = active ? '#7ef0d4' : '#5b7d8a';
    ctx.beginPath(); ctx.arc(cp.x - camX, 448, 10, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(cp.x - camX, 448, 4, 0, Math.PI * 2); ctx.fill();
  }
  // 地形 (砂)
  for (const p of platforms) {
    ctx.fillStyle = '#d9b96a';
    ctx.fillRect(p.x - camX, p.y, p.w, p.h);
    ctx.fillStyle = '#b9974b';
    ctx.fillRect(p.x - camX, p.y, p.w, 5);
  }
  // ウニ
  ctx.fillStyle = '#151515';
  for (const hz of hazards) {
    for (let x = hz.x + 6; x < hz.x + hz.w; x += 12) {
      ctx.beginPath(); ctx.arc(x - camX, hz.y + hz.h, 8, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = '#151515'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x - camX, hz.y + hz.h - 6); ctx.lineTo(x - camX - 4, hz.y + 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - camX, hz.y + hz.h - 6); ctx.lineTo(x - camX + 4, hz.y + 2); ctx.stroke();
    }
  }
  // ゴール宝箱
  ctx.fillStyle = '#a86f1c'; ctx.fillRect(goal.x - camX, goal.y, goal.w, goal.h);
  ctx.fillStyle = '#ffd94d'; ctx.fillRect(goal.x - camX, goal.y + 10, goal.w, 8);
  ctx.fillRect(goal.x - camX + goal.w / 2 - 5, goal.y + 22, 10, 12);

  drawMermaid(now);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  update(dt, now);
  draw(now);
  elTime.textContent = elapsed.toFixed(2) + '秒';
  elDeaths.textContent = 'ミス ' + deaths;
  elCheck.textContent = 'チェックポイント ' + respawn.label;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
