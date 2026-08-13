#!/usr/bin/env node
/* 평행 자극 검사:  npm run parallel   (또는  node test/parallel.cjs )
 *
 * ver A 와 ver B 가 "소재만 다른 같은 자극"인지 타임라인 자체를 뜯어 확인한다.
 * 재생해서 재는 것(npm test · npm run difficulty)과 달리 여기서는 데이터를 직접 비교하므로
 * 빠르고, 값을 잘못 고쳤을 때 곧바로 잡힌다.
 *
 * 같아야 하는 것 — 사건 수·종류·시각, 게이트의 이득/손해 값 쌍, 적 HP·크기,
 *                   자동 조종이 이득/손해 중 무엇을 고르는지(= 실패 각본)
 * 달라야 하는 것 — 이득 상자가 좌우 어느 쪽에 오는지, 좁은 적의 위치
 *
 * 둘 다 지켜져야 "구조·난이도는 같고 배치만 다른" 평행 자극이다.
 * 하나라도 어긋나면 두 번째 노출이 다른 자극이 되거나(비교 불가), 같은 자극이 된다(기억으로 되풀이).
 */
'use strict';

const { build, bootPage, suite } = require('./lib/harness.cjs');

/** 게이트에서 이득 상자가 좌(1)인지 우(2)인지 */
const goodSide = g => (g.p1 >= g.p2 ? 1 : 2);
/** 이득·손해 값 쌍 (좌우와 무관하게) */
const values = g => [Math.max(g.p1, g.p2), Math.min(g.p1, g.p2)];
/** 자동 조종이 겨냥하는 상자가 이득 쪽인가 */
function autoPicksGood(g) {
  if (g.autoTarget == null) return null;      // 실패 지점 이후 구간에는 자동 조종이 없다
  const inFirst = g.autoTarget > g.x1 && g.autoTarget < g.x1 + g.w1;
  return inFirst ? goodSide(g) === 1 : goodSide(g) === 2;
}

module.exports = async function () {
  const t = suite('평행 자극 검사 (ver A ↔ ver B)');
  t.section('번들 빌드 중…');
  const bundle = build();
  const w = bootPage('?mode=watch&ver=A&sid=parallel', bundle);
  const T = w.AD_TIMELINES;

  if (!T || !T.A || !T.B) {
    t.ok(false, '두 버전의 타임라인이 모두 있다', T ? Object.keys(T) : null);
    w.close();
    return t.failed;
  }
  const A = T.A, B = T.B;

  t.section('같아야 하는 것');
  t.ok(A.length === B.length, '사건 수가 같다', { A: A.length, B: B.length });

  const n = Math.min(A.length, B.length);
  const typeSeq = a => a.map(e => e.type).join(',');
  t.ok(typeSeq(A) === typeSeq(B), '사건 종류의 순서가 같다');

  const timeMismatch = [];
  for (let i = 0; i < n; i++) if (A[i].t !== B[i].t) timeMismatch.push({ i, A: A[i].t, B: B[i].t });
  t.ok(!timeMismatch.length, '모든 사건의 시각이 같다 (= 재생 길이가 같다)',
    timeMismatch.length ? timeMismatch : undefined);

  const valMismatch = [];
  const hpMismatch = [];
  const autoMismatch = [];
  for (let i = 0; i < n; i++) {
    if (A[i].type !== B[i].type) continue;
    if (A[i].type === 'gate') {
      const [ag, ab] = values(A[i]), [bg, bb] = values(B[i]);
      if (ag !== bg || ab !== bb) valMismatch.push({ i, A: [ag, ab], B: [bg, bb] });
      if (autoPicksGood(A[i]) !== autoPicksGood(B[i])) {
        autoMismatch.push({ i, t: A[i].t / 60, A: autoPicksGood(A[i]), B: autoPicksGood(B[i]) });
      }
    } else {
      if (A[i].hp !== B[i].hp || A[i].w !== B[i].w || A[i].h !== B[i].h) {
        hpMismatch.push({ i, A: [A[i].hp, A[i].w, A[i].h], B: [B[i].hp, B[i].w, B[i].h] });
      }
    }
  }
  t.ok(!valMismatch.length, '게이트의 이득/손해 값 쌍이 같다', valMismatch.length ? valMismatch : undefined);
  t.ok(!hpMismatch.length, '적의 HP·크기가 같다', hpMismatch.length ? hpMismatch : undefined);
  t.ok(!autoMismatch.length, '자동 조종이 이득/손해를 고르는 지점이 같다 (= 실패 각본이 같다)',
    autoMismatch.length ? autoMismatch : undefined);

  t.section('달라야 하는 것');
  const gatesA = A.filter(e => e.type === 'gate');
  const gatesB = B.filter(e => e.type === 'gate');
  const sideA = gatesA.map(goodSide).join('');
  const sideB = gatesB.map(goodSide).join('');
  let sideDiff = 0;
  for (let i = 0; i < Math.min(sideA.length, sideB.length); i++) if (sideA[i] !== sideB[i]) sideDiff++;
  t.ok(sideDiff >= gatesA.length * 0.6,
    '이득 상자의 좌우 패턴이 대부분 다르다 (60% 이상)',
    { 다른자리: sideDiff + '/' + gatesA.length, A: sideA, B: sideB });
  /* 전부 다르면 그건 정확한 거울상이다 — "아까 그거 뒤집은 것"으로 읽혀 새 자극이 되지 못한다 */
  t.ok(sideDiff < gatesA.length,
    '완전한 좌우 반전(거울상)이 아니다 — 같은 쪽에 오는 게이트도 있다',
    { 같은자리: (gatesA.length - sideDiff) + '/' + gatesA.length });

  const narrowA = A.filter(e => e.type === 'enemy' && e.w < 400);
  const narrowB = B.filter(e => e.type === 'enemy' && e.w < 400);
  const movedFoes = narrowA.filter((e, i) => narrowB[i] && narrowB[i].x !== e.x).length;
  t.ok(narrowA.length && movedFoes === narrowA.length,
    '좁은 적의 좌우 위치가 전부 다르다',
    { 옮긴수: movedFoes + '/' + narrowA.length });

  w.close();
  return t.failed;
};

if (require.main === module) {
  module.exports().then(failed => {
    console.log(failed
      ? '\n\x1b[31m평행하지 않음 ' + failed + '건\x1b[0m'
      : '\n\x1b[32m평행 자극 조건 충족\x1b[0m');
    process.exit(failed ? 1 : 0);
  });
}
