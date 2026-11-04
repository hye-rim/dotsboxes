'use strict';
const test = require('node:test');
const assert = require('node:assert');
const D = require('../logic.js');

// 사람 자리를 바꿔 가며 두 단계 컴퓨터가 겨룬다
function match(n, first, second, seed) {
  const st = D.newGame(n, 'normal'), r = D.rng(seed), lv = { 1: first, 2: second };
  for (let i = 0; i < 400 && !st.over; i++) { st.level = lv[st.turn]; assert.ok(D.play(st, D.aiMove(st, r))); }
  assert.ok(st.over);
  return st.winner;
}

test('edge counts and box adjacency', () => {
  const st = D.newGame(3, 'normal');
  assert.strictEqual(st.E, 24);
  assert.strictEqual(st.free, 24);
  for (let e = 0; e < st.E; e++) { const b = D.boxesOf(st, e); assert.ok(b.length >= 1 && b.length <= 2, 'edge ' + e); }
  const total = Array.from({ length: st.E }, (_, e) => D.boxesOf(st, e).length).reduce((a, b) => a + b, 0);
  assert.strictEqual(total, 9 * 4);                                  // 네모마다 변 4개
});

test('drawing the fourth side claims the box and gives another turn', () => {
  const st = D.newGame(3, 'normal', { prefill: [0, 3, 12] });         // 왼쪽 위 네모의 위·아래·왼쪽 변
  assert.deepStrictEqual(D.boxesOf(st, 13), [0, 1]);
  const r = D.play(st, 13);
  assert.deepStrictEqual(r.boxes, [0]);
  assert.strictEqual(st.owner[0], D.HUMAN);
  assert.strictEqual(st.score[D.HUMAN], 1);
  assert.strictEqual(st.turn, D.HUMAN);                              // 한 번 더
});

test('a line that finishes nothing passes the turn', () => {
  const st = D.newGame(3, 'normal');
  D.play(st, 0);
  assert.strictEqual(st.turn, D.CPU);
});

test('one line can finish two boxes', () => {
  // 가운데 줄 맨 위 네모(0,0)과 (1,0) 사이의 가로선 = 번호 3(r=1,c=0)
  const around = (b) => { const r = Math.floor(b / 3), c = b % 3; return [r * 3 + c, (r + 1) * 3 + c, 12 + r * 4 + c, 12 + r * 4 + c + 1]; };
  const need = new Set([...around(0), ...around(3)]); need.delete(3);
  const s2 = D.newGame(3, 'normal', { prefill: [...need] });
  const r = D.play(s2, 3);
  assert.deepStrictEqual(r.boxes.sort(), [0, 3]);
  assert.strictEqual(s2.score[D.HUMAN], 2);
});

test('rejects bad moves and the wrong player', () => {
  const st = D.newGame(3, 'normal');
  assert.strictEqual(D.play(st, -1), false);
  assert.strictEqual(D.play(st, 99), false);
  assert.strictEqual(D.play(st, 1.5), false);
  D.play(st, 0);
  assert.strictEqual(D.play(st, 0), false);                          // 이미 그은 선
  assert.strictEqual(D.play(st, 1, D.HUMAN), false);                 // 컴퓨터 차례
});

test('game ends when every line is drawn and scores add up', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const st = D.newGame(4, 'normal'), r = D.rng(seed);
    while (!st.over) D.play(st, D.aiMove(st, r));
    assert.strictEqual(st.free, 0);
    assert.strictEqual(st.score[1] + st.score[2], 16);
    assert.ok(Array.from(st.owner).every((o) => o === 1 || o === 2));
    assert.strictEqual(st.winner, st.score[1] > st.score[2] ? 1 : st.score[2] > st.score[1] ? 2 : 0);
  }
});

