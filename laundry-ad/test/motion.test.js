/* 연출(모션)의 평행 자극 요건 — style.css 정적 검사
 *
 * 왜 여기서 CSS를 뜯어보나
 *   parallel.test.js 는 마크업 문자열·자막·길이를 비교한다. 그런데 카메라 이동,
 *   컷 전환, 속도 램프, 인물 동작은 전부 style.css 에 있다. 마크업은 한 글자도
 *   안 달라도 CSS 한 줄로 조건마다 다른 화면을 만들 수 있고, 기존 검사는 그걸
 *   통과시킨다. 연출을 올린 만큼 연출에 대한 검사도 있어야 한다.
 *
 *   jsdom 은 <link> 로 걸린 스타일시트를 가져오지 않으므로 계산된 스타일로는
 *   확인할 수 없다. 브라우저를 붙이면 자극에 없던 의존성이 생긴다. 그래서 규칙
 *   자체를 읽어 구조로 막는다.
 *
 * 막는 것
 *   A. 공통 장면(1·2·3·4·10) 규칙에 조건·버전 판별자가 붙는 것
 *   B. 조건 판별자가 장면 6 밖으로 나가는 것
 *   C. 장면 컨테이너에 건 애니메이션이 정지 화면(?still)에서도 도는 것
 *
 * 세는 것
 *   intervene 전용 구간(5~9)에 걸린 모션 규칙 수. 실패가 아니라 보고다 —
 *   여기가 늘어나면 조건 간 각성 차이가 벌어진다는 뜻이므로 눈에 보여야 한다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { APP_DIR, suite } = require('./lib/harness');

const CSS = fs.readFileSync(path.join(APP_DIR, 'style.css'), 'utf8');

const SHARED = [1, 2, 3, 4, 10];      // watch·intervene 재생 목록의 교집합
const INT_ONLY = [5, 6, 7, 8, 9];     // intervene 만 보는 구간

/* 조건·버전을 가르는 선택자 조각. 이 중 하나라도 붙으면 그 규칙은 참가자에 따라
 * 다른 화면을 만든다. */
const DISCRIMINATOR = /is-watch|is-intervene|data-mode|data-ver|\.mode-|\.ver-/;

/* 정지 화면에서 사라지는 것으로 확인된 게이트.
 *   .cam       ?still 이면 그룹 이름이 cam-still 이라 선택자가 안 걸린다(ART.svg)
 *   .hint-on   Scene6.attach 안에서만 붙는다
 * 이 중 하나를 거치지 않고 장면 컨테이너에 애니메이션을 걸면 스토리보드 캡처가
 * 전환·카메라 도중 상태로 찍힌다.
 *
 * is-watch 는 게이트가 아니다. 정지 화면에서도 watch 는 조작 UI 를 꺼야 해서
 * ?still 일 때도 붙기 때문이다(scenes.js 장면 6 render). 그래서 그 아래 시연
 * 애니메이션은 .cam 을 한 번 더 거친다.
 *
 * hint-on 은 "attach 가 재생일 때만 돈다"는 사실 위에 서 있다. 그 사실이 무너지면
 * 이 목록도 같이 무너지므로 아래에서 근거를 직접 확인한다 — 믿고 넘어가지 않는다. */
const STILL_GATE = /\.cam\b|hint-on/;
const JS = fs.readFileSync(path.join(APP_DIR, 'scenes.js'), 'utf8');

/** style.css 를 최상위 규칙 목록으로 편다. @keyframes 안쪽은 건너뛰고,
 *  @media·@supports 안쪽은 펴서 같이 본다. */
function rules(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  (function walk(text) {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const prelude = text.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const body = text.slice(open + 1, j - 1);
      if (/^@keyframes/i.test(prelude)) { /* 프레임 정의는 선택자가 없다 */ }
      else if (/^@/.test(prelude)) walk(body);          // @media·@supports 안으로
      else out.push({ selector: prelude, body: body });
      i = j;
    }
  })(src);
  return out;
}

