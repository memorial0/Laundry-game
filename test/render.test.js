/* 문항이 화면에 전부, 제 꼴로 그려지는가 — 배정 8집단 전부.
 *
 * 순서가 바뀌면 같은 문항이 다른 제품군 문구로 나와야 한다(survey.js 의 stemBy).
 * 그 갈림이 블록의 자극과 어긋나면 세탁 광고 뒤에 "이 게임을 다운로드할 의향" 이 나간다.
 */
'use strict';

const { bootRunner, startFlow, itemsOnScreen, scopeOf, itemsOf, suite } = require('./lib/harness');

const GROUPS = [0, 1, 2, 3, 4, 5, 6, 7];

module.exports = function () {
  const t = suite('문항 렌더 (배정 8집단)');

  let drawnTotal = 0;
  let stemChecks = 0;

  GROUPS.forEach((g) => {
    const w = bootRunner('group=' + g + '&sid=P00' + (g + 1) + '&lenient=1&practice=0');
    const S = w.SURVEY;
    const flow = startFlow(w);

    /* 설문 자체 검사부터 — 문항 은행이 스스로 어긋나 있으면 나머지는 볼 것도 없다 */
    const vErrs = S.validate();
    if (g === 0) t.ok(vErrs.length === 0, 'survey.js 자체 검사 통과', vErrs);

    let drawn = 0;
    const missing = [];
    const dupes = [];
    const stemMismatch = [];
    const shapeBad = [];

    for (let i = 0; i < flow.length; i++) {
      const st = flow[i];
      if (['pre', 'survey', 'demo'].indexOf(st.kind) < 0) continue;
      w.state.step = i;
      w.render();

      const expected = itemsOf(w, st);
      const els = itemsOnScreen(w);
      const ids = els.map((e) => e.getAttribute('data-item'));
      drawn += els.length;

      expected.forEach((it) => { if (ids.indexOf(it.id) < 0) missing.push(it.id); });
      if (ids.length !== new Set(ids).size) dupes.push(scopeOf(w, st));

      els.forEach((el) => {
        const id = el.getAttribute('data-item');
        const it = expected.filter((x) => x.id === id)[0];
        if (!it) { shapeBad.push(id + ' (은행에 없음)'); return; }

        /* 문두 — 제품군에 따라 갈리는 문항은 그 블록의 자극 기준으로 맞아야 한다 */
        const stemEl = el.querySelector('.stem');
        const shown = Array.prototype.slice.call(stemEl.querySelectorAll('span'), 1)
          .map((s) => s.textContent).join('').replace(/\s+/g, ' ').trim();
        const want = String(S.stemFor(it, st.b && st.b.stim)).replace(/\s+/g, ' ').trim();
        if (want) {
          stemChecks++;
          if (shown !== want) stemMismatch.push(id + ': "' + shown + '" ≠ "' + want + '"');
        }

        /* 꼴 — 종류마다 있어야 할 것이 있는가 */
        if (it.type === 'text') {
          if (!el.querySelector('textarea.freetext')) shapeBad.push(id + ' 입력칸 없음');
          /* 서술형에 라디오가 붙으면 그건 러너가 낡아 7점 척도로 그린 것이다 */
          if (el.querySelector('input[type=radio]')) shapeBad.push(id + ' 서술형에 라디오가 섞임');
        } else if (it.type === 'choice') {
          const n = el.querySelectorAll('.choice input[type=radio]').length;
          if (n !== it.options.length) shapeBad.push(id + ' 선택지 ' + it.options.length + '→' + n);
          const labels = Array.prototype.map.call(el.querySelectorAll('.choice .opt span'),
            (s) => s.textContent.trim());
          if (labels.join('|') !== it.options.join('|')) shapeBad.push(id + ' 선택지 글자 다름');
        } else {
          const n = el.querySelectorAll('.opts input[type=radio]').length;
          if (n !== it.scale) shapeBad.push(id + ' 눈금 ' + it.scale + '→' + n);
          if (it.type === 'sd') {
            const p = Array.prototype.map.call(el.querySelectorAll('.poles span'),
              (s) => s.textContent.trim());
            if (p.join('|') !== it.poles.join('|')) shapeBad.push(id + ' 양극 라벨 다름');
          }
        }
      });
    }

    drawnTotal += drawn;
    const errs = w.__errors.filter((e) => !/scroll/i.test(e));
    const label = '집단 ' + g + ' (' + w.state.seq.map((b) => b.stim + '/' + b.mode).join(' → ') + ')';

    t.ok(drawn === S.TOTAL_ITEMS && !missing.length && !dupes.length && !stemMismatch.length &&
         !shapeBad.length && !errs.length,
      label,
      missing.length || dupes.length || stemMismatch.length || shapeBad.length || errs.length
        ? { 누락: missing, 중복: dupes, 문두: stemMismatch, 꼴: shapeBad, 에러: errs }
        : drawn + '문항');
  });

  t.note('그린 문항 연인원', drawnTotal);
  t.note('문두 대조', stemChecks);
  return t.failed;
};

if (require.main === module) process.exit(module.exports() ? 1 : 0);
