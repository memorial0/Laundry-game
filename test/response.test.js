/* 누른 값이 그 문항의 칸으로 들어가는가 — 화면부터 CSV 한 줄까지.
 *
 * 문항마다 서로 다른 값을 눌러 둔다. 한 칸이라도 엇갈리면 값이 안 맞아 드러난다.
 * 같은 값을 전부 누르면 칸이 뒤바뀌어도 통과해 버린다.
 */
'use strict';

const {
  bootRunner, startFlow, agreeConsent, choose, type,
  scopeOf, itemsOf, clickNext, skipScreen, suite
} = require('./lib/harness');

const GROUPS = [0, 1, 2, 3, 4, 5, 6, 7];
/* 쉼표·따옴표·줄바꿈 — CSV 가 한 칸으로 감싸는지 보려고 일부러 다 넣는다 */
const FREETEXT = '쉼표, 따옴표" 그리고\n줄바꿈이 든 소감';

/** scope+id 에서 결정적으로 값을 고른다 */
function pick(scope, id, scale) {
  let h = 0;
  const s = scope + '|' + id;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return 1 + (h % scale);
}

module.exports = function () {
  const t = suite('응답 처리 (누른 값 → 칸 → CSV)');
  let compared = 0;

  GROUPS.forEach((g) => {
    const w = bootRunner('group=' + g + '&sid=P00' + (g + 1));
    const S = w.SURVEY;
    startFlow(w);
    agreeConsent(w);

    const pressed = {};          // scope → {id: 누른 값}
    const trouble = [];

    let guard = 0;
    while (guard++ < 400) {
      const st = w.state.flow[w.state.step];
      if (!st || st.kind === 'end') break;

      if (['pre', 'demo', 'survey', 'debrief'].indexOf(st.kind) >= 0) {
        const scope = scopeOf(w, st);
        pressed[scope] = pressed[scope] || {};
        itemsOf(w, st).forEach((it) => {
          if (it.type === 'text') {
            if (!type(w, scope, it.id, FREETEXT)) trouble.push(scope + '/' + it.id + ' 입력칸 없음');
            else pressed[scope][it.id] = FREETEXT;
            return;
          }
          var v;
          if (it.id === S.ATTENTION.id) v = S.ATTENTION.expect;            // 응답확인은 정답
          else if (st.kind === 'debrief') v = 1;                           // 자료 사용에 동의
          else v = pick(scope, it.id, it.type === 'choice' ? it.options.length : it.scale);
          if (!choose(w, scope, it.id, v)) trouble.push(scope + '/' + it.id + ' value=' + v + ' 없음');
          else pressed[scope][it.id] = v;
        });
      }

      if (!clickNext(w) && !skipScreen(w)) { trouble.push(st.kind + ' 에서 막힘'); break; }
    }

    const reached = (w.state.flow[w.state.step] || {}).kind;
    const row = w.flatRow()[0];

    /* 1. 광고별 29문항 × 4블록 — 누른 값이 그 칸에 있나 */
    w.state.seq.forEach((b) => {
      const k = w.blockKey(b);
      S.BLOCK_PAGES.forEach((pg) => {
        const scope = k + '_' + pg.key;
        pg.items.forEach((it) => {
          compared++;
          if (row[k + '_' + it.id] !== pressed[scope][it.id]) {
            trouble.push(k + '_' + it.id + ': 누른 ' + pressed[scope][it.id] + ' · 칸 ' + row[k + '_' + it.id]);
          }
        });
      });
    });

    /* 2. 응답확인은 29문항에 섞이지 않고 제 칸으로 */
    S.ATTENTION_BLOCKS.forEach((n) => {
      const k = w.blockKey(w.state.seq[n - 1]);
      compared += 3;
      if ((k + '_' + S.ATTENTION.id) in row) trouble.push('응답확인이 블록 칸에 섞임: ' + k);
      if (row['응답확인_광고' + n] !== S.ATTENTION.expect) trouble.push('응답확인_광고' + n + ' = ' + row['응답확인_광고' + n]);
      if (row['응답확인_광고' + n + '_통과'] !== 1) trouble.push('응답확인_광고' + n + '_통과 = ' + row['응답확인_광고' + n + '_통과']);
    });

    /* 3. 하위척도 평균을 손으로 다시 계산해 맞춘다 (survey.js 는 소수 셋째 자리에서 끊는다) */
    w.state.seq.forEach((b) => {
      const k = w.blockKey(b);
      S.SUBSCALES.forEach((sc) => {
        compared++;
        const vals = sc.items.map((id) => row[k + '_' + id]);
        const manual = vals.some((v) => v == null) ? null
          : Math.round((vals.reduce((a, c) => a + c, 0) / vals.length) * 1000) / 1000;
        if (row[k + '_' + sc.key + '_M'] !== manual) {
          trouble.push(k + '_' + sc.key + '_M = ' + row[k + '_' + sc.key + '_M'] + ' · 손계산 ' + manual);
        }
      });
    });

    /* 4. 사전·기본 정보·동의 */
    S.PRE.forEach((it) => { compared++; if (row[it.id] !== pressed.pre[it.id]) trouble.push('사전 ' + it.id); });
    S.DEMO.forEach((it) => { compared++; if (row[it.id] !== pressed.demo[it.id]) trouble.push('기본 ' + it.id); });
    S.CONSENT.checks.forEach((c) => { compared++; if (row[c.id] !== 1) trouble.push('동의 ' + c.id); });
    compared++;
    if (!row['동의_시각']) trouble.push('동의 시각이 비었다');

    /* 5. 칸 이름 충돌 — 블록 넷이 서로 덮어쓰면 여기서 걸린다 */
    const names = Object.keys(row);
    compared++;
    if (names.length !== new Set(names).size) trouble.push('칸 이름 중복');

    /* 6. CSV — 쉼표·따옴표·줄바꿈이 든 서술형이 한 칸 안에 */
    const csv = w.toCsv(w.flatRow());
    compared++;
    if (csv.indexOf('"쉼표, 따옴표"" 그리고') < 0) trouble.push('CSV 서술형 이스케이프가 깨졌다');

    t.ok(reached === 'end' && !trouble.length,
      '집단 ' + g + ' (' + w.state.seq.map((b) => b.stim + '/' + b.mode).join(' → ') + ')',
      trouble.length ? trouble.slice(0, 6) : names.length + '칸');
  });

  t.note('대조한 값', compared);
  return t.failed;
};

if (require.main === module) process.exit(module.exports() ? 1 : 0);
