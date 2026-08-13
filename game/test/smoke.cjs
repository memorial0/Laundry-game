#!/usr/bin/env node
/* 게임 자극 실행 점검:  npm test   (또는  node test/smoke.js [조건...] )
 *
 * 세 조건(watch / intervene / tutorial)을 jsdom 에서 실제로 끝까지 재생시키고,
 * 단계 전이·소요 시간·종료 로그·postMessage 를 확인한다.
 *
 * 한계: jsdom 의 requestAnimationFrame 은 브라우저와 프레임 간격이 다르다.
 * 여기서 재는 초는 "브라우저에서 정확히 몇 초"가 아니라 조건 간 비교와
 * 단계가 실제로 일어났는지를 보기 위한 값이다. 실제 노출 시간은 브라우저에서 재야 한다.
 */
'use strict';

const { build, bootPage, movePointer, attentive, wait, suite } = require('./lib/harness.cjs');

const POLL = 50;
const CAP = 180000;          // 안전 상한(ms)
const RESCUE_THINK = 700;    // 개입 구간 진입 후 첫 조작까지의 지연(ms) — 참가자 반응 흉내

const CONDITIONS = [
  { mode: 'watch' },
  { mode: 'intervene' },
  { mode: 'tutorial' }
];
const name = c => c.mode;

/* 개입·튜토리얼 구간의 조작은 '주의를 기울이는 참가자'(harness.attentive)로 흉내낸다.
 * 여기서 재는 개입형 길이는 **구출에 성공했을 때**의 길이다 — 실패하면 그만큼 짧게 끝난다. */
function steer(window) {
  if (!window.AD_STATE) return;
  const x = attentive(window.AD_STATE);
  movePointer(window, Math.max(10, Math.min(470, x)));
}

/** 한 조건을 끝까지 재생시키며 단계 전이를 기록한다 */
async function play(cond, bundle) {
  const sid = 'smoke-' + name(cond);
  const q = '?mode=' + cond.mode + '&ver=' + cond.ver + '&sid=' + sid + '&block=1';
  const w = bootPage(q, bundle);

  const t0 = Date.now();
  const marks = [];            // {phase, at}
  let rescueAt = 0;
  let end = 0;

  while (Date.now() - t0 < CAP) {
    const phase = w.AD_PHASE;
    const last = marks[marks.length - 1];
    if (phase && (!last || last.phase !== phase)) marks.push({ phase, at: Date.now() });

    // 참가자가 조작해야 하는 구간에서만 포인터를 움직인다
    if (phase === 'rewind_rescue' || phase === 'tutorial_play') {
      if (!rescueAt) rescueAt = Date.now();
      if (Date.now() - rescueAt > RESCUE_THINK) steer(w);
    }

    if (w.__messages.some(m => m && m.type === 'AD_DONE')) { end = Date.now(); break; }
    await wait(POLL);
  }
  if (!end) end = Date.now();

  const spans = marks.map((m, i) => ({
    phase: m.phase,
    sec: ((i + 1 < marks.length ? marks[i + 1].at : end) - m.at) / 1000
  }));
  const out = {
    cond, spans,
    total: (end - t0) / 1000,
    log: w.AD_RESULT && JSON.parse(JSON.stringify(w.AD_RESULT)),
    messages: w.__messages.map(m => m && m.type),
    errors: (w.__errors || []).map(e => (e && e.message) || String(e))
  };
  w.close();
  return out;
}

/** 조건별로 반드시 지나가야 하는 단계 (INTEGRATION.md 1장) */
const EXPECTED = {
  watch: ['autoplay_fail_watch', 'ended'],
  intervene: ['autoplay_fail_watch', 'rewind_watch', 'rewind_back', 'rewind_rescue', 'ended'],
  tutorial: ['tutorial_play', 'ended']
};

