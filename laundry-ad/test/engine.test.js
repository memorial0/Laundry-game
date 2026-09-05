/* 장면 엔진 — 1→10 자동 진행, 자막, 장면별 렌더, ?still */
'use strict';
const fs = require('fs');
const path = require('path');
const { bootPage, wait, suite, APP_DIR } = require('./lib/harness');

const EXPECTED = {
  A: {
    1: '내일 입을 셔츠, 오늘 같이 빨래하기',
    4: '셔츠 색이 변해 버렸다',
    6: { watch: '시트를 세탁기 안으로 끌어다 놓기만 하면', intervene: '시트를 세탁기 안으로 끌어다 놓아 주세요' }
  },
  B: {
    1: '내일 쓸 수건, 오늘 같이 빨래하기',
    4: '수건 색이 변해 버렸다',
    6: { watch: '시트를 세탁기 안으로 끌어다 놓기만 하면', intervene: '시트를 세탁기 안으로 끌어다 놓아 주세요' }
  }
};

module.exports = async function () {
  const t = suite('엔진 · 장면 진행');

  for (const ver of ['A', 'B']) {
    const w = bootPage('?mode=watch&ver=' + ver + '&sid=eng-' + ver);
    await wait(150);
    const E = w.AD_ENGINE;
    const subtitle = () => w.document.getElementById('subtitle-text').textContent;
    const scene = () => w.document.querySelector('#scene-layer .scene.is-in');

    t.section('ver ' + ver);
    t.ok(E.scene.no === 1, '장면 1에서 시작');
    t.ok(subtitle() === EXPECTED[ver][1], '장면 1 자막', subtitle());

    const seen = [];
    for (let i = 0; i < E.list.length - 1; i++) {
      seen.push(E.scene.no);
      const el = scene();
      if (!el || el.querySelectorAll('svg *').length < 10) {
        t.ok(false, `장면 ${E.scene.no} SVG 렌더`, el && el.className);
      }
      if (E.scene.no === 4) t.ok(subtitle() === EXPECTED[ver][4], '장면 4 자막', subtitle());
      E.next();
      await wait(20);
    }
    seen.push(E.scene.no);
    t.ok(seen.join(',') === '1,2,3,4,11,10', 'watch = 실패까지 + 제품 메시지', seen.join(','));
    t.ok(w.__errors.length === 0, '스크립트 오류 없음', w.__errors.map(String));

    // 장면 하나만 남고 이전 장면은 정리된다
    await wait(600);
    t.ok(w.document.querySelectorAll('#scene-layer .scene').length === 1, '이전 장면 DOM 제거');

    E.next();
    await wait(30);
    t.ok(E.finished, '장면 10 다음은 종료');
  }

  t.section('길이 · 총 재생시간');
  /* 공란(빈 칸)은 길이가 정해져 있지 않은 장면이다.
   *   장면 5 — 참가자가 [되돌리기]를 눌러야 되감기가 시작된다(누른 뒤 6초)
   *   장면 6 — 시트를 넣어야 넘어간다
   * 그래서 intervene 의 "고정 길이"는 이 둘을 뺀 값이고, 실제 재생 길이는
   * 고정 길이 + 되돌리기 대기 + 되감기 6초 + 조작 시간이다(INTEGRATION.md §11). */
  for (const [mode, table, lo, hi] of [
    ['watch', '3.6,2.4,4.4,3.4,3.6,8', 24, 27],
    ['intervene', '3.6,2.4,4.4,3.4,3.6,,,3,2.4,2.75,8', 32, 35]
  ]) {
    const w = bootPage('?mode=' + mode);
    await wait(120);
    const E = w.AD_ENGINE;
    const durs = [];
    for (let i = 0; i < E.list.length; i++) { durs.push(E.scene.dur); E.next(); await wait(5); }
    t.ok(durs.join(',') === table, mode + ' 장면 길이표', durs.join(','));
    const total = durs.reduce((a, b) => a + (b || 0), 0);
    t.ok(total >= lo && total <= hi, `${mode} 고정 길이 ${lo}~${hi}초`, total);
  }

  /* SPEC 3장의 장면표와 대조한다.
   *
   * 그 표는 손으로 적은 길이 열을 갖고 있고 **아무것도 안 보고 있었다.** 두 자극의
   * 노출 시간을 맞추며 DUR 을 줄였을 때(28.0 → 25.4초) 표만 옛 값으로 남아, 같은
   * 파일 안에서 바로 위 산문("watch 25.4초 고정")과 표(합 28.0초)가 서로 다른 말을
   * 하고 있었다. SPEC 은 구현 지시의 기준 문서이고 IRB 별첨 스토리보드와 짝이라,
   * 어느 쪽을 믿어야 하는지가 갈리면 안 된다.
   *
   * 값은 실행 중인 엔진에서 읽는다 — 여기에 옮겨 적으면 표가 둘이 되고 같은 일이
   * 한 번 더 일어난다(voice.test.js 의 DUR 주석과 같은 이유다). */
  {
    const spec = fs.readFileSync(path.join(APP_DIR, '..', 'SPEC.md'), 'utf8');
    const w = bootPage('?mode=intervene');
    await wait(120);
    const DUR = {};
    for (const sc of w.AD_ENGINE.list) if (sc.dur) DUR[sc.no] = sc.dur;

    const rows = [];
    for (const line of spec.split('\n')) {
      const m = /^\| (\d+) \| /.exec(line);
      if (!m) continue;
      const cells = line.split('|');
      const cell = cells[cells.length - 3].trim();      // 길이 열
      const n = /^(\d+(?:\.\d+)?)s/.exec(cell);
      if (n) rows.push([Number(m[1]), Number(n[1])]);   // 5·6 은 "가변…" 이라 안 걸린다
    }
    t.ok(rows.length === Object.keys(DUR).length,
      `SPEC 장면표에서 길이 ${Object.keys(DUR).length}개를 읽었다`, rows.length);

    const off = rows.filter(([no, sec]) => DUR[no] === undefined ||
      Math.abs(DUR[no] - sec) > 0.005)
      .map(([no, sec]) => `장면 ${no}: SPEC ${sec}s ≠ 코드 ${DUR[no]}s`);
    t.ok(off.length === 0, 'SPEC 3장 장면표의 길이가 코드와 같다', off.length ? off : undefined);
  }

  t.section('일시정지 · ?still');
  const p = bootPage('?mode=watch');
  await wait(120);
  p.AD_ENGINE.pause();
  const at = p.AD_ENGINE.scene.no;
  await wait(120);
  t.ok(p.AD_ENGINE.scene.no === at && !p.AD_ENGINE.playing, '정지 중에는 진행하지 않음');
  p.AD_ENGINE.resume();
  t.ok(p.AD_ENGINE.playing, '재개');

  const s = bootPage('?still=7');
  await wait(150);
  t.ok(s.AD_ENGINE.scene.no === 7, '?still=7 → 장면 7 렌더', s.AD_ENGINE.scene.no);
  t.ok(!s.AD_ENGINE.playing, '?still은 자동 진행하지 않음');
  await wait(200);
  t.ok(s.AD_ENGINE.scene.no === 7, '정지 유지');

  return t.failed;
};
