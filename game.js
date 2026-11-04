'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 점 잇기 상자 따기: 화면·입력·소리. 규칙은 logic.js (LOGIC_DOTS).
const D = LOGIC_DOTS;
const $ = (id) => document.getElementById(id);
const W = 360, H = 640;
const canvas = $('game'), ctx = canvas.getContext('2d');
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
const TUTORIAL = new URLSearchParams(location.search).get('tutorial') === '1';
const RECORD_KEY = 'dotsboxesRecord', WINS_KEY = 'dotsboxesWins';
const COLOR = { 1: '#3fa6ff', 2: '#ff6a6a' };
const loadJson = (k) => { try { return JSON.parse(store.get(k) || '{}') || {}; } catch (_) { return {}; } };

let audio = null, muted = store.get('dotsboxesMuted') === '1';
function ac() { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); return audio; } catch (_) { return null; } }
function tone(freq, dur, type = 'triangle', vol = 0.05, slide = 0) {
  if (muted) return;
  const a = ac(); if (!a) return;
  try {
    const o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  } catch (_) {}
}
const sfx = {
  line() { tone(420, 0.07, 'triangle', 0.05); },
  cpuLine() { tone(300, 0.07, 'triangle', 0.04); },
  box(mine) { [mine ? 660 : 330, mine ? 880 : 440].forEach((f, i) => setTimeout(() => tone(f, 0.12, 'triangle', 0.06), i * 80)); },
  win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.07), i * 90)); },
  lose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.22, 'triangle', 0.06), i * 140)); },
  undo() { tone(400, 0.08, 'triangle', 0.04, -120); },
};
const vibe = (p) => { try { if (window.arcadeVibe) window.arcadeVibe(p); } catch (_) {} };   // 진동: 로비의 진동 설정을 따른다
function toggleMute() { muted = !muted; store.set('dotsboxesMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').textContent = muted ? '🔇' : '🔊';

let G = null, level = 'easy', size = TUTORIAL ? 3 : (+store.get('dotsboxesSize') || 4), hover = -1, cpuTimer = null, lastEdge = -1, flash = new Map(), lastRecord = null, ts0 = 0, floaters = [];

/* @test-hooks:start */
window.__db = { get G() { return G; }, D, draw: () => draw(), geom: () => geom(), cpuNow: () => cpuStep() };
/* @test-hooks:end */

function showOverlay(html) {
  const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); $('bar').classList.add('hidden');
  o.querySelectorAll('button[data-level]').forEach((b) => { b.onclick = () => start(b.dataset.level); });
  o.querySelectorAll('.size').forEach((b) => { b.onclick = () => { size = +b.dataset.size; store.set('dotsboxesSize', String(size)); o.querySelectorAll('.size').forEach((x) => x.classList.toggle('on', x === b)); }; });
  o.querySelectorAll('button[data-act]').forEach((b) => { b.onclick = () => act(b.dataset.act); });
}
function hideOverlay() { $('overlay').classList.add('hidden'); $('bar').classList.remove('hidden'); }
const lvButtons = (withDaily) => `<div class="lv"><button data-level="easy">쉬움<small>실수가 많아요</small></button><button data-level="normal">보통<small>덥석 안 줘요</small></button><button data-level="hard">어려움<small>끝까지 계산해요</small></button>${withDaily && window.arcadeDaily ? arcadeDaily.buttonHtml() : ''}</div>`;
function showTitle() {
  clearTimeout(cpuTimer); G = null;
  const wins = +store.get(WINS_KEY) || 0;
  const sizes = TUTORIAL ? '' : `<div class="sizes">${[3, 4, 5].map((n) => `<span class="size ${n === size ? 'on' : ''}" data-size="${n}">${D.SIZES[n]}</span>`).join('')}</div>`;
  showOverlay(`<h1>점 잇기<br>상자 따기</h1><div class="big">🔵 🟥</div>
    <p>점 사이에 번갈아 <b>선</b>을 그어요<br>네모의 마지막 변을 그으면 내 땅! <b>한 번 더</b> 둬요</p>
    <p class="help">땅을 더 많이 차지한 쪽이 이겨요.<br>세 번째 변을 그으면 상대에게 땅을 줘요</p>
    ${wins ? `<p class="note">컴퓨터를 이긴 횟수 ${wins}번</p>` : ''}${sizes}
    ${lvButtons(false)}`);
}
function act(a) { if (a === 'again') start(level); else if (a === 'menu') showTitle(); else if (a === 'undo') undo(); }

