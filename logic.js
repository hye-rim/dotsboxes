'use strict';
// 점 잇기 상자 따기: 규칙만 (DOM 없음). 화면·입력·소리는 game.js.
// 점 사이에 번갈아 선을 긋고, 네모의 네 번째 변을 그으면 그 네모는 내 땅이 되고 한 번 더 둔다. 땅이 많은 쪽이 이긴다.
(function (root) {
  const HUMAN = 1, CPU = 2;
  const SIZES = { 3: '3×3', 4: '4×4', 5: '5×5' };                    // 네모 칸 수
  const LEVELS = {
    easy: { label: '쉬움', takeChance: 0.7, safeChance: 0.6 },
    normal: { label: '보통' },
    hard: { label: '어려움', exact: 16 },                           // 남은 선이 이만큼 이하면 끝까지 계산
  };
  const rng = (seed) => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };

  // 선 번호: 가로선 (R+1)×C 개가 먼저(r*C+c), 이어서 세로선 R×(C+1) 개
  function newGame(n, level, opts = {}) {
    const R = n, C = n, H = (R + 1) * C, E = H + R * (C + 1);
    const st = { R, C, H, E, n, level: LEVELS[level] ? level : 'normal', edges: new Uint8Array(E), owner: new Int8Array(R * C), sides: new Uint8Array(R * C), turn: HUMAN, score: [0, 0, 0], free: E, history: [], over: false, winner: 0, events: [] };
    if (opts.prefill) for (const e of opts.prefill) draw(st, e);
    return st;
  }
  function edgeInfo(st, e) {
    if (e < st.H) return { type: 'h', r: Math.floor(e / st.C), c: e % st.C };
    const k = e - st.H; return { type: 'v', r: Math.floor(k / (st.C + 1)), c: k % (st.C + 1) };
  }
  // 이 선에 붙은 네모들 (0~2개)
  function boxesOf(st, e) {
    const { R, C } = st, { type, r, c } = edgeInfo(st, e), out = [];
    if (type === 'h') { if (r > 0) out.push((r - 1) * C + c); if (r < R) out.push(r * C + c); }
    else { if (c > 0) out.push(r * C + c - 1); if (c < C) out.push(r * C + c); }
    return out;
  }
  function draw(st, e) { st.edges[e] = 1; st.free--; for (const b of boxesOf(st, e)) st.sides[b]++; }

  function play(st, e, who) {
    if (st.over || !Number.isInteger(e) || e < 0 || e >= st.E || st.edges[e]) return false;
    who = who || st.turn;
    if (who !== st.turn) return false;
    draw(st, e);
    const boxes = [];
    for (const b of boxesOf(st, e)) if (st.sides[b] === 4) { st.owner[b] = who; st.score[who]++; boxes.push(b); }
    st.history.push({ e, who, boxes });
    st.events.push({ type: 'line', e, who, boxes });
    if (!boxes.length) st.turn = who === HUMAN ? CPU : HUMAN;                   // 네모를 못 만들면 차례가 넘어간다
    if (st.free === 0) {
      st.over = true; st.winner = st.score[HUMAN] > st.score[CPU] ? HUMAN : st.score[CPU] > st.score[HUMAN] ? CPU : 0;
      st.events.push({ type: 'over', winner: st.winner });
    }
    return { boxes };
  }
  function revert(st, m) {
    st.edges[m.e] = 0; st.free++;
    for (const b of boxesOf(st, m.e)) st.sides[b]--;
    for (const b of m.boxes) { st.owner[b] = 0; st.score[m.who]--; }
    st.turn = m.who; st.over = false; st.winner = 0;
  }
  // 무르기: 내 마지막 차례(연속으로 둔 수 포함)를 통째로 되돌린다
  function undo(st) {
    if (!st.history.length || !st.history.some((m) => m.who === HUMAN)) return false;
    while (st.history.length) {
      const m = st.history.pop(); revert(st, m);
      if (m.who === HUMAN && (!st.history.length || st.history[st.history.length - 1].who !== HUMAN)) break;
    }
    st.turn = HUMAN; return true;
  }

  const freeEdges = (st) => { const o = []; for (let e = 0; e < st.E; e++) if (!st.edges[e]) o.push(e); return o; };
  const completes = (st, e) => boxesOf(st, e).filter((b) => st.sides[b] === 3).length;            // 이 선으로 완성되는 네모 수
  const isSafe = (st, e) => boxesOf(st, e).every((b) => st.sides[b] < 2);                         // 세 번째 변을 만들지 않는 선

  // 이 선을 그었을 때 상대가 연달아 가져갈 수 있는 네모 수 (욕심쟁이로 계산)
  function givenAway(st, e) {
    const sides = Uint8Array.from(st.sides), edges = Uint8Array.from(st.edges);
    const put = (x) => { edges[x] = 1; let got = 0; for (const b of boxesOf(st, x)) { sides[b]++; if (sides[b] === 4) got++; } return got; };
    put(e);
    let total = 0;
    for (;;) {
      let took = false;
      for (let x = 0; x < st.E && !took; x++) {
        if (edges[x]) continue;
        if (boxesOf(st, x).some((b) => sides[b] === 3)) { total += put(x); took = true; }
      }
      if (!took) return total;
    }
  }

  // ---------- 끝판 풀이: 남은 선이 적으면 끝까지 계산 ----------
  // value(mask) = 지금 두는 사람이 남은 판에서 (내가 딴 수 - 상대가 딴 수) 의 최댓값
  function makeSolver(st) {
    const fr = freeEdges(st), k = fr.length;
    const pos = new Map(fr.map((e, i) => [e, i]));
    // 네모마다: 이미 그어진 변 수, 아직 안 그어진 변의 비트
    const boxInfo = [];
    for (let b = 0; b < st.R * st.C; b++) boxInfo.push({ fixed: st.sides[b], bits: 0 });
    for (let i = 0; i < k; i++) for (const b of boxesOf(st, fr[i])) boxInfo[b].bits |= 1 << i;
    const adj = fr.map((e) => boxesOf(st, e));
    const pop = (x) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };
    const memo = new Map();
    function gain(mask, i) {
      let g = 0; const m2 = mask | (1 << i);
      for (const b of adj[i]) if (boxInfo[b].fixed + pop(m2 & boxInfo[b].bits) === 4) g++;
      return g;
    }
    function value(mask) {
      if (mask === (1 << k) - 1) return 0;
      const hit = memo.get(mask); if (hit !== undefined) return hit;
      let best = -Infinity;
      for (let i = 0; i < k; i++) {
        if (mask & (1 << i)) continue;
        const g = gain(mask, i), m2 = mask | (1 << i);
        const v = g > 0 ? g + value(m2) : -value(m2);
        if (v > best) best = v;
      }
      memo.set(mask, best); return best;
    }
    const moves = () => fr.map((e, i) => { const g = gain(0, i), v = g > 0 ? g + value(1 << i) : -value(1 << i); return { e, v }; });
    return { value, moves, fr };
  }

  // ---------- 컴퓨터 ----------
  function aiMove(st, rand) {
    rand = rand || Math.random;
    const free = freeEdges(st); if (!free.length) return -1;
    const pick = (a) => a[Math.floor(rand() * a.length)];
    const lv = LEVELS[st.level];
    const takes = free.filter((e) => completes(st, e) > 0);
    if (lv.exact && free.length <= lv.exact) {
      const ms = makeSolver(st).moves(), best = Math.max(...ms.map((m) => m.v));
      return pick(ms.filter((m) => m.v === best)).e;
    }
    if (takes.length && (lv.takeChance === undefined || rand() < lv.takeChance)) {
      const most = Math.max(...takes.map((e) => completes(st, e)));
      return pick(takes.filter((e) => completes(st, e) === most));
    }
    const safe = free.filter((e) => isSafe(st, e));
    if (safe.length && (lv.safeChance === undefined || rand() < lv.safeChance)) return pick(safe);
    if (lv.safeChance !== undefined) return pick(free);                            // 쉬움: 가끔 아무 선이나
    // 어쩔 수 없이 내줄 때는 가장 적게 내주는 선
    const costs = free.map((e) => givenAway(st, e)), low = Math.min(...costs);
    return pick(free.filter((e, i) => costs[i] === low));
  }

  const api = { HUMAN, CPU, SIZES, LEVELS, rng, newGame, edgeInfo, boxesOf, play, undo, freeEdges, completes, isSafe, givenAway, makeSolver, aiMove };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LOGIC_DOTS = api;
})(typeof window !== 'undefined' ? window : globalThis);