test('undo takes back the whole last turn of the player', () => {
  const st = D.newGame(3, 'normal'), r = D.rng(3);
  D.play(st, 0);                                                      // 사람
  while (st.turn === D.CPU) D.play(st, D.aiMove(st, r));              // 컴퓨터
  assert.strictEqual(st.turn, D.HUMAN);
  const before = st.history.length;
  assert.ok(D.undo(st));
  assert.strictEqual(st.turn, D.HUMAN);
  assert.strictEqual(st.history.length, 0);
  assert.strictEqual(st.free, 24);
  assert.strictEqual(st.score[1] + st.score[2], 0);
  assert.ok(before > 1);
  assert.strictEqual(D.undo(st), false);
});

test('undo of an extra-turn sequence removes all of it', () => {
  const st = D.newGame(3, 'normal', { prefill: [0, 3, 12] });
  D.play(st, 13);                                                     // 네모 하나 완성, 내 차례 계속
  D.play(st, 5);                                                      // 한 번 더 둔 수
  assert.ok(D.undo(st));
  assert.strictEqual(st.free, 21);
  assert.strictEqual(st.score[1], 0);
  assert.strictEqual(st.turn, D.HUMAN);
});

test('solver matches an independent brute force on a small endgame', () => {
  const st = D.newGame(3, 'hard'), r = D.rng(11);
  while (st.free > 11) D.play(st, D.freeEdges(st).filter((e) => D.isSafe(st, e))[0] ?? D.freeEdges(st)[0]);
  // 독립 구현: 판 복사본으로 단순 재귀 (기억 없이)
  const brute = (s) => {
    if (s.free === 0) return 0;
    let best = -Infinity;
    for (const e of D.freeEdges(s)) {
      const c = D.completes(s, e);
      const t = { ...s, edges: Uint8Array.from(s.edges), sides: Uint8Array.from(s.sides), owner: Int8Array.from(s.owner), score: s.score.slice(), history: [], events: [], free: s.free };
      t.edges[e] = 1; t.free--; for (const b of D.boxesOf(t, e)) t.sides[b]++;
      const v = c > 0 ? c + brute(t) : -brute(t);
      if (v > best) best = v;
    }
    return best;
  };
  const solver = D.makeSolver(st), top = Math.max(...solver.moves().map((m) => m.v));
  assert.strictEqual(top, brute(st));
});

test('hard computer picks a move that matches the exact value', () => {
  const st = D.newGame(3, 'hard'), r = D.rng(5);
  while (st.free > 12) D.play(st, D.freeEdges(st)[0]);
  const ms = D.makeSolver(st).moves(), best = Math.max(...ms.map((m) => m.v));
  const e = D.aiMove(st, r);
  assert.strictEqual(ms.find((m) => m.e === e).v, best);
});

test('computer levels get stronger from easy to hard', () => {
  const tally = (a, b) => { let w = 0, n = 0; for (let s = 1; s <= 30; s++) { if (match(3, a, b, s) === 1) w++; if (match(3, b, a, s + 100) === 2) w++; n += 2; } return w / n; };
  assert.ok(tally('normal', 'easy') > 0.7, 'normal vs easy');
  assert.ok(tally('hard', 'normal') > 0.7, 'hard vs normal');
  assert.ok(tally('hard', 'easy') > 0.9, 'hard vs easy');
});

test('hard computer stays fast on the biggest board', () => {
  const st = D.newGame(5, 'hard'), r = D.rng(9);
  let worst = 0;
  while (!st.over) { const t = Date.now(); const e = D.aiMove(st, r); worst = Math.max(worst, Date.now() - t); D.play(st, e); }
  assert.ok(worst < 1500, 'slowest move ' + worst + 'ms');
});

test('aiMove always returns a legal line', () => {
  for (const level of ['easy', 'normal', 'hard']) for (const n of [3, 4, 5]) {
    const st = D.newGame(n, level), r = D.rng(n * 7);
    while (!st.over) { const e = D.aiMove(st, r); assert.ok(!st.edges[e]); D.play(st, e); }
  }
});
