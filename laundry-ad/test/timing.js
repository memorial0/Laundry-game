#!/usr/bin/env node
/* 실시간 재생 검증:  npm run timing   (또는  node test/timing.js [조건...] )
 *
 * 다른 테스트는 Engine.gotoNo()로 장면을 점프해 구조를 검사한다. 이 스크립트는
 * 점프하지 않고 타이머가 실제로 흐르게 두어 SPEC 3장의 장면 길이를 실측한다.
 *   watch      18.6초 고정      (장면 1·2·3·4·10)
 *   intervene  32.3초 고정(되감기 6초 포함) + 되돌리기 대기 + 장면 6 조작 시간
 *
 *   장면 길이는 나래이션 클립 + 0.3초다(scenes.js 의 DUR 표). 말이 끝나면 컷이다.
 * 느리므로(4조건 약 60초) npm test에는 넣지 않는다. 조건 4개는 동시에 재생한다.
 *
 * 예:  node test/timing.js              4조건 전부
 *      node test/timing.js intervene-A  하나만
 */
'use strict';

const { bootPage, wait, dragSheet, suite } = require('./lib/harness');

// SPEC 3장 장면표. null = 가변(장면 6은 드롭할 때까지 기다린다)
/* null = 길이가 정해져 있지 않은 장면(참가자에게 달렸다).
 *   5 — [되돌리기]를 누를 때까지 대기 + 누른 뒤 되감기 6초
 *   6 — 시트를 넣을 때까지 대기 */
const DUR = { 1: 2.94, 2: 1.58, 3: 4.0, 4: 2.08, 5: null, 6: null, 7: 2.44, 8: 1.29, 9: 4.0, 10: 8.0 };
const PLAYLIST = { watch: [1, 2, 3, 4, 10], intervene: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] };

const HOME = { x: 270, y: 1530 };   // 시트 처음 위치 (ART.S6.HOME)
const DROP = { x: 790, y: 1180 };   // 투입구       (ART.S6.DROP)

const POLL = 50;          // 장면 전환 감지 간격(ms) — 측정 오차의 하한이다
const TOL = 0.4;          // 허용 오차(초). 타이머 지터 + POLL을 넉넉히 덮는다
                          // (장면이 1.2초까지 짧아져 0.6초는 장면 길이의 절반이었다)
const S6_THINK = 2000;    // 장면 6 진입 후 드롭까지 기다리는 시간(ms) — 참가자 조작 흉내
const S5_THINK = 1200;    // 장면 5 진입 후 [되돌리기]를 누르기까지(ms) — 참가자 반응 흉내
const REWIND_MS = 6000;   // 누른 뒤 되감기 애니메이션 길이(ms). scenes.js 와 같은 값이어야 한다
const CAP = 120000;       // 안전 상한(ms)

const CONDITIONS = [
  { mode: 'watch', ver: 'A' }, { mode: 'watch', ver: 'B' },
  { mode: 'intervene', ver: 'A' }, { mode: 'intervene', ver: 'B' }
];
const name = c => c.mode + '-' + c.ver;

/** 한 조건을 끝까지 재생시키며 장면별 실제 길이를 잰다. */
async function play(cond) {
  const sid = 'timing-' + name(cond);
  const w = bootPage('?mode=' + cond.mode + '&ver=' + cond.ver + '&sid=' + sid);
  const t0 = Date.now();
  const marks = [];            // {no, at} — 장면이 바뀐 시각
  let dropped = false;
  let rewound = false;
  let end = 0;                 // 종료를 감지한 시각. 아래 대기 시간이 섞이면 안 된다

  while (Date.now() - t0 < CAP) {
    const E = w.AD_ENGINE;
    const no = E.scene && E.scene.no;
    const last = marks[marks.length - 1];
    // 장면 번호가 정해진 뒤부터 기록한다(부팅 직후 한 틱은 아직 null이다)
    if (no != null && (!last || last.no !== no)) marks.push({ no: no, at: Date.now() });
    if (E.finished) { end = Date.now(); await wait(400); break; }   // postMessage가 나갈 틈을 준다

    /* 장면 5는 [되돌리기]를 눌러야 되감기가 시작된다. 안 누르면 여기서 영원히 기다리는데,
     * 그건 실제 참가자가 가만히 있을 때와 똑같은 상태다. */
    if (no === 5 && !rewound && Date.now() - marks[marks.length - 1].at > S5_THINK) {
      var btn = w.document.querySelector('.rewind-btn');
      if (btn) { btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); rewound = true; }
    }

    // 장면 6은 드롭해야 넘어간다. 진입 후 S6_THINK 만큼 있다가 한 번만 투입한다.
    if (no === 6 && !dropped && Date.now() - marks[marks.length - 1].at > S6_THINK) {
      dragSheet(w, HOME, DROP);
      dropped = true;
    }
    await wait(POLL);
  }

  if (!end) end = Date.now();   // CAP에 걸려 빠져나온 경우
  const spans = marks.map((m, i) => ({
    no: m.no,
    sec: ((i + 1 < marks.length ? marks[i + 1].at : end) - m.at) / 1000
  }));
  const out = { cond, spans, log: w.AD_RESULT, finished: w.AD_ENGINE.finished,
    messages: w.__messages.map(m => m && m.type), errors: w.__errors };
  w.close();
  return out;
}