function start(lv) {
  level = lv; clearTimeout(cpuTimer); lastEdge = -1; flash = new Map(); floaters = []; lastRecord = null; hover = -1;
  G = D.newGame(TUTORIAL ? 3 : size, lv, TUTORIAL ? { prefill: [0, 3, 12] } : {});      // 연습: 왼쪽 위 네모는 세 변이 이미 그어져 있다
  hideOverlay(); syncBar();
}
function syncBar() { if (G) $('btnUndo').disabled = !G.history.some((m) => m.who === D.HUMAN) || (G.turn === D.CPU && !G.over); }
$('btnUndo').onclick = () => undo();
$('btnMenu').onclick = () => showTitle();
function undo() {
  if (!G || (G.turn === D.CPU && !G.over)) return;
  if (G.over) rollbackRecord();
  if (D.undo(G)) { clearTimeout(cpuTimer); sfx.undo(); hideOverlay(); syncBar(); }
}
function rollbackRecord() {
  if (!lastRecord) return;
  const rec = loadJson(RECORD_KEY), r = rec[lastRecord.level];
  if (r && r[lastRecord.key] > 0) { r[lastRecord.key]--; store.set(RECORD_KEY, JSON.stringify(rec)); if (lastRecord.key === 'w') store.set(WINS_KEY, String(Math.max(0, (+store.get(WINS_KEY) || 0) - 1))); }
  lastRecord = null;
}

