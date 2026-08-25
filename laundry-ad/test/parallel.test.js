/* 평행 자극 요건 (SPEC 2장 · 7장 수용 기준)
 *  - watch/intervene: 재생 목록이 다르지만(1,2,3,4,10 vs 1~10),
 *    두 조건이 공유하는 장면은 그림·자막·길이가 완전히 같아야 한다
 *  - ver A/B: 소재만 다르고 구조·정보량은 같아야 한다
 *  - 과장 표현 금지 · 외부 요청 금지
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { APP_DIR, bootPage, bootArt, wait, suite } = require('./lib/harness');

const SCENES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const OTHER = SCENES.filter(n => n !== 6);
const countTags = s => (s.match(/</g) || []).length;

module.exports = async function () {
  const t = suite('평행 자극 · 표현 제한');

  t.section('장면 그림은 조건 인자를 받지 않는다');
  for (const ver of ['A', 'B']) {
    const w = bootPage('?mode=watch&ver=' + ver);
    const i = bootPage('?mode=intervene&ver=' + ver);
    await wait(120);
    const diff = OTHER.filter(n => w.AD_ART['s' + n]({}) !== i.AD_ART['s' + n]({}));
    t.ok(diff.length === 0, `ver ${ver}: 장면 ${OTHER.join(',')} 마크업이 mode와 무관`,
      diff.length ? diff : undefined);
    t.ok(w.AD_ART.s6({}) === i.AD_ART.s6({}), `ver ${ver}: 장면 6 그림도 mode와 무관`);
  }

  t.section('공통 장면은 두 조건이 완전히 같다');
  {
    const w = bootPage('?mode=watch&ver=A');
    const i = bootPage('?mode=intervene&ver=A');
    await wait(120);
    const noOf = win => win.AD_ENGINE.list.map(s => s.no);
    t.ok(noOf(w).join(',') === '1,2,3,4,10', 'watch = 실패까지 + 제품 메시지', noOf(w).join(','));
    t.ok(noOf(i).join(',') === '1,2,3,4,5,6,7,8,9,10', 'intervene = 전 장면', noOf(i).join(','));

    // 두 조건이 공유하는 장면은 그림·자막·길이가 한 글자도 다르면 안 된다
    const COMMON = noOf(w).filter(n => noOf(i).indexOf(n) >= 0);
    t.ok(COMMON.join(',') === '1,2,3,4,10', '공통 장면 = 1,2,3,4,10', COMMON.join(','));
    const at = (win, no) => {
      win.AD_ENGINE.pause();
      t.ok(win.AD_ENGINE.gotoNo(no), `장면 ${no} 이동`);
      return win.AD_ENGINE.scene;
    };
    const subDiff = [], durDiff = [];
    for (const n of COMMON) {
      const a = at(w, n), b = at(i, n);
      if (a.subtitle() !== b.subtitle()) subDiff.push(n);
      if (a.dur !== b.dur) durDiff.push(n);
    }
    t.ok(subDiff.length === 0, '공통 장면 자막 완전 일치', subDiff.length ? subDiff : undefined);
    t.ok(durDiff.length === 0, '공통 장면 길이 완전 일치', durDiff.length ? durDiff : undefined);
    // 그림도 같은 렌더 함수에서 나온다(조건 인자를 받지 않는다)
    const artDiff = COMMON.filter(n => w.AD_ART['s' + n]({}) !== i.AD_ART['s' + n]({}));
    t.ok(artDiff.length === 0, '공통 장면 그림 완전 일치', artDiff.length ? artDiff : undefined);
  }

  t.section('조작 안내 UI는 intervene 전용');
  {
    const css = fs.readFileSync(path.join(APP_DIR, 'style.css'), 'utf8');
    const i = bootPage('?mode=intervene');
    await wait(120);
    i.AD_ENGINE.pause();
    i.AD_ENGINE.gotoNo(6);
    await wait(40);
    const UI = ['.s6-ring', '.s6-guide', '.s6-hand'];
    t.ok(UI.every(sel => !!i.document.querySelector('.sc6 ' + sel)),
      'intervene 장면 6에 드롭존·경로·힌트가 있다');
    t.ok(/\.s6-ring\s*\{[^}]*animation/.test(css) && /\.sc6\.hint-on\s+\.s6-hand/.test(css),
      '링 펄스·힌트 규칙 유지');
    // watch가 이 장면을 다시 쓰게 되더라도(?still=6, 조건 되돌리기) UI는 꺼진 채여야 한다
    const hidden = (css.match(/\.sc6\.is-watch[^{]*\{[^}]*display:\s*none[^}]*\}/g) || []).join(' ');
    const leak = UI.filter(sel => !new RegExp('\\.sc6\\.is-watch\\s+\\' + sel + '\\b').test(hidden));
    t.ok(leak.length === 0, 'is-watch에서는 조작 안내 UI 비표시', leak.length ? leak : undefined);

    /* 규칙이 있는 것과 규칙이 걸리는 것은 다르다. 위 검사는 CSS 만 봐서, 정작
     * is-watch 를 붙이는 곳이 없던 동안에도 통과했다 — ?still=6 스토리보드에는
     * intervene 전용 UI 가 그대로 찍히고 있었다. 이제 클래스가 실제로 붙는지 본다. */
    const sw = bootPage('?mode=watch&still=6');
    await wait(120);
    const swEl = sw.document.querySelector('.sc6');
    t.ok(!!swEl && swEl.classList.contains('is-watch'),
      '?still=6 · watch 에 is-watch 가 붙는다', swEl && swEl.className);

    const si = bootPage('?mode=intervene&still=6');
    await wait(120);
    const siEl = si.document.querySelector('.sc6');
    t.ok(!!siEl && !siEl.classList.contains('is-watch'),
      '?still=6 · intervene 에는 안 붙는다', siEl && siEl.className);
  }

  t.section('동작 줄이기');
  {
    const w = bootPage('?mode=watch');
    await wait(120);
    const cssSrc = fs.readFileSync(path.join(APP_DIR, 'style.css'), 'utf8');
    t.ok(!/@media[^{]*prefers-reduced-motion/.test(cssSrc),
      '동작 줄이기 설정이 애니메이션을 바꾸지 않는다(오버라이드 없음)');
    t.ok('REDUCED_MOTION' in w.AD_RESULT, '설정값은 로그에만 남는다');
  }

  t.section('ver A = ver B (구조 · 정보량)');
  const a = bootArt('A');
  const b = bootArt('B');
  for (const n of SCENES) {
    const ca = countTags(a['s' + n]({}));
    const cb = countTags(b['s' + n]({}));
    const rel = Math.abs(ca - cb) / Math.max(ca, cb);
    t.ok(rel < 0.2, `장면 ${n} 요소 수 유사`, `${ca} vs ${cb}`);
  }

  t.section('장면 4·8·9는 같은 함수 · stained만 다름');
  const clean = a.holdFigure({ mood: 'worried' });
  const stained = a.holdFigure({ mood: 'worried', stained: true });
  t.ok(clean !== stained, 'stained 값이 그림을 바꾼다');
  // 얼룩은 의류 그룹 마지막에만 덧붙는다 = 그 외 마크업은 한 글자도 다르지 않다
  const cut = clean.lastIndexOf('</g>');
  t.ok(stained.startsWith(clean.slice(0, cut)) && stained.endsWith(clean.slice(cut)),
    '얼룩 레이어 외에는 완전히 동일(인물·의류·구도)');

  t.section('표현 제한 · 오프라인');
  const js = fs.readFileSync(path.join(APP_DIR, 'scenes.js'), 'utf8');
  const html = fs.readFileSync(path.join(APP_DIR, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(APP_DIR, 'style.css'), 'utf8');
  const banned = ['완전 방지', '100%', '완벽', '모든 염료', '전혀'];
  const hit = banned.filter(k => js.includes(k));
  t.ok(hit.length === 0, '과장 문구 없음("이염을 줄여"까지만)', hit.length ? hit : undefined);
  t.ok(js.includes('세탁 조건에 따라 효과는 달라질 수 있습니다'), '팩샷 면책 문구');
  t.ok(js.includes('기능 설명 화면'), '장면 7 설명용 시각화 라벨');

  /* 효과음도 합성이고 나래이션은 base64 로 심겨 있어 오디오 파일이 없다 —
   * 여기 포함해 오프라인 조건을 같이 지킨다. voice-clips.js 는 생성물이지만
   * 배포되는 파일이므로 같은 검사를 받는다. */
  const sfx = fs.readFileSync(path.join(APP_DIR, 'sfx.js'), 'utf8');
  const voice = fs.readFileSync(path.join(APP_DIR, 'voice.js'), 'utf8');
  const clips = fs.readFileSync(path.join(APP_DIR, 'voice-clips.js'), 'utf8');
  const external = /https?:\/\/(?!www\.w3\.org)/;
  t.ok(!external.test(js) && !external.test(html) && !external.test(css) &&
    !external.test(sfx) && !external.test(voice) && !external.test(clips),
    '외부 요청 없음(오프라인 실행)');
  t.ok(!/<script[^>]+src="(?!(sfx|voice-clips|voice|scenes)\.js")/.test(html),
    '자체 스크립트 넷 외에는 없음');
  t.ok(!/@import|url\(['"]?https?:/.test(css), '외부 폰트·리소스 없음');

  return t.failed;
};
