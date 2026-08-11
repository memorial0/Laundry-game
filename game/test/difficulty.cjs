#!/usr/bin/env node
/* 개입 구간 난이도 측정:  npm run difficulty   (또는  node test/difficulty.cjs [반복수] )
 *
 * 구출 성공이 "주의를 기울이면 되고, 아무렇게나 하면 안 되는" 수준인지 본다.
 * 세 가지 조작 정책으로 개입 조건을 반복 재생하고 성공률을 낸다.
 *
 *   attentive  게이트에서 파워가 큰 쪽을 고르고, 못 이기는 적은 옆으로 피한다
 *   sloppy     10번 중 6번만 맞게 고른다 (대충 보고 따라오는 참가자)
 *   careless   10번 중 3번만 맞게 고른다
 *   idle       아무 조작도 하지 않는다
 *
 * 기대: attentive 는 대부분 성공, idle 은 대부분 실패.
 *   - attentive 가 낮으면 참가자가 개입해도 실패해 유능감·통제감이 깎인다
 *   - idle 이 높으면 개입이 결과를 바꾼다는 조작 자체가 성립하지 않는다
 *
 * 한 번 재생에 55초씩 걸린다. 기본 3회 × 3정책을 동시에 돌린다.
 */
'use strict';

const { build, bootPage, movePointer, attentive, wait, suite, CANVAS_W } = require('./lib/harness.cjs');

const POLL = 40;             // 조작 판단 간격(ms)
const REACT_MS = 600;        // 개입 구간 진입 후 첫 조작까지 (참가자 반응 흉내)
const CAP = 120000;

/* 게이트마다 확률 p 로만 이득 상자를 고른다 — 100%(attentive)와 0%(idle) 사이가
 * 어디쯤인지 보려는 것이다. 선택 기록은 **판마다 독립**이어야 한다. 모듈 수준에 두면
 * 동시에 도는 판들이 같은 선택을 공유해 전부 같은 결과가 나온다. */
function makeChooser(p) {
  const choice = {};
  return function (st) {
    const ship = st.ship;
    const gates = st.gates.filter(g => !g.passed && g.y < ship.y).sort((a, b) => b.y - a.y);
    if (!gates.length) return ship.x + ship.w / 2;
    const g = gates[0];
    if (choice[g.t] === undefined) choice[g.t] = Math.random() < p;
    const good = g.p1 >= g.p2 ? { x: g.x1, w: g.w1 } : { x: g.x2, w: g.w2 };
    const bad = g.p1 >= g.p2 ? { x: g.x2, w: g.w2 } : { x: g.x1, w: g.w1 };
    const box = choice[g.t] ? good : bad;
    return box.x + box.w / 2;
  };
}

/** 정책은 판마다 새로 만든다 — 내부 상태를 판끼리 공유하면 결과가 서로 오염된다 */
const POLICIES = {
  attentive: () => attentive,      // 매번 이득 상자 + 적 회피
  sloppy: () => makeChooser(0.6),  // 10번 중 6번만 맞게 고른다
  careless: () => makeChooser(0.3),// 거의 아무렇게나 고른다
  idle: () => null                 // 조작 없음
};

/** 개입 조건 한 판 */
async function playOnce(policy, run, bundle) {
  const sid = 'diff-' + policy + '-' + run;
  const w = bootPage('?mode=intervene&ver=A&sid=' + sid + '&block=1', bundle);
  const t0 = Date.now();
  let rescueAt = 0;
  let tick = 0;

  const act = POLICIES[policy]();
  while (Date.now() - t0 < CAP) {
    const phase = w.AD_PHASE;
    if (phase === 'rewind_rescue' && act) {
      if (!rescueAt) rescueAt = Date.now();
      if (Date.now() - rescueAt > REACT_MS && w.AD_STATE) {
        const x = act(w.AD_STATE, tick++);
        movePointer(w, Math.max(10, Math.min(CANVAS_W - 10, x)));
      }
    }
    if (w.__messages.some(m => m && m.type === 'AD_DONE')) break;
    await wait(POLL);
  }

  const log = w.AD_RESULT && JSON.parse(JSON.stringify(w.AD_RESULT));
  const errors = (w.__errors || []).map(e => (e && e.message) || String(e));
  w.close();
  return { policy, run, log, errors };
}

function summarize(t, policy, results) {
  const done = results.filter(r => r.log);
  const wins = done.filter(r => r.log.RESULT === 'rescue_success').length;
  const rate = done.length ? Math.round((wins / done.length) * 100) : 0;
  const reasons = done.filter(r => r.log.RESULT !== 'rescue_success').map(r => r.log.FAIL_REASON);
  t.info(policy.padEnd(10) + wins + '/' + done.length + '  (' + rate + '%)',
    reasons.length ? reasons : undefined);
  return rate;
}

module.exports = async function (argv) {
  const runs = Math.max(1, parseInt((argv && argv[0]) || '3', 10));
  const t = suite('개입 구간 난이도 (성공률)');
  t.section('번들 빌드 중…');
  const bundle = build();
  t.section(runs + '회 × 4정책을 동시에 재생합니다 — 약 ' + Math.ceil(runs * 60 / 60) + '분 걸립니다');

  const jobs = [];
  Object.keys(POLICIES).forEach(p => {
    for (let i = 0; i < runs; i++) jobs.push(playOnce(p, i, bundle));
  });
  const all = await Promise.all(jobs);

  const errs = all.filter(r => r.errors.length);
  t.ok(!errs.length, 'JS 에러 없음', errs.length ? errs[0].errors : undefined);

  t.section('정책별 구출 성공률');
  const rate = {};
  Object.keys(POLICIES).forEach(p => {
    rate[p] = summarize(t, p, all.filter(r => r.policy === p));
  });

  t.section('판정');
  t.ok(rate.attentive >= 70, '주의를 기울이면 대체로 성공한다 (≥70%)', rate.attentive + '%');
  t.ok(rate.idle <= 30, '가만히 있으면 대체로 실패한다 (≤30%)', rate.idle + '%');
  t.ok(rate.attentive >= rate.sloppy && rate.sloppy >= rate.careless && rate.careless >= rate.idle,
    '잘 고를수록 성공률이 높다 (attentive ≥ sloppy ≥ careless ≥ idle)',
    { attentive: rate.attentive, sloppy: rate.sloppy, careless: rate.careless, idle: rate.idle });
  t.ok(rate.sloppy >= 30 && rate.sloppy <= 90,
    '중간쯤 하는 참가자가 성공/실패로 갈린다 (30~90%) — 100%면 너무 쉽고 0%면 칼같다',
    rate.sloppy + '%');
  return t.failed;
};

if (require.main === module) {
  module.exports(process.argv.slice(2)).then(failed => {
    console.log(failed
      ? '\n\x1b[31m조정 필요 ' + failed + '건\x1b[0m'
      : '\n\x1b[32m난이도 적정\x1b[0m');
    process.exit(failed ? 1 : 0);
  });
}