/** 선택자가 가리키는 장면 번호들. `.sc4` 와 `[data-scene="4"]` 두 표기를 다 본다. */
function scenesOf(selector) {
  const found = new Set();
  let m;
  const cls = /\.sc(\d+)(?!\d)/g;
  while ((m = cls.exec(selector))) found.add(Number(m[1]));
  const attr = /\[data-scene\s*=\s*["']?(\d+)["']?\]/g;
  while ((m = attr.exec(selector))) found.add(Number(m[1]));
  return [...found];
}

const hasAnimation = body => /(^|[;{\s])animation(-name)?\s*:/.test(body);
const hasMotion = body => /(^|[;{\s])(animation|transition|transform)[-a-z]*\s*:/.test(body);

module.exports = async function () {
  const t = suite('연출 평행성 · style.css');
  const all = rules(CSS);
  t.ok(all.length > 40, '규칙을 읽었다', all.length + '개');

  t.section('A. 공통 장면 규칙은 조건·버전을 안 탄다');
  {
    const bad = all.filter(r => {
      const ns = scenesOf(r.selector);
      return ns.some(n => SHARED.indexOf(n) >= 0) && DISCRIMINATOR.test(r.selector);
    }).map(r => r.selector);
    t.ok(bad.length === 0,
      `장면 ${SHARED.join('·')} 에 조건 판별자 없음`, bad.length ? bad : undefined);
  }

  t.section('B. 조건 판별자는 장면 6 안에만 있다');
  {
    /* 장면 6만 조건에 따라 보이는 것이 다르다(조작 UI는 intervene 전용 — SPEC 4장).
     * 다른 장면에 판별자가 붙으면 그 장면이 조건마다 달라진 것이다. */
    const bad = all.filter(r => {
      if (!DISCRIMINATOR.test(r.selector)) return false;
      const ns = scenesOf(r.selector);
      return ns.length === 0 || ns.some(n => n !== 6);
    }).map(r => r.selector);
    t.ok(bad.length === 0, '판별자가 붙은 규칙은 전부 .sc6 안', bad.length ? bad : undefined);
  }

  t.section('C. 장면에 건 애니메이션은 정지 화면에서 안 돈다');
  {
    /* 여기서 한 번 놓쳐서 인물 애니메이션이 ?still 캡처에서도 돌았다.
     * 장면 컨테이너 선택자는 재생이든 캡처든 똑같이 걸리기 때문에, 게이트를
     * 반드시 선택자에 써 넣어야 한다. */
    const bad = all.filter(r =>
      scenesOf(r.selector).length > 0 && hasAnimation(r.body) && !STILL_GATE.test(r.selector)
    ).map(r => r.selector);
    t.ok(bad.length === 0, '장면 애니메이션은 .cam / .hint-on 을 거친다',
      bad.length ? bad : undefined);

    /* 게이트가 실제로 게이트인지 — 근거를 코드에서 확인한다 */
    t.ok(/CFG\.still === null \? 'cam' : 'cam-still'/.test(JS),
      '.cam 은 재생일 때만 붙는다 (ART.svg)');
    t.ok(/if \(CFG\.still === null\) Scene6\.attach\(/.test(JS),
      '.hint-on 은 재생일 때만 붙는다 (Scene6.attach 호출 조건)');
  }

  t.section('D. 어느 구간에 연출이 몰려 있나 (보고)');
  {
    const count = list => all.filter(r => {
      const ns = scenesOf(r.selector);
      return ns.some(n => list.indexOf(n) >= 0) && hasMotion(r.body);
    }).length;
    const shared = count(SHARED), only = count(INT_ONLY);
    t.ok(true, `공통 장면 ${SHARED.join('·')} 모션 규칙`, shared);
    t.ok(true, `intervene 전용 ${INT_ONLY.join('·')} 모션 규칙`, only);
    /* 공통 구간이 더 적으면 watch 참가자만 밋밋한 광고를 본 것이 된다.
     * 노출 시간·정보량 비대칭 위에 각성 비대칭이 하나 더 얹힌다(SPEC 2장 알려진 교란). */
    t.ok(shared >= only,
      'intervene 전용 구간이 공통 구간보다 화려하지 않다', { 공통: shared, intervene전용: only });
  }

  return t.failed;
};