// ---------- 판 모양 ----------
function geom() {
  const n = G ? G.n : 4, s = 270 / n, x0 = (W - n * s) / 2, y0 = 170;
  return { n, s, x0, y0 };
}
function edgeSeg(e) {
  const { s, x0, y0 } = geom(), { type, r, c } = D.edgeInfo(G, e);
  return type === 'h' ? [x0 + c * s, y0 + r * s, x0 + (c + 1) * s, y0 + r * s] : [x0 + c * s, y0 + r * s, x0 + c * s, y0 + (r + 1) * s];
}
function nearestEdge(x, y) {
  const { s } = geom(); let best = -1, bd = s * 0.34;
  for (let e = 0; e < G.E; e++) {
    if (G.edges[e]) continue;
    const [ax, ay, bx, by] = edgeSeg(e), dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    const d = Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

// ---------- 입력 ----------
function pos(e) { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H]; }
const myTurn = () => G && !G.over && G.turn === D.HUMAN;
canvas.addEventListener('pointermove', (e) => { if (!myTurn()) { hover = -1; return; } const [x, y] = pos(e); hover = nearestEdge(x, y); });
canvas.addEventListener('pointerdown', (e) => { if (!myTurn()) return; const [x, y] = pos(e); hover = nearestEdge(x, y); try { canvas.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
canvas.addEventListener('pointerup', (e) => {
  if (!myTurn()) return;
  const [x, y] = pos(e), edge = nearestEdge(x, y); hover = -1;
  if (edge >= 0) humanPlay(edge);
});
canvas.addEventListener('pointerleave', () => { hover = -1; });
function humanPlay(edge) {
  const r = D.play(G, edge, D.HUMAN); if (!r) return;
  lastEdge = edge; sfx.line(); tutorialSignal('line');
  if (r.boxes.length) { sfx.box(true); vibe(25); tutorialSignal('box'); r.boxes.forEach((b) => addFlash(b)); }
  afterMove();
}
function afterMove() {
  syncBar();
  if (G.over) return finish();
  if (G.turn === D.CPU) { clearTimeout(cpuTimer); cpuTimer = setTimeout(cpuStep, 650); }
}
function cpuStep() {
  if (!G || G.over || G.turn !== D.CPU) return;
  const e = D.aiMove(G, Math.random), r = D.play(G, e, D.CPU);
  lastEdge = e; sfx.cpuLine(); tutorialSignal('cpu');
  if (r.boxes.length) { sfx.box(false); r.boxes.forEach((b) => addFlash(b)); }
  afterMove();
}
function addFlash(b) { flash.set(b, performance.now()); }
addEventListener('keydown', (ev) => { if (ev.key === 'm' || ev.key === 'M') toggleMute(); else if ((ev.key === 'z' || ev.key === 'Z') && G) undo(); });

function finish() {
  const rec = loadJson(RECORD_KEY), r = rec[level] || { w: 0, l: 0, d: 0 };
  const key = G.winner === D.HUMAN ? 'w' : G.winner === D.CPU ? 'l' : 'd';
  r[key]++; rec[level] = r; store.set(RECORD_KEY, JSON.stringify(rec));
  if (key === 'w') store.set(WINS_KEY, String((+store.get(WINS_KEY) || 0) + 1));
  lastRecord = { level, key };
  if (!TUTORIAL && window.arcadeRun) arcadeRun({ level: level === 'easy' ? 'easy' : 'normal', bad: key === 'l' });          // 연패 구제(로비): 연달아 지면 쉬움을 권함
  const title = key === 'w' ? '🎉 승리!' : key === 'l' ? '😵 패배' : '🤝 무승부';
  if (key === 'w') sfx.win(); else if (key === 'l') sfx.lose();
  const s = G.score, lab = D.LEVELS[level].label;
  setTimeout(() => {
    if (!G || !G.over) return;                     // 그 사이 무르기
    showOverlay(`<h2>${title}</h2><p class="big">${s[1]} : ${s[2]}</p><p class="help">${lab} · ${D.SIZES[G.n]} · ${r.w}승 ${r.l}패${r.d ? ` ${r.d}무` : ''}</p>
      <button data-act="again">한 판 더</button>${lvButtons(false)}
      <div style="display:flex;gap:8px"><button class="sub" data-act="undo">무르기</button><button class="sub" data-act="menu">메뉴</button></div>`);
  }, 900);
}
function fit() { const s = Math.min(innerWidth / W, innerHeight / H); canvas.style.width = `${Math.floor(W * s)}px`; canvas.style.height = `${Math.floor(H * s)}px`; $('wrap').style.width = canvas.style.width; $('wrap').style.height = canvas.style.height; }
addEventListener('resize', fit); fit();
$('muteBtn').onclick = toggleMute;

// ---------- 그리기 ----------
function draw() {
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#223650'); g.addColorStop(1, '#15202e');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (!G) return;
  const { n, s, x0, y0 } = geom(), now = performance.now();
  // 네모(땅)
  for (let b = 0; b < n * n; b++) {
    const r = Math.floor(b / n), c = b % n, o = G.owner[b];
    if (o) {
      const age = flash.has(b) ? Math.min(1, (now - flash.get(b)) / 300) : 1;
      ctx.fillStyle = COLOR[o]; ctx.globalAlpha = 0.28 + 0.12 * (1 - age); ctx.fillRect(x0 + c * s + 2, y0 + r * s + 2, s - 4, s - 4); ctx.globalAlpha = 1;
      ctx.fillStyle = COLOR[o]; ctx.font = `900 ${Math.round(s * 0.34)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(o === D.HUMAN ? '나' : '컴', x0 + c * s + s / 2, y0 + r * s + s / 2);
    } else if (G.sides[b] === 3) { ctx.fillStyle = 'rgba(255,220,100,.12)'; ctx.fillRect(x0 + c * s + 2, y0 + r * s + 2, s - 4, s - 4); }      // 한 변만 남은 네모
  }
  // 선
  ctx.lineCap = 'round';
  for (let e = 0; e < G.E; e++) {
    const [ax, ay, bx, by] = edgeSeg(e);
    if (!G.edges[e]) { if (e === hover) { ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); } else { ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); } continue; }
    const who = (G.history.find((m) => m.e === e) || {}).who;
    ctx.strokeStyle = who ? COLOR[who] : '#cfd8e6'; ctx.lineWidth = e === lastEdge ? 8 : 6; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }
  // 점
  ctx.fillStyle = '#fff';
  for (let r = 0; r <= n; r++) for (let c = 0; c <= n; c++) { ctx.beginPath(); ctx.arc(x0 + c * s, y0 + r * s, 5, 0, 7); ctx.fill(); }
  // 위쪽 표시
  const turnTxt = G.over ? '끝!' : G.turn === D.HUMAN ? '내 차례' : '컴퓨터 생각 중…';
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.font = '900 22px sans-serif'; ctx.fillStyle = COLOR[1]; ctx.fillText(`나 ${G.score[1]}`, 16, 40);
  ctx.textAlign = 'right'; ctx.fillStyle = COLOR[2]; ctx.fillText(`${G.score[2]} 컴`, W - 56, 40);
  ctx.textAlign = 'center'; ctx.font = '800 15px sans-serif'; ctx.fillStyle = G.turn === D.HUMAN ? '#bfe8ff' : '#ffc0c0'; ctx.fillText(turnTxt, W / 2 - 6, 80);
  ctx.font = '700 11px sans-serif'; ctx.fillStyle = '#9fb0c4'; ctx.fillText(`${D.LEVELS[G.level].label} · ${D.SIZES[G.n]} · 남은 선 ${G.free}`, W / 2 - 6, 106);
}
function frame() { draw(); requestAnimationFrame(frame); }
showTitle();
requestAnimationFrame(frame);