function report(t, r) {
  const { cond, spans, log } = r;
  t.section(name(cond) + '  (' + r.total.toFixed(1) + 's)');

  t.ok(!r.errors.length, 'JS 에러 없음', r.errors.length ? r.errors : undefined);

  const seen = spans.map(s => s.phase).filter(p => p !== 'none');
  t.ok(EXPECTED[cond.mode].every(p => seen.indexOf(p) >= 0),
    '조건이 지나야 할 단계를 전부 지났다', seen.join(' → '));

  if (cond.mode === 'watch') {
    t.ok(seen.indexOf('rewind_watch') < 0 && seen.indexOf('rewind_rescue') < 0,
      '시청형은 되감기·구출을 재생하지 않는다');
  }

  t.ok(r.messages.indexOf('AD_DONE') >= 0, 'AD_DONE postMessage 발화', r.messages);
  t.ok(log && log.t_end > 0 && log.DWELL_TOTAL > 0, '종료 로그가 마감됐다',
    log && { t_end: log.t_end, DWELL_TOTAL: log.DWELL_TOTAL });

  if (!log) return;

  // 개입 필드 — INTEGRATION.md 3장. 해당 없는 항목은 null 이고 0 이 아니다
  if (cond.mode === 'intervene') {
    t.ok(log.INT_DONE === 0 || log.INT_DONE === 1, 'INT_DONE 이 0/1 로 기록', log.INT_DONE);
    t.ok(typeof log.DWELL_INT === 'number' && log.DWELL_INT > 0,
      'DWELL_INT(개입 구간 체류) 기록', log.DWELL_INT);
    t.ok(typeof log.T_FIRST_DRAG === 'number',
      'T_FIRST_DRAG(첫 조작까지) 기록', log.T_FIRST_DRAG);
    t.ok(typeof log.COLLISION_T === 'number', 'COLLISION_T(실패 시점) 기록', log.COLLISION_T);
  } else if (cond.mode === 'watch') {
    t.ok(log.DWELL_INT === null && log.INT_DONE === null &&
      log.T_FIRST_DRAG === null && log.T_MANIP === null,
      '시청형은 개입 필드가 전부 null',
      { DWELL_INT: log.DWELL_INT, INT_DONE: log.INT_DONE, T_FIRST_DRAG: log.T_FIRST_DRAG, T_MANIP: log.T_MANIP });
    t.ok(log.RESULT === 'scripted_fail', '시청형 결과는 scripted_fail', log.RESULT);
  }

  t.ok(log.CTA_CLICK === null, '게임에는 CTA 가 없어 null', log.CTA_CLICK);
  t.info('RESULT', log.RESULT);
  t.info('GATES_PASSED / POWER_END', [log.GATES_PASSED, log.POWER_END]);
  if (log.VER_FALLBACK) t.info('⚠ ver=' + cond.ver + ' 타임라인이 없어 A 로 재생됨', log.VER_FALLBACK);
}

/** 조건 간 노출 시간 — 알려진 비대칭이 실제로 얼마나 되는지 눈으로 본다 */
function reportAsymmetry(t, results) {
  const by = {};
  results.forEach(r => { by[r.cond.mode] = r; });
  if (!by.watch || !by.intervene) return;
  t.section('조건 간 노출 시간 (알려진 비대칭)');
  t.info('watch', by.watch.total.toFixed(1) + 's');
  t.info('intervene', by.intervene.total.toFixed(1) + 's');
  t.info('차이', (by.intervene.total - by.watch.total).toFixed(1) + 's — 개입형만 되감기·구출을 본다');
}

module.exports = async function (argv) {
  const args = (argv || []).slice();
  const verArg = args.filter(a => /^(ver=)?[AB]$/.test(a)).pop();
  const ver = verArg ? verArg.replace('ver=', '') : 'A';
  CONDITIONS.forEach(c => { c.ver = ver; });
  const rest = args.filter(a => !/^(ver=)?[AB]$/.test(a));
  const only = rest.length ? rest : null;
  const list = only ? CONDITIONS.filter(c => only.some(a => name(c).indexOf(a) >= 0)) : CONDITIONS;
  if (!list.length) {
    console.error('그런 조건이 없습니다: ' + only.join(' ') +
      '  (있는 것: ' + CONDITIONS.map(name).join(', ') + ')');
    process.exit(2);
  }

  const t = suite('게임 자극 실행 점검 (ver ' + ver + ')');
  t.section('번들 빌드 중…');
  const bundle = build();

  const results = [];
  for (const c of list) results.push(await play(c, bundle));   // 순차 재생 — rAF 를 서로 뺏지 않게
  results.forEach(r => report(t, r));
  if (list.length > 1) reportAsymmetry(t, results);
  return t.failed;
};

if (require.main === module) {
  module.exports(process.argv.slice(2)).then(failed => {
    console.log(failed
      ? '\n\x1b[31m실패 ' + failed + '건\x1b[0m'
      : '\n\x1b[32m전부 통과\x1b[0m');
    process.exit(failed ? 1 : 0);
  });
}