function report(t, r) {
  const { cond, spans, log } = r;
  const isInt = cond.mode === 'intervene';
  t.section(name(cond));

  t.ok(!r.errors.length, 'JS 에러 없음',
    r.errors.length ? r.errors.map(e => e.message) : undefined);
  t.ok(spans.map(s => s.no).join(',') === PLAYLIST[cond.mode].join(','),
    '재생 목록이 조건과 일치', spans.map(s => s.no).join(','));

  // 장면별 길이 — 마지막 장면(10)은 자동 종료까지가 곧 그 장면의 길이다
  let fixed = 0;
  for (const s of spans) {
    const spec = DUR[s.no];
    if (spec === null) {                       // 장면 5·6: 참가자에게 달려 있어 값을 못 박는다
      var floor = s.no === 5 ? (S5_THINK + REWIND_MS) / 1000 : S6_THINK / 1000;
      t.ok(s.sec >= floor, '장면 ' + s.no + ' 가변(참가자 조작)', s.sec + 's');
      continue;
    }
    fixed += spec;
    t.ok(Math.abs(s.sec - spec) <= TOL,
      '장면 ' + s.no + ' 길이 ' + spec + 's', s.sec.toFixed(2) + 's');
  }
  /* intervene 의 고정분은 장면 5·6 을 뺀 값이다(둘 다 참가자에게 달려 있다).
   * 예전 55초에는 장면 5 의 6초가 포함돼 있었다 — 되감기를 광고가 알아서 했기 때문이다.
   * 합계는 DUR 표에서 그대로 나오는 값이라 손으로 적지 않는다 — 장면 하나를 고칠
   * 때마다 여기 숫자까지 같이 고쳐야 했고, 그러면 표와 어긋난 채 통과할 길이 생긴다. */
  const EXPECT = Object.entries(DUR)
    .filter(([no, d]) => d !== null && (isInt || PLAYLIST.watch.includes(Number(no))))
    .reduce((a, [, d]) => a + d, 0);
  t.ok(Math.abs(fixed - EXPECT) < 0.005, '고정분 합계 ' + EXPECT.toFixed(2) + 's', fixed.toFixed(2) + 's');

  // 로그가 실측과 맞는지
  const total = spans.reduce((a, s) => a + s.sec, 0);
  t.ok(Math.abs(log.DWELL_TOTAL - total) <= TOL,
    'DWELL_TOTAL이 실측과 일치', log.DWELL_TOTAL + 's vs ' + total.toFixed(2) + 's');

  if (isInt) {
    const s6 = spans.filter(s => s.no === 6)[0];
    t.ok(log.INT_DONE === 1, '개입 성공 기록(INT_DONE=1)');
    t.ok(Math.abs(log.DWELL_INT - s6.sec) <= TOL,
      'DWELL_INT가 장면 6 실측과 일치', log.DWELL_INT + 's vs ' + s6.sec.toFixed(2) + 's');
  } else {
    // SPEC 5장: watch에는 장면 6이 없으므로 개입 필드는 공란(null)이다
    t.ok(log.DWELL_INT === null && log.INT_DONE === null && log.T_MANIP === null,
      '개입 필드가 전부 null', { DWELL_INT: log.DWELL_INT, INT_DONE: log.INT_DONE, T_MANIP: log.T_MANIP });
  }

  t.ok(r.finished, 'CTA 미클릭 시 자동 종료');
  t.ok(r.messages.indexOf('AD_DONE') >= 0, 'AD_DONE postMessage 발화', r.messages);
}

/** A/B는 소재만 다르다 — 같은 mode끼리 총 길이가 같아야 한다(SPEC 도구 8) */
function reportParallel(t, results) {
  t.section('ver A = ver B (재생 시간)');
  for (const mode of ['watch', 'intervene']) {
    const pair = results.filter(r => r.cond.mode === mode);
    if (pair.length !== 2) continue;
    const [a, b] = pair.map(r => r.spans.reduce((s, x) => s + x.sec, 0));
    t.ok(Math.abs(a - b) <= TOL,
      mode + ' 총 길이 A≈B', a.toFixed(2) + 's vs ' + b.toFixed(2) + 's');
  }
}

module.exports = async function (argv) {
  const only = (argv && argv.length) ? argv : null;
  const list = only
    ? CONDITIONS.filter(c => only.some(a => name(c).indexOf(a) >= 0))
    : CONDITIONS;
  if (!list.length) {
    console.error('그런 조건이 없습니다: ' + only.join(' ') +
      '  (있는 것: ' + CONDITIONS.map(name).join(', ') + ')');
    process.exit(2);
  }

  const t = suite('실시간 재생 시간 (SPEC 3장)');
  console.log('  \x1b[2m' + list.length + '개 조건을 동시에 재생합니다 — 약 ' +
    (list.some(c => c.mode === 'intervene') ? 60 : 32) + '초 걸립니다\x1b[0m');

  const results = await Promise.all(list.map(play));
  results.forEach(r => report(t, r));
  if (list.length > 1) reportParallel(t, results);
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
