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

const SHARED = [1, 2, 3, 4, 11, 10];      // watch·intervene 재생 목록의 교집합
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

  /* ---------------------------------------------------------------
   * E. CSS 가 거는 손잡이가 그림에 실제로 있다
   *
   * 연출은 style.css 의 선택자가 scenes.js 의 class 이름을 맞히는 것으로만 붙어
   * 있다. 그림 쪽에서 이름을 바꾸거나 그룹을 없애면 규칙은 조용히 아무것도 안
   * 걸고, 화면은 연출 없이 재생되는데 **테스트는 전부 초록으로 통과한다.**
   * 여기서 두 파일을 맞대어 그 조용한 소실을 막는다.
   * --------------------------------------------------------------- */
  t.section('E. 장면 규칙의 손잡이가 그림에 있다');

  const { bootArt } = require('./lib/harness');
  const ART = bootArt('A');
  /* 장면별 마크업. 재생(?still 아님) 기준이다 — 연출은 재생에만 붙는다. */
  const MARKUP = {};
  for (let n = 1; n <= 10; n++) MARKUP[n] = ART['s' + n]({});

  /* 규칙 선택자에서 '.sc<N> ... .foo' 의 foo 들을 뽑는다.
   * .cam 은 ART.svg 가 붙이고 .scene/.is-in 등 상태 클래스는 엔진이 붙이므로 뺀다. */
  const ENGINE_CLASSES = new Set(['cam', 'cam-still', 'scene', 'scene-svg', 'is-in', 'is-out',
    'is-hold', 'is-rewinding', 'is-closed', 'is-dropped', 'is-dragging', 'is-watch',
    'hint-on', 'rewind-prompt', 'rewind-btn', 'rw-msg', 'cta']);

  const missing = [];
  for (const r of all) {
    const m = r.selector.match(/\.sc(\d+)\b/);
    if (!m) continue;
    const no = Number(m[1]);
    if (!MARKUP[no] || !hasMotion(r.body)) continue;
    const classes = (r.selector.match(/\.[a-z][\w-]*/g) || [])
      .map(c => c.slice(1))
      .filter(c => !/^sc\d+$/.test(c) && !ENGINE_CLASSES.has(c));
    for (const c of classes) {
      if (!new RegExp('class="[^"]*\\b' + c + '\\b').test(MARKUP[no])) {
        missing.push(`장면 ${no} · .${c} (${r.selector})`);
      }
    }
  }
  t.ok(missing.length === 0,
    '장면 규칙이 가리키는 class 가 그림에 전부 있다', missing);

  /* ---------------------------------------------------------------
   * F. 종속변인이 되는 버튼은 부추기지 않는다
   *
   * 장면 10 에는 나가는 길이 둘이다 — [지금 구매하기]와 오른쪽 위 [×].
   * **둘 다 종속변인이다**(CTA_CLICK · CLOSE_CLICK). 한쪽만 맥동하거나 더 늦게·
   * 더 화려하게 등장하면 그 연출이 곧 클릭률 차이가 된다.
   *
   * [되돌리기](.rewind-btn)는 맥동해도 된다 — 그쪽은 진행 조건이라 안 누르면
   * 광고가 끝나지 않고, 재는 값이 "눌렀는가"가 아니라 "언제 눌렀는가"다.
   * --------------------------------------------------------------- */
  t.section('F. 나가는 두 길을 한쪽으로 몰지 않는다');
  {
    const pick = sel => all.filter(r => r.selector.split(',').some(x => x.trim() === sel));
    const animOf = rules2 => {
      const m = rules2.map(r => (r.body.match(/animation:\s*([^;]+)/) || [])[1])
        .filter(Boolean).map(v => v.trim());
      return m.length ? m[0] : null;
    };
    const cta = animOf(pick('.cta'));
    const close = animOf(pick('.ad-close'));

    /* 2026-09-04: [×] 만 늦게 나오게 했다(1.5초). 실제 광고가 닫기를 미루는 문법이고
     * 사용자가 요청한 것이다. 그래서 "둘이 똑같이 등장한다"는 예전 검사는 더 못 쓴다.
     *
     * 대신 **두 자극의 [×] 가 같은 방식으로 늦는지**를 본다. 이게 실제로 지켜야 하는
     * 규칙이다 — 한쪽 자극만 닫기를 미루면 그 차이가 CLOSE_CLICK · CTA_CLICK 비교에
     * 그대로 들어온다. sfx.test.js 가 두 자극의 소리 코어를 대조하는 것과 같은 뜻이다.
     *
     * CTA 는 예전 그대로 둔다(세탁 400ms · 게임 연출 없음). 이번에 바꾼 것은 [×] 뿐이고,
     * 그 변경이 두 자극에 똑같이 들어갔다는 것만 여기서 보장한다. */
    const gameCss = fs.readFileSync(
      path.join(APP_DIR, '../game/src/styles/main.css'), 'utf8');
    const gameClose = (gameCss.match(/\.ad-close\s*\{[^}]*animation:\s*([^;]+);/) || [])[1];
    t.ok(gameClose && close && gameClose.trim() === close.trim(),
      '두 자극의 [×] 가 같은 방식·같은 지연으로 나온다',
      { 세탁: close || '없음', 게임: (gameClose || '없음').trim() });
    t.ok(/\bboth\b/.test(close || '') && /1500ms|--close-delay/.test(close || ''),
      '[×] 는 지연 뒤에 나오고 그 전에는 상태가 유지된다 (fill-mode both)', close || '없음');
    t.ok(!/infinite/.test(cta || '') && !/infinite/.test(close || ''),
      '둘 다 맥동하지 않는다 (되돌리기와 달리 여기는 종속변인이다)');

    /* 여기서 실제로 사고가 났다.
     *
     * .cta 는 left:50% + transform:translateX(-50%) 로 가운데를 잡는데, 등장
     * 애니메이션의 키프레임이 `transform: translateY(0) scale(1)` 이었다.
     * 애니메이션은 일반 선언보다 우선하고 fill-mode 가 both 라, **끝난 뒤에도
     * 그 값이 남아 가운데 정렬을 통째로 덮어썼다.** 버튼이 화면 한가운데에서
     * 시작해 오른쪽으로 58cqw 뻗어 잘려 나갔고, 눌림 효과(.is-pressed)도
     * 같은 이유로 먹지 않았다. 브라우저로 찍어 보기 전에는 안 보이는 종류다.
     *
     * 고친 방법은 키프레임에서 transform 대신 개별 속성 translate/scale 을
     * 쓰는 것이다 — 이쪽은 transform 과 합성된다. 여기서 그 규율을 지킨다. */
    const kf = name => {
      const m = CSS.match(new RegExp('@keyframes\\s+' + name + '\\s*\\{([\\s\\S]*?)\\n\\}'));
      return m ? m[1] : '';
    };
    const bad = [['.cta', cta], ['.ad-close', close]]
      .filter(([, a]) => a)
      .map(([sel, a]) => [sel, a.split(/\s+/)[0]])
      .filter(([sel, name]) => /(^|[;{\s])transform\s*:/.test(kf(name))
        && pick(sel).some(r => /(^|[;{\s])transform\s*:/.test(r.body)))
      .map(([sel, name]) => `${sel} ← @keyframes ${name}`);
    t.ok(bad.length === 0,
      '버튼 등장 키프레임이 transform 을 덮어쓰지 않는다 (가운데 정렬이 죽는다)', bad);
  }

  return t.failed;
};
