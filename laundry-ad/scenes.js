/* 클린가드 — 이염 방지 세탁 시트 실패-수정형 광고 자극
 * SPEC.md 구현. 프레임워크 없음 / 외부 요청 없음(오프라인 실행 가능).
 *
 * URL 파라미터
 *   mode=watch|intervene · ver=A|B · sid=<익명 세션 ID>
 *   debug=1  우상단 개발 패널(장면 점프·모드 토글·실시간 로그)
 *   still=N  장면 N 정지 화면(스토리보드 캡처용)
 *
 * 구성
 *   0 상수  1 파라미터  2 일러스트/장면 정의  3 로그  4 엔진  5 디버그  6 부트
 */
(function () {
  'use strict';

  /* ==========================================================
   * 0. 상수 / 설정
   * ========================================================== */

  var BRAND = '클린가드'; // 가상 브랜드 (교체 가능)

  // ver A/B는 "소재만" 다르다. 구조·길이·문구 구조 동일 (도구 8 평행 자극 요건)
  var VERSIONS = {
    A: {
      id: 'A',
      light: { name: '셔츠', josa_i: '가', use: '입을', shape: 'shirt' }, // 밝은색 대상
      dark: { name: '양말', josa_i: '이', shape: 'socks' }                // 짙은색 이염원
    },
    B: {
      id: 'B',
      light: { name: '수건', josa_i: '이', use: '쓸', shape: 'towel' },
      dark: { name: '티셔츠', josa_i: '가', shape: 'tee' }
    }
  };

  var MODES = { WATCH: 'watch', INTERVENE: 'intervene' };

  /* watch 조건에서 장면 6(수정 행동)을 재생하는 길이(ms) — 길이 통제의 유일한 출처.
   * 두 조건의 차이는 "수행 주체"뿐이어야 하므로, 예비조사에서 intervene의 실제
   * 조작 시간 중앙값이 나오면 이 값 하나만 바꾼다.
   * 이 상수가 장면 6의 dur, watch 시연 애니메이션 길이(CSS --s6-watch-dur),
   * 문 닫힘 시점(DOOR_CLOSE_AT 비율)을 모두 결정한다. */
  var WATCH_S6_MS = 4000;

  // 시연 애니메이션에서 문이 닫히기 시작하는 지점(재생 길이 대비 비율).
  // 시트가 투입구 안으로 사라지는 프레임(약 66%) 직후.
  var DOOR_CLOSE_AT = 0.6625;

  /* 효과음 — sfx.js 가 먼저 로드돼 window.AD_SFX 를 만들어 둔다.
   * 없더라도(스크립트 누락·구형 브라우저) 자극은 그대로 돌아가야 하므로 무음 대역을 둔다.
   * 게임 자극도 같은 이름의 신호를 같은 길이·세기로 낸다 — game/src/sfx.js 참고. */
  var Sfx = window.AD_SFX || {
    unlock: function () { return false; },
    play: function () { return false; },
    startBed: function () { return false; },
    stopBed: function () {},
    state: function () { return 'none'; },
    audioOk: function () { return null; },
    fired: 0, played: 0, bedOn: false
  };

  /* 나래이션 — 세탁 자극에만 있다(INTEGRATION.md §5-12 의 감수한 교란).
   * 효과음과 달리 게임 자극에 짝이 없으므로 sfx.js 코어에 넣지 않고 따로 둔다.
   * 스크립트가 빠져도 자극은 목소리 없이 그대로 돌아간다. */
  var Voice = window.AD_VOICE || {
    say: function () { return false; },
    stop: function () {},
    unlock: function () { return false; },
    state: function () { return 'none'; },
    voiceOk: function () { return null; },
    spoken: 0, heard: 0, text: {}, sec: {}
  };

  /* 장면 길이.
   *
   * 이 표는 두 번 다시 짜였고, 두 번 다 이유가 달랐다.
   *
   *   ① 옛 4·5·6·8초 고정 → 클립 + 0.3초.
   *      말이 1초 안팎에 끝나는 장면이 있어(장면 3 은 0.86초 말하고 5.14초를 더 서
   *      있었다) 말 끝과 컷 사이가 비었다. 빈 시간을 걷어냈다.
   *   ② 클립 + 0.3초 → 아래 표.
   *      ①의 대가로 게임 자극과의 노출 시간 대칭이 깨졌다(watch 18.6 vs 31.2초).
   *      노출 시간은 광고 태도에 바로 얹히는 값인데다 **자극과 1:1로 공선**이라
   *      로그에 남겨 공변량으로 빼는 것도 안 된다 — 세탁 참가자는 전원 짧고 게임
   *      참가자는 전원 길기 때문이다. 그래서 다시 맞췄다(INTEGRATION §5-14).
   *
   * **클립 + 0.3초는 이제 규칙이 아니라 하한이다.** 길이를 정하는 것은 자극 간
   * 대칭이고, 나래이션은 그 안에 들어가되 말이 끝난 뒤에도 화면이 남는다.
   * 남는 시간이 빈 시간이 되지 않게 하는 것은 길이가 아니라 그 장면의 그림이 할 일이다 —
   * 장면마다 아래에 그 일을 적어 두었다. 적을 것이 없으면 늘리지 말 것.
   *
   * 왜 클립에서 계산하지 않고 숫자를 적어 두나
   *   voice-clips.js 는 index.html 에서 두 줄 빼면 사라질 수 있다(INTEGRATION §5-12
   *   의 되돌리는 법). 길이를 클립에서 읽으면 그때 자극 길이가 통째로 달라진다.
   *   길이는 참가자 전원에게 같아야 하는 값이라 여기에 못 박고, 클립보다 짧아지면
   *   voice.test.js 가 잡는다.
   *
   * A·B 가 갈리는 장면(1·4)은 소재만 다르고 길이는 같다(SPEC 7장의 수용 기준).
   *
   *   장면            클립(초)                dur     남는 시간이 하는 일
   *     1 목표        2.64 (A) · 2.59 (B)  →  4.00    내일 입을 옷과 오늘의 빨래를 한 화면에 두는 설정 샷
   *     2 제품 미사용 1.28                 →  2.60    아무것도 넣지 않고 문이 닫히는 것을 보게 한다
   *     3 실패 진행   0.86                 →  6.00    드럼이 돌고 물이 물드는 것을 말없이 보는 시간이 불안을 쌓는다
   *     4 실패 결과   1.78 (A) · 1.72 (B)  →  7.40    광고의 경첩. 클로즈업으로 다시 잡은 얼룩을 읽을 시간이다
   *     7 제품 작동   2.14                 →  3.90    시트가 염료를 붙잡는 과정 자체가 제품 설명이다
   *     8 개선 결과   0.99                 →  3.25    클로즈업. 색이 그대로임을 확인하는 데 시간이 든다
   *     9 결과 비교   1.33                 →  4.00    눈이 두 벌을 오가야 차이가 읽힌다. 이 카테고리의 절정
   *    10 CTA        2.77                 →  8.00    참가자가 누를지 정하는 시간. 게임 제품 카드와 같은 8초다
   *
   * 장면 10 만은 연출이 아니라 **측정** 때문에 8초다. 3.07초일 때 버튼이 자리를
   * 잡는 1.2초를 빼면 누를 수 있는 시간이 1.9초뿐이었다. CTA_CLICK 이 종속변인이라
   * 게임 제품 카드와 같은 길이여야 한다 — 여기는 대칭을 맞출 때도 건드리지 않는다.
   *
   * 0.1초 단위로 반올림하지 않는다 — 반올림하면 남는 여백이 장면마다 갈리고
   * (버전 B 는 클립이 0.05초 짧아 더 남는다) 그 차이가 다시 빈 시간이 된다.
   *
   * **배경음 마디와 겹치지 않는지 확인할 것.** 배경음은 9.6초에 한 바퀴고 마디가
   * 2.4·4.8·7.2·9.6초다. 장면 경계가 마디에 걸리면 곡이 장면 전환을 예고한다.
   * 지금 watch 경계는 4.00·6.60·12.60·20.00초이고 한 바퀴 안으로 접으면
   * 4.00·6.60·3.00·0.80 — 가장 가까운 마디와도 0.60초 떨어져 있다.
   * 이 표를 고치면 이 계산을 다시 할 것.
   *
   * 장면 5·6 은 길이가 참가자에게 달려 있어 이 표에 없다.
   * 장면 안의 CSS 애니메이션은 --scene-dur 로 이 값을 받아 같이 늘고 준다. */
  var DUR = { 1: 4.0, 2: 2.6, 3: 6.0, 4: 7.4, 7: 3.9, 8: 3.25, 9: 4.0, 10: 8.0 };

  /* 장면 번호 → 클립 키. 자막이 갈리는 장면만 뒤에 판별자가 붙는다 —
   * 1·4 는 소재(ver), 6 은 수행 주체(mode)에 따라 자막이 다르다.
   * voice.test.js 가 이 표를 자막 함수와 직접 대조한다. */
  function voiceKey(no) {
    if (no === 1 || no === 4) return 's' + no + CFG.ver;
    if (no === 6) return 's6' + (CFG.mode === MODES.INTERVENE ? 'i' : 'w');
    return 's' + no;
  }

  /* OS "동작 줄이기" 설정 — 자극은 이 값에 따라 달라지지 않는다(속도·입자 수 고정).
   * 참가자 간 자극 동일성을 위해 로그에만 남긴다. */
  function readsReducedMotion() {
    try {
      var mq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
      return mq ? (mq.matches ? 1 : 0) : null;
    } catch (e) { return null; }
  }

  /* ==========================================================
   * 1. URL 파라미터
   * ========================================================== */

  var qs = new URLSearchParams(location.search);

  function pick(value, allowed, fallback) {
    return allowed.indexOf(value) >= 0 ? value : fallback;
  }

  function randomSid() {
    var s = 'sid-';
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var buf = new Uint8Array(8);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    for (var i = 0; i < buf.length; i++) s += chars[buf[i] % chars.length];
    return s;
  }

  var CFG = {
    mode: pick(qs.get('mode'), [MODES.WATCH, MODES.INTERVENE], MODES.WATCH),
    ver: pick(qs.get('ver'), ['A', 'B'], 'A'),
    sid: qs.get('sid') || randomSid(),
    debug: qs.get('debug') === '1',
    still: qs.get('still') ? parseInt(qs.get('still'), 10) : null
  };
  var V = VERSIONS[CFG.ver];

  /* ==========================================================
   * 2. 장면 정의 (SPEC 3장 장면표)
   *    render(ctx) -> Element.
   *    dur === null 이면 상호작용이 next()를 호출할 때까지 대기.
   * ========================================================== */

  /* ----------------------------------------------------------
   * 2-1. 일러스트 — 좌표계 1080x1920.
   *      watch·intervene 공용: 장면 6 외의 그림은 같은 함수로
   *      렌더되므로 모드에 따라 달라질 수 없다.
   * ---------------------------------------------------------- */

  /* 팔레트.
   *
   * 두 번 다시 짜였다.
   *
   *   ① 옅은 민트·흰색·베이지. 화면 전체가 밝은 한 구간에 몰려 있어 **흰 옷이 벽에
   *      묻혔다.** 걸레받이(base)를 눌러 가로 기준선 하나를 만드는 것으로 버텼다.
   *   ② 아래 표. ①의 처방이 부족했다 — 어두운 자리가 걸레받이 한 줄뿐이라
   *      **파스텔 삽화(아동 도서 문법)로 읽혔고 성인 대상 광고로 안 보였다.**
   *
   * 지금 규칙 셋.
   *
   *   값의 폭   가장 밝은 것(옷 #FFFFFF)과 가장 어두운 것(투입구 #0E1318)이 화면에
   *             같이 있어야 한다. 흰 옷을 흰 옷으로 보이게 하는 것은 옷의 색이 아니라
   *             **뒤에 깔린 값**이다. 실사 광고가 흰 빨래 뒤를 어둡게 까는 이유다.
   *   채도      중간 채도 파스텔이 아동 삽화의 표식이다. 배경은 채도를 내리고,
   *             채도는 **이염(붉은색)과 브랜드(청록)에만** 준다. 화면에서 색이 튀는
   *             자리가 둘뿐이면 그 둘이 뜻을 갖는다.
   *   이염 색   이 제품 범주(이염 방지 시트)의 대표 이미지는 **흰 빨래에 붉은 것
   *             하나가 들어가 전부 물드는 것**이다. 예전에는 짙은 남색이 이염원이라
   *             얼룩이 회보라(#8F9BC6)로 나왔고, 화면에서 더러움이 아니라 **그늘로
   *             읽혔다.** 붉은색은 옷 위에서 분홍으로 번져 사고로 보인다.
   *
   * 자막은 색을 지칭하지 않는다("셔츠 색이 변해 버렸다") — 이염원 색을 바꿔도
   * 나래이션·자막은 그대로다. A·B 가 갈리는 것은 소재이지 색 규칙이 아니다. */
  var PAL = {
    // 세탁실 — 채도를 내리고 값을 벌렸다. base 는 걸레받이·선반의 가장 어두운 값이다
    wall: '#AEB9C4', wallLo: '#8B98A6', wallHi: '#CBD4DC',
    /* 바닥은 콘크리트다. 예전의 따뜻한 베이지를 그대로 어둡게 눌렀더니 진흙으로
     * 읽혔다 — 세탁 광고에서 화면 아래 3분의 1이 흙색이면 그게 오염으로 보인다. */
    floor: '#79808A', floorLo: '#565D66', base: '#2B3037',
    // 세탁기 — 흰 가전이되 테두리·투입구에 진짜 어두운 값이 있다
    body: '#F4F7FA', bodyLo: '#C3CCD6', panel: '#D9E1E9', edge: '#8A97A5',
    ring: '#788593', ringLo: '#525E6B', door: '#B0BCC8', glass: '#42525F', opening: '#0E1318',
    // 물 · 염료 — 붉은 이염 (범주의 대표 이미지)
    water: '#93A9BA', dye: '#A81B34', dyeLo: '#CF4A63', stain: '#C85E78',
    // 의류
    light: '#FFFFFF', lightEdge: '#AAB6C2', lightShade: '#DCE4EC',
    dark: '#8C1C2C', darkEdge: '#61121E', darkHi: '#B03144',
    // 인물
    skin: '#D3A585', skinEdge: '#A87C59', hair: '#221C17', wear: '#47554F', wearLo: '#333F3A',
    // 제품 (가상 브랜드)
    brand: '#0E7A62', brandLo: '#075746', brandPale: '#CFE3DD',
    sheet: '#FFFFFF', sheetEdge: '#9FBFB5',
    box: '#E7EFEC', boxEdge: '#8AAEA3',
    ink: '#10151A', mute: '#56626D'
  };

  // ver B: 소재 외에 인물 옷 색상·배경 색조만 다르다 (구도·길이·정보량 동일)
  if (CFG.ver === 'B') {
    PAL.wall = '#C0B7AC'; PAL.wallLo = '#9E9488'; PAL.wallHi = '#D8D1C8';
    // A 와 반대로 짠다 — A 는 차가운 벽 + 중성 바닥, B 는 따뜻한 벽 + 차가운 바닥.
    // 둘 다 따뜻하게 두면 화면이 통째로 갈색이 되어 이번에도 흙으로 읽힌다.
    PAL.floor = '#6E7681'; PAL.floorLo = '#515861'; PAL.base = '#2B2F34';
    PAL.wear = '#6B4A3C'; PAL.wearLo = '#4E342A';
    PAL.light = '#FFFDF9'; PAL.lightEdge = '#C0B49E'; PAL.lightShade = '#EAE1D2';
  }

  var ART = {};

  /* 공용 그라디언트·필터. 내용이 동일하므로 장면 5처럼 다른 장면을
     끼워 넣어도 id 충돌이 문제되지 않는다. */
  ART.defs = function () {
    return '<defs>' +
      '<linearGradient id="g-wall" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + PAL.wallHi + '"/><stop offset="1" stop-color="' + PAL.wallLo + '"/>' +
      '</linearGradient>' +
      '<linearGradient id="g-floor" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + PAL.floor + '"/><stop offset="1" stop-color="' + PAL.floorLo + '"/>' +
      '</linearGradient>' +
      '<linearGradient id="g-body" x1="0" y1="0" x2="1" y2="0">' +
      '<stop offset="0" stop-color="' + PAL.body + '"/><stop offset="0.62" stop-color="' + PAL.body + '"/>' +
      '<stop offset="1" stop-color="' + PAL.bodyLo + '"/>' +
      '</linearGradient>' +
      /* 드럼 **안쪽**(수면 위)이다. 예전에는 옅은 물색(#EAF3F8)이라 창 전체가 밝았고,
       * 그 위의 흰 옷이 안 떴다. 물은 이제 따로 그리므로(ART.drum 의 water) 여기는
       * 물이 아니라 통 안이다 — 빛이 안 드는 금속이라 어둡다. */
      '<radialGradient id="g-water" cx="0.42" cy="0.3" r="0.9">' +
      '<stop offset="0" stop-color="#8DA0B0"/><stop offset="1" stop-color="#4B5966"/>' +
      '</radialGradient>' +
      '<radialGradient id="g-glass" cx="0.36" cy="0.3" r="0.8">' +
      '<stop offset="0" stop-color="#B9CBDD"/><stop offset="1" stop-color="' + PAL.glass + '"/>' +
      '</radialGradient>' +
      /* 장면 10(팩샷·CTA)의 바닥.
       *
       * 바깥 색이 **일부러 PAL.wall 을 안 쓴다.** 예전에는 썼는데, 방을 어둡게 하는
       * 순간 장면 10 바닥까지 같이 어두워져 그 위에 놓인 CTA 버튼(밝은 민트)의
       * 대비가 올라갔다. `CTA_CLICK` 이 이 연구의 종속변인이고 게임 쪽 제품 카드는
       * 안 바뀌었으므로, 그러면 **한쪽 CTA 만 눈에 더 띄게 만든 것**이 된다.
       * 그래서 팔레트를 갈기 전의 벽 값(#E7EEF4)에 못 박는다 — 방의 색조를 다시
       * 만지더라도 이 자리는 따라 움직이지 않는다.
       *
       * 팩샷이 이야기 장면보다 밝은 것 자체는 이 범주의 문법이기도 하다. */
      '<radialGradient id="g-pack" cx="0.5" cy="0.42" r="0.7">' +
      '<stop offset="0" stop-color="' + PAL.brandPale + '"/><stop offset="1" stop-color="#E7EEF4"/>' +
      '</radialGradient>' +
      /* 제품명 위를 한 번 스치는 빛(장면 10). 게임 자극의 제품 카드에도 같은 연출이
       * 같은 값으로 들어가 있다 — 한쪽 제품명만 반짝이면 그 차이가 제품 평가로 들어간다. */
      '<linearGradient id="g-sheen" x1="0" y1="0" x2="1" y2="0">' +
      '<stop offset="0" stop-color="#fff" stop-opacity="0"/>' +
      '<stop offset="0.5" stop-color="#fff" stop-opacity="0.9"/>' +
      '<stop offset="1" stop-color="#fff" stop-opacity="0"/>' +
      '</linearGradient>' +
      /* 클로즈업 배경 — 가장자리를 눌러 옷이 뜨게 한다. 벽도 옷도 거의 흰색이라
       * 붙여 놓으면 옷의 실루엣이 배경에 묻혔다. 광고 조명에서 제품 뒤를 어둡게
       * 까는 것과 같은 이유다. */
      '<radialGradient id="g-vig" cx="0.5" cy="0.46" r="0.72">' +
      '<stop offset="0" stop-color="#fff" stop-opacity="0.30"/>' +
      '<stop offset="0.55" stop-color="#fff" stop-opacity="0"/>' +
      '<stop offset="1" stop-color="' + PAL.ink + '" stop-opacity="0.42"/>' +
      '</radialGradient>' +
      /* 이염의 세로 농도. 물에 잠겨 있던 아래쪽이 더 짙다 — 균일하게 깔면
       * 옷 색깔 자체가 그런 것처럼 보이고 "물들었다"로 안 읽힌다. */
      '<linearGradient id="g-dye" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + PAL.stain + '" stop-opacity="0.12"/>' +
      '<stop offset="0.45" stop-color="' + PAL.stain + '" stop-opacity="0.26"/>' +
      '<stop offset="1" stop-color="' + PAL.stain + '" stop-opacity="0.46"/>' +
      '</linearGradient>' +
      '<clipPath id="c-s10name"><rect x="376" y="1132" width="328" height="100"/></clipPath>' +
      '<filter id="f-soft" x="-30%" y="-30%" width="160%" height="160%">' +
      '<feGaussianBlur stdDeviation="7"/></filter>' +
      '<filter id="f-blob" x="-40%" y="-40%" width="180%" height="180%">' +
      '<feGaussianBlur stdDeviation="4"/></filter>' +
      /* 물·거품을 드럼 창 안에 가둔다. 창 밖으로 새면 세탁기 몸통 위로 물이 흐른다. */
      '<clipPath id="c-drum"><circle cx="540" cy="1000" r="342"/></clipPath>' +
      '</defs>';
  };

  /* 카메라 — 장면 내용을 <g class="cam">으로 감싼다. 뷰박스는 10장면이 모두 같고
   * (1080x1920 고정) 화면 이동은 이 그룹의 CSS transform 하나로만 일어난다.
   * 정지 화면(?still)에서는 클래스 이름을 바꿔 카메라 규칙이 아예 안 걸리게 한다 —
   * 스토리보드 캡처는 움직이면 안 되고, 소품 애니메이션을 anim()으로 끄는 것과 같은 취지다. */
  ART.svg = function (inner, cls, html) {
    var el = document.createElement('div');
    el.className = 'scene ' + (cls || '');
    el.innerHTML =
      '<svg class="scene-svg" viewBox="0 0 1080 1920" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
      ART.defs() +
      '<g class="' + (CFG.still === null ? 'cam' : 'cam-still') + '">' + inner + '</g>' +
      '</svg>' + (html || '');
    return el;
  };

  ART.text = function (x, y, size, txt, o) {
    o = o || {};
    return '<text x="' + x + '" y="' + y + '" font-size="' + size + '"' +
      ' text-anchor="' + (o.anchor || 'middle') + '"' +
      ' fill="' + (o.fill || PAL.ink) + '"' +
      ' font-weight="' + (o.weight || 600) + '"' +
      (o.opacity ? ' opacity="' + o.opacity + '"' : '') + '>' + txt + '</text>';
  };

  /* 방 배경 — 세탁실. 모든 방 장면이 같은 장소로 읽히도록 소품 고정 */
  ART.room = function (o) {
    o = o || {};
    var tiles = '';
    for (var tx = 0; tx <= 1080; tx += 180) {
      tiles += '<path d="M' + tx + ',900 V1382" stroke="' + PAL.wallLo + '" stroke-width="3" opacity=".55"/>';
    }
    var shelf = o.noProps ? '' :
      '<g class="shelf">' +
      '<rect x="556" y="820" width="464" height="20" rx="8" fill="' + PAL.base + '"/>' +
      '<rect x="592" y="840" width="18" height="34" fill="' + PAL.base + '" opacity=".7"/>' +
      '<rect x="966" y="840" width="18" height="34" fill="' + PAL.base + '" opacity=".7"/>' +
      ART.box(806, 686, 1) +
      '</g>';
    /* 바구니를 오른쪽·아래로 옮겼다. 예전 자리(x22)는 프레임 왼쪽 끝에 걸쳐 있어
     * 재생 프레이밍(장면 2 는 1.3배로 밀어 art x145 부터 보인다)에서 거의 잘렸다.
     * 그때는 그 자리를 인물이 채우고 있어 티가 안 났는데, 인물을 걷어내자 화면
     * 왼쪽 아래가 통째로 빈 바닥이 됐다. 바구니가 그 자리를 맡는다. */
    var basket = o.noProps ? '' :
      '<g class="basket" transform="translate(150,96)">' +
      '<path d="M34,1206 h196 l-21,172 q-4,26 -30,26 h-94 q-26,0 -30,-26 Z" fill="' + PAL.brandPale + '" stroke="' + PAL.boxEdge + '" stroke-width="6" stroke-linejoin="round"/>' +
      '<rect x="22" y="1186" width="220" height="28" rx="14" fill="' + PAL.box + '" stroke="' + PAL.boxEdge + '" stroke-width="6"/>' +
      '<path d="M74,1236 v138 M132,1236 v140 M190,1236 v138" stroke="' + PAL.boxEdge + '" stroke-width="5" opacity=".8"/>' +
      '</g>';

    return '<rect x="0" y="0" width="1080" height="1920" fill="url(#g-wall)"/>' +
      '<rect x="0" y="880" width="1080" height="502" fill="' + PAL.wallHi + '" opacity=".5"/>' +
      '<path d="M0,884 H1080" stroke="' + PAL.wallLo + '" stroke-width="5"/>' +
      '<path d="M0,1140 H1080" stroke="' + PAL.wallLo + '" stroke-width="3" opacity=".55"/>' +
      tiles +
      '<rect x="0" y="1400" width="1080" height="520" fill="url(#g-floor)"/>' +
      '<rect x="0" y="1374" width="1080" height="30" fill="' + PAL.base + '"/>' +
      '<rect x="0" y="1374" width="1080" height="8" fill="#fff" opacity=".35"/>' +
      shelf + basket;
  };

  /* 세탁기 (전신) — o.open: 문 열림 / o.both: 두 상태를 모두 넣고 CSS로 전환 */
  ART.washer = function (o) {
    o = o || {};
    var openDoor = '<g class="door-open">' +
      '<circle cx="790" cy="1180" r="126" fill="' + PAL.opening + '"/>' +
      '<circle cx="790" cy="1180" r="126" fill="none" stroke="' + PAL.ringLo + '" stroke-width="14"/>' +
      '<path d="M710,1104 a126,126 0 0 1 96,-44" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" opacity=".25"/>' +
      '<ellipse cx="790" cy="1240" rx="98" ry="42" fill="#000" opacity=".18"/>' +
      '<g transform="translate(986,1180) rotate(9)">' +
      '<ellipse cx="0" cy="0" rx="32" ry="138" fill="' + PAL.door + '" stroke="' + PAL.ring + '" stroke-width="7"/>' +
      '<ellipse cx="-4" cy="0" rx="14" ry="108" fill="' + PAL.glass + '" opacity=".5"/>' +
      '</g></g>';
    var closedDoor = '<g class="door-closed">' +
      '<circle cx="790" cy="1180" r="158" fill="' + PAL.door + '" stroke="' + PAL.ring + '" stroke-width="10"/>' +
      '<circle cx="790" cy="1180" r="132" fill="none" stroke="' + PAL.bodyLo + '" stroke-width="14"/>' +
      '<circle cx="790" cy="1180" r="114" fill="url(#g-glass)"/>' +
      '<path d="M706,1112 q36,-44 90,-52" stroke="#fff" stroke-width="20" stroke-linecap="round" fill="none" opacity=".55"/>' +
      '<path d="M694,1160 q10,-26 26,-44" stroke="#fff" stroke-width="12" stroke-linecap="round" fill="none" opacity=".35"/>' +
      '</g>';
    var doorArea = o.both ? (openDoor + closedDoor) : (o.open ? openDoor : closedDoor);

    return '<g class="washer">' +
      '<ellipse cx="790" cy="1402" rx="230" ry="26" fill="' + PAL.ink + '" opacity=".14"/>' +
      '<rect x="576" y="900" width="424" height="500" rx="34" fill="url(#g-body)" stroke="' + PAL.edge + '" stroke-width="7"/>' +
      '<rect x="600" y="924" width="376" height="92" rx="22" fill="' + PAL.panel + '" stroke="' + PAL.edge + '" stroke-width="4"/>' +
      '<g class="w-dial"><circle cx="650" cy="970" r="24" fill="' + PAL.body + '" stroke="' + PAL.ringLo + '" stroke-width="6"/>' +
      '<path d="M650,970 V952" stroke="' + PAL.ringLo + '" stroke-width="6" stroke-linecap="round"/></g>' +
      '<rect x="696" y="950" width="150" height="40" rx="10" fill="' + PAL.opening + '" opacity=".85"/>' +
      '<rect x="712" y="964" width="52" height="12" rx="6" fill="' + PAL.brand + '"/>' +
      '<circle class="w-led w-led-a" cx="900" cy="970" r="11" fill="' + PAL.brand + '"/>' +
      '<circle class="w-led w-led-b" cx="940" cy="970" r="11" fill="' + PAL.ring + '"/>' +
      '<rect x="576" y="1372" width="424" height="28" rx="12" fill="' + PAL.bodyLo + '"/>' +
      doorArea +
      '</g>';
  };

  /* 시트 상자 (배경 소품 · 팩샷 공용) */
  ART.box = function (x, y, s) {
    s = s === undefined ? 1 : s;
    return '<g transform="translate(' + x + ',' + y + ') scale(' + s + ')">' +
      '<rect x="0" y="0" width="180" height="130" rx="12" fill="' + PAL.box + '" stroke="' + PAL.boxEdge + '" stroke-width="5"/>' +
      '<path d="M0,42 h180 v18 H0 Z" fill="' + PAL.brand + '" opacity=".9"/>' +
      '<rect x="0" y="0" width="180" height="42" rx="12" fill="' + PAL.brandPale + '"/>' +
      ART.text(90, 30, 24, BRAND, { fill: PAL.brandLo, weight: 800 }) +
      '<rect x="34" y="76" width="112" height="9" rx="4.5" fill="' + PAL.boxEdge + '"/>' +
      '<rect x="52" y="94" width="76" height="9" rx="4.5" fill="' + PAL.boxEdge + '" opacity=".7"/>' +
      '<path d="M148,104 q14,-10 22,0 t-6,14" fill="none" stroke="' + PAL.brand + '" stroke-width="5" stroke-linecap="round" opacity=".8"/>' +
      '</g>';
  };

  /* 시트 1장
   *
   * 시트에 브랜드를 적는다. 예전에는 동그란 마크와 물결선뿐이라, 참가자가 세탁기에
   * 끌어다 넣는 물건이 **무엇인지 화면에서 읽히지 않았다** — 브랜드는 선반 위 상자에만
   * 있었고 그건 배경 소품이라 눈이 안 간다. 개입 조건에서 참가자가 직접 다루는 유일한
   * 물건이 이 시트이므로, 넣는 동안 이름이 보여야 "클린가드를 넣었다"가 된다.
   * 장면 6(끌어다 놓기)·7(작동)·10(팩샷) 이 같은 함수를 쓰므로 세 곳이 같이 바뀐다.
   *
   * 마크(동그라미)를 빼고 그 자리에 이름을 넣었다. 둘 다 두면 124 높이에 마크·이름·
   * 물결선 셋이 겹친다. 물결선은 아래로 내렸다 — 세탁물을 뜻하는 기호라 남긴다. */
  ART.sheet = function (x, y, s, cls) {
    s = s === undefined ? 1 : s;
    return '<g class="' + (cls || '') + '" transform="translate(' + x + ',' + y + ') scale(' + s + ')">' +
      '<rect x="-90" y="-62" width="180" height="124" rx="20" fill="' + PAL.sheet + '" stroke="' + PAL.sheetEdge + '" stroke-width="5"/>' +
      '<rect x="-90" y="-62" width="180" height="124" rx="20" fill="' + PAL.brandPale + '" opacity=".55"/>' +
      ART.text(0, -12, 30, BRAND, { fill: PAL.brandLo, weight: 800 }) +
      '<path d="M-62,16 q31,-20 62,0 t62,0 M-62,44 q31,-20 62,0 t62,0" fill="none" stroke="' + PAL.brand + '" stroke-width="5" stroke-linecap="round" opacity=".75"/>' +
      '</g>';
  };

  /* 의류 — kind: shirt | tee | towel | socks. (x,y)=좌상단, 로컬 200x210 */
  var GARMENT_UID = 0;

  ART.garment = function (kind, o) {
    o = o || {};
    var fill = o.fill || PAL.light;
    var edge = o.edge || PAL.lightEdge;
    var s = o.s === undefined ? 1 : o.s;
    var body = '';

    var shade = o.shade || (o.fill ? PAL.darkHi : PAL.lightShade);

    /* 옷의 바깥 모양. 보이는 몸판과 얼룩을 자르는 clipPath 가 **같은 path** 를 쓴다 —
     * 예전에는 얼룩이 아무 데도 안 잘려서 옷 밖으로 삐져나왔다. 멀리서 볼 때는 안
     * 보였지만 카메라를 붙이자 얼룩이 인물의 몸통 위에 그려져 있었다. */
    var outline = '';

    if (kind === 'shirt' || kind === 'tee') {
      outline = '<path d="M70,14 L44,6 L8,44 L40,80 L54,64 L54,200 L146,200 L146,64 L160,80 L192,44 L156,6 L130,14' +
        ' C122,42 78,42 70,14 Z"';
      body =
        outline + ' fill="' + fill + '" stroke="' + edge + '" stroke-width="5" stroke-linejoin="round"/>' +
        // 소매·옆선 음영
        '<path d="M54,64 L54,200 L86,200 L86,70 Z" fill="' + shade + '" opacity=".5"/>' +
        '<path d="M8,44 L40,80 L54,64 L30,34 Z" fill="' + shade + '" opacity=".35"/>';
      if (kind === 'shirt') {
        body += '<path d="M70,14 L100,54 L130,14" fill="none" stroke="' + edge + '" stroke-width="5" stroke-linejoin="round"/>' +
          '<path d="M62,10 L100,54 L86,60 Z M138,10 L100,54 L114,60 Z" fill="' + shade + '" opacity=".55" stroke="' + edge + '" stroke-width="3"/>' +
          '<path d="M100,60 V194" stroke="' + edge + '" stroke-width="4"/>' +
          '<circle cx="100" cy="92" r="5" fill="' + edge + '"/>' +
          '<circle cx="100" cy="128" r="5" fill="' + edge + '"/>' +
          '<circle cx="100" cy="164" r="5" fill="' + edge + '"/>';
      } else {
        body += '<path d="M70,16 q30,26 60,-2" fill="none" stroke="' + edge + '" stroke-width="7"/>' +
          '<path d="M60,192 h80" stroke="' + edge + '" stroke-width="4" opacity=".6"/>';
      }
    } else if (kind === 'towel') {
      outline = '<rect x="22" y="20" width="156" height="176" rx="12"';
      body =
        outline + ' fill="' + fill + '" stroke="' + edge + '" stroke-width="5"/>' +
        '<rect x="22" y="20" width="42" height="176" rx="12" fill="' + shade + '" opacity=".45"/>' +
        '<rect x="30" y="128" width="140" height="13" rx="6" fill="' + edge + '"/>' +
        '<rect x="30" y="152" width="140" height="13" rx="6" fill="' + edge + '" opacity=".7"/>' +
        // 아랫단 술
        '<path d="M32,196 v14 M52,196 v14 M72,196 v14 M92,196 v14 M112,196 v14 M132,196 v14 M152,196 v14 M168,196 v14"' +
        ' stroke="' + edge + '" stroke-width="5" stroke-linecap="round"/>' +
        '<path d="M84,20 v-12 a16,16 0 0 1 32,0 v12" fill="none" stroke="' + edge + '" stroke-width="6"/>';
    } else if (kind === 'socks') {
      var sock = function (tx, rot) {
        return '<g transform="translate(' + tx + ',30) rotate(' + rot + ')">' +
          '<path d="M18,0 H74 V90 Q74,106 88,116 L112,134 Q128,146 116,162 Q104,178 88,166 L34,124 Q18,112 18,92 Z"' +
          ' fill="' + fill + '" stroke="' + edge + '" stroke-width="5" stroke-linejoin="round"/>' +
          '<path d="M74,90 Q74,106 88,116 L112,134 Q128,146 116,162 L74,128 Z" fill="' + shade + '" opacity=".45"/>' +
          '<rect x="18" y="0" width="56" height="22" rx="4" fill="' + shade + '" opacity=".75"/>' +
          '<path d="M18,26 h56" stroke="' + edge + '" stroke-width="4" opacity=".6"/>' +
          '</g>';
      };
      body = sock(6, -6) + sock(76, 8);
    }

    /* 이염 얼룩.
     *
     * 예전에는 타원 다섯 개였다. 멀리서는 넘어갔지만 클로즈업으로 바꾸자
     * **물방울이나 비눗방울로 읽혔다** — 실제 이염은 동그란 점이 아니다.
     * 세 겹으로 다시 짰다.
     *
     *   ① 전체 톤  옷 전체가 칙칙해진다. 이염의 첫인상은 얼룩이 아니라 **흰색이
     *              탁해진 것**이다. 이 겹이 없으면 "깨끗한 옷에 점이 묻었다"가 된다.
     *   ② 번진 덩어리  경계가 불규칙하고 흐린 후광이 있다. 원이 아니다.
     *   ③ 잔 얼룩  작은 것들이 흩어져 있어야 "물에서 옮은 것"으로 보인다.
     *              하나씩 찍힌 것처럼 크기가 고르면 오염이 아니라 무늬가 된다.
     *
     * 모양은 **난수가 아니라 고정 표**로 만든다. 난수를 쓰면 참가자마다 얼룩이
     * 달라지고, 그러면 같은 자극이 아니다. */
    var stain = '';
    if (o.stained && kind !== 'socks') {
      var cid = 'c-garment-' + (++GARMENT_UID);

      /* 각도별 반지름 배율. 이 값이 얼룩의 들쭉날쭉함을 만든다. */
      var blob = function (cx, cy, r, k, rot, amp) {
        var n = k.length, pts = [], i2, a, f;
        rot = rot || 0;
        amp = amp === undefined ? 2.2 : amp;
        for (i2 = 0; i2 < n; i2++) {
          a = (Math.PI * 2 * i2) / n;
          /* 표의 값을 1 기준으로 부풀린다. 표를 그대로 쓰면 거의 원이라 물방울로
           * 보이고, rot 으로 시작점을 옮기면 같은 표에서 다른 모양이 나온다. */
          f = 1 + (k[(i2 + rot) % n] - 1) * amp;
          pts.push([cx + Math.cos(a) * r * f, cy + Math.sin(a) * r * f * 0.84]);
        }
        var mid = function (p, q) {
          return ((p[0] + q[0]) / 2).toFixed(1) + ',' + ((p[1] + q[1]) / 2).toFixed(1);
        };
        var d = 'M' + mid(pts[n - 1], pts[0]);
        for (i2 = 0; i2 < n; i2++) {
          d += ' Q' + pts[i2][0].toFixed(1) + ',' + pts[i2][1].toFixed(1) +
            ' ' + mid(pts[i2], pts[(i2 + 1) % n]);
        }
        return '<path d="' + d + ' Z"/>';
      };

      /* 12점 · 이웃한 값이 완만하게 변한다. 8점에 큰 값이 번갈아 들어가면 별 모양이
       * 되고, 그걸 부드럽게 이으면 **둥근 사각형**이 된다 — 처음 짰을 때 그랬다. */
      /* 반지름은 **몸통 폭(92)보다 작아야 한다.** 예전 표의 첫 덩어리는 r=40 이었고
       * 후광(+11)과 들쭉날쭉(amp 2.2)까지 붙으면 실효 반지름이 50을 넘어 몸통을
       * 가득 채웠다. 그러면 화면에 보이는 것은 덩어리의 가장자리가 아니라 **옷
       * 윤곽에 잘린 자리** 뿐이라, 얼룩이 직사각형으로 뚝 끊겨 보였다.
       * 붉은색으로 바꾸자 그 직선이 대번에 드러났다.
       *
       * 소매(x 8~54 · 146~192)에도 둘 놓는다. 몸통에만 있으면 얼룩이 옷 모양이
       * 아니라 네모를 따라간다. 물에 잠긴 옷은 그렇게 물들지 않는다. */
      var BLOTS = [
        [100, 146, 26, [1.00, 1.07, 1.11, 1.04, 0.94, 0.87, 0.90, 0.97, 1.05, 1.09, 1.02, 0.95]],
        [70, 100, 19, [0.93, 0.98, 1.06, 1.10, 1.05, 0.96, 0.89, 0.92, 1.00, 1.08, 1.11, 1.01]],
        [130, 118, 21, [1.08, 1.02, 0.94, 0.90, 0.96, 1.04, 1.10, 1.06, 0.98, 0.91, 0.95, 1.03]],
        [92, 66, 14, [0.96, 1.04, 1.09, 1.03, 0.95, 0.90, 0.94, 1.02, 1.08, 1.05, 0.97, 0.92]],
        [124, 178, 16, [1.05, 1.10, 1.03, 0.95, 0.90, 0.93, 1.01, 1.07, 1.09, 1.00, 0.94, 0.98]],
        [36, 58, 15, [1.02, 0.96, 0.91, 0.97, 1.06, 1.10, 1.04, 0.95, 0.90, 0.98, 1.07, 1.09]],
        [164, 60, 13, [0.94, 1.01, 1.09, 1.06, 0.97, 0.91, 0.95, 1.03, 1.10, 1.05, 0.96, 0.92]]
      ];
      var SPECKS = [
        [106, 64, 6], [56, 120, 5], [148, 110, 4], [88, 144, 6],
        [120, 168, 4], [70, 74, 4], [140, 152, 5], [94, 116, 4],
        [26, 44, 4], [172, 46, 4]
      ];
      var SPECK_K = [1.00, 1.06, 0.97, 0.92, 0.98, 1.05, 1.08, 1.01, 0.95, 0.91, 0.99, 1.04];

      /* 세 겹이 같은 중심·같은 모양이면 과녁처럼 보인다 — 얼룩이 아니라 물방울이다.
       * 겹마다 시작점(rot)을 옮기고 속은 중심에서 비껴 놓는다. */
      var halo = '', core = '', deep = '', speck = '';
      for (var i3 = 0; i3 < BLOTS.length; i3++) {
        var b = BLOTS[i3];
        halo += blob(b[0], b[1], b[2] + 11, b[3], 3, 2.6);
        core += blob(b[0], b[1], b[2], b[3], 0, 2.2);
        if (i3 < 3) deep += blob(b[0] + b[2] * 0.22, b[1] - b[2] * 0.18, b[2] * 0.5, b[3], 7, 2.4);
      }
      for (var i4 = 0; i4 < SPECKS.length; i4++) {
        speck += blob(SPECKS[i4][0], SPECKS[i4][1], SPECKS[i4][2], SPECK_K, i4, 2.0);
      }

      stain =
        '<defs><clipPath id="' + cid + '">' + outline + '/></clipPath></defs>' +
        '<g clip-path="url(#' + cid + ')">' +
        // ① 옷 전체가 탁해진다
        outline + ' fill="url(#g-dye)"/>' +
        /* ② 번진 덩어리 — 흐린 후광 · 본체 · 더 진한 속.
         *
         * 이염원이 붉어지면서 이 세 겹의 균형을 다시 잡아야 했다. 회보라일 때는
         * 겹이 잘 안 보여서 본체(.42)와 속(.16)을 세게 줬는데, 같은 값에 붉은색을
         * 넣으니 **경계가 뚜렷한 덩어리 여럿 = 세포**로 읽혔다. 이염은 덩어리가
         * 도드라지는 게 아니라 **천 전체가 물들고 그 위에 농담이 있는 것**이다.
         * 그래서 ①(전체 톤)을 올리고 ②의 본체·속을 내렸다. */
        '<g fill="' + PAL.stain + '" opacity=".30" filter="url(#f-blob)">' + halo + '</g>' +
        '<g fill="' + PAL.stain + '" opacity=".22">' + core + '</g>' +
        '<g fill="' + PAL.dye + '" opacity=".09" filter="url(#f-blob)">' + deep + '</g>' +
        // ③ 잔 얼룩
        '<g fill="' + PAL.stain + '" opacity=".22" filter="url(#f-blob)">' + speck + '</g>' +
        '</g>';
    }

    return '<g class="garment ' + (o.cls || '') + '" transform="translate(' + (o.x || 0) + ',' + (o.y || 0) + ') scale(' + s + ')">' + body + stain + '</g>';
  };

  ART.lightGarment = function (o) { return ART.garment(V.light.shape, o); };
  ART.darkGarment = function (o) {
    o = o || {};
    o.fill = PAL.dark; o.edge = PAL.darkEdge; o.shade = PAL.darkHi;
    return ART.garment(V.dark.shape, o);
  };

  /* 손 — 소매 끝동 + 손등 + 손가락. 옷의 어깨를 위에서 쥔 손이다.
   *
   * 예전에는 **반지름 26 짜리 원 하나에 미소 곡선**이었다. 이 도형이 자극 전체를
   * 아동 도서 삽화로 읽히게 만든 가장 큰 요인이었다 — 손가락 없는 동그란 손은
   * 그림책 문법이고, 배경을 성인 톤으로 갈고 나니 이것만 남아 튀었다.
   *
   * 전신 인물을 걷어냈으므로(아래 s2 주석) **화면에 사람이 나오는 자리는 이제
   * 손뿐이다.** 이 도형 하나가 광고의 나이를 정한다.
   *
   * 손가락은 테두리(굵은 skinEdge) 위에 살(가는 skin)을 얹어 그린다 — 한 겹으로
   * 그리면 네 손가락이 한 덩어리로 뭉쳐 다시 벙어리장갑이 된다. */
  ART.personHand = function (cx, cy) {
    var FINGERS = 'M-18,4 q-4,17 2,25 M-6,8 q-4,19 2,27 M6,8 q-3,19 3,26 M17,4 q-2,16 4,22';
    var THUMB = 'M-26,-4 q-13,7 -11,19 q2,11 13,9';
    return '<g transform="translate(' + cx + ',' + cy + ')">' +
      // 소매 끝동
      '<path d="M-31,-48 h62 q9,0 9,11 v17 q0,9 -10,9 h-60 q-10,0 -10,-9 v-17 q0,-11 9,-11 Z"' +
      ' fill="' + PAL.wear + '" stroke="' + PAL.wearLo + '" stroke-width="3" stroke-linejoin="round"/>' +
      // 손등
      '<path d="M-27,-16 q0,-13 13,-13 h28 q13,0 13,13 v17 q0,15 -14,19 l-26,6 q-14,3 -14,-13 Z"' +
      ' fill="' + PAL.skin + '" stroke="' + PAL.skinEdge + '" stroke-width="3" stroke-linejoin="round"/>' +
      // 엄지 · 손가락 넷 — 천 앞으로 내려와 접힌다
      '<path d="' + THUMB + '" fill="none" stroke="' + PAL.skinEdge + '" stroke-width="15" stroke-linecap="round"/>' +
      '<path d="' + THUMB + '" fill="none" stroke="' + PAL.skin + '" stroke-width="12" stroke-linecap="round"/>' +
      '<path d="' + FINGERS + '" fill="none" stroke="' + PAL.skinEdge + '" stroke-width="14" stroke-linecap="round"/>' +
      '<path d="' + FINGERS + '" fill="none" stroke="' + PAL.skin + '" stroke-width="11" stroke-linecap="round"/>' +
      '</g>';
  };

  /* 세탁기 창 클로즈업 (장면 3·7 공용) */
  /* 드럼 안의 물.
   *
   * 예전에는 드럼 원판을 옅은 파랑 그라디언트로 통째로 칠하고 그 위에 염료 원 두
   * 개를 겹쳐 원판 전체를 물들였다. 그러면 화면이 물이 아니라 **색깔 있는 원판**이다 —
   * 거기에 동그란 염료 입자가 떠 있으니 배양접시로 읽혔고, 6초짜리 장면(장면 3)이
   * 그 그림으로 서 있었다.
   *
   * 드럼식 세탁기는 물이 **아래에 고여** 있고, 수면이 출렁이고, 유리에 거품이 붙는다.
   * 셋 다 넣었다. 그리고 염료는 원판이 아니라 **물을** 물들인다 — "물이 붉어진다"가
   * 이 장면이 할 말이고, 그래야 다음 컷(옷이 분홍이 된 것)의 원인이 화면에 있다.
   *
   * 수면 높이(1108)는 드럼 중심(1000)보다 아래다. 반쯤 채우면 옷이 잠겨 안 보이고,
   * 너무 얕으면 옷이 물에 안 닿아 이염의 경로가 화면에서 끊긴다.
   *
   * 물결 path 는 드럼(198~882)보다 넓게(84~944) 그린다. 출렁이며 좌우로 움직일 때
   * 폭이 모자라면 가장자리에서 물이 끝나는 것이 보인다. */
  var DRUM_WATER_Y = 1108;
  var DRUM_WAVE = 'M84,' + DRUM_WATER_Y + ' q86,-30 172,0 t172,0 t172,0 t172,0 t172,0 V1420 H84 Z';

  /* 유리에 붙은 거품. 자리는 고정 표다 — 난수를 쓰면 참가자마다 다른 화면이 된다.
   * 수면 근처에 몰리되 몇 개는 위쪽 유리에도 남겨 둔다(세탁 중에 튄 것). */
  var SUDS = [
    [332, 1042, 26], [408, 1086, 17], [286, 1104, 13], [636, 1058, 22],
    [716, 1094, 15], [560, 1030, 12], [470, 1044, 9], [660, 1006, 10],
    [372, 972, 8], [612, 1132, 12], [500, 1120, 9], [770, 1048, 11]
  ];

  ART.drum = function (inner, o) {
    o = o || {};
    // 드럼 안쪽 타공
    var holes = '';
    for (var a = 0; a < 360; a += 22.5) {
      var rad = a * Math.PI / 180;
      holes += '<circle cx="' + (540 + Math.cos(rad) * 306).toFixed(1) + '" cy="' + (1000 + Math.sin(rad) * 306).toFixed(1) +
        '" r="9" fill="' + PAL.ringLo + '" opacity=".35"/>';
    }

    var slosh = o.still ? '' : 'drum-slosh';
    // 물 — 옷 뒤에 깔린다
    var water =
      '<g clip-path="url(#c-drum)"><g class="' + slosh + '">' +
      '<path d="' + DRUM_WAVE + '" fill="' + PAL.water + '"/>' +
      '<path d="' + DRUM_WAVE + '" fill="' + PAL.glass + '" opacity=".22" transform="translate(-46,30)"/>' +
      '<path d="' + DRUM_WAVE + '" fill="none" stroke="#fff" stroke-width="6" opacity=".45"/>' +
      '</g></g>';
    /* 잠긴 부분을 덮는 얇은 물 — 옷 위에 깔려야 "물에 잠겼다"가 된다.
     * 이게 없으면 옷이 물 앞에 떠 있는 그림이다. */
    var glaze =
      '<g clip-path="url(#c-drum)"><g class="' + slosh + '">' +
      '<path d="' + DRUM_WAVE + '" fill="' + PAL.water + '" opacity=".42"/>' +
      '</g></g>';
    // 염료가 물에 푸는 것 (장면 3 만 — o.dyeClass 를 넘긴다)
    var dye = !o.dyeClass && !o.dyeStill ? '' :
      '<g clip-path="url(#c-drum)"><g class="' + (o.dyeClass || '') + '"' +
      (o.dyeStill ? ' opacity=".75"' : '') + '>' +
      '<path d="' + DRUM_WAVE + '" fill="' + PAL.dye + '" opacity=".5"/>' +
      '<circle cx="430" cy="1090" r="150" fill="' + PAL.dye + '" opacity=".5" filter="url(#f-soft)"/>' +
      '<circle cx="560" cy="1150" r="120" fill="' + PAL.dyeLo + '" opacity=".4" filter="url(#f-soft)"/>' +
      '</g></g>';
    var suds = '<g clip-path="url(#c-drum)">';
    for (var s2 = 0; s2 < SUDS.length; s2++) {
      var b = SUDS[s2];
      suds += '<circle cx="' + b[0] + '" cy="' + b[1] + '" r="' + b[2] + '" fill="#fff" opacity=".30"/>' +
        '<circle cx="' + (b[0] - b[2] * 0.3) + '" cy="' + (b[1] - b[2] * 0.34) + '" r="' + (b[2] * 0.34).toFixed(1) +
        '" fill="#fff" opacity=".5"/>';
    }
    suds += '</g>';

    return ART.room({ noProps: true }) +
      '<g class="drum-body">' +
      '<rect x="56" y="300" width="968" height="1160" rx="56" fill="url(#g-body)" stroke="' + PAL.edge + '" stroke-width="8"/>' +
      '<rect x="100" y="344" width="880" height="108" rx="26" fill="' + PAL.panel + '" stroke="' + PAL.edge + '" stroke-width="4"/>' +
      '<circle cx="176" cy="398" r="28" fill="' + PAL.body + '" stroke="' + PAL.ringLo + '" stroke-width="7"/>' +
      '<rect x="240" y="378" width="180" height="42" rx="10" fill="' + PAL.opening + '" opacity=".85"/>' +
      '<rect x="258" y="392" width="60" height="14" rx="7" fill="' + PAL.brand + '"/>' +
      '<circle cx="880" cy="398" r="13" fill="' + PAL.brand + '"/>' +
      '<circle cx="928" cy="398" r="13" fill="' + PAL.ring + '"/>' +
      '<circle cx="540" cy="1000" r="404" fill="' + PAL.door + '" stroke="' + PAL.ring + '" stroke-width="12"/>' +
      '<circle cx="540" cy="1000" r="366" fill="' + PAL.bodyLo + '"/>' +
      '<circle cx="540" cy="1000" r="342" fill="' + (o.water || 'url(#g-water)') + '"/>' +
      holes +
      water +
      inner +
      glaze + dye + suds +
      '<circle cx="540" cy="1000" r="342" fill="none" stroke="' + PAL.ringLo + '" stroke-width="14" opacity=".45"/>' +
      '<path d="M290,832 q66,-102 186,-134" fill="none" stroke="#fff" stroke-width="34" stroke-linecap="round" opacity=".45"/>' +
      '<path d="M264,918 q14,-40 40,-72" fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round" opacity=".3"/>' +
      '</g>';
  };

  /* 염료 입자 */
  var PART_POS = [
    [-140, -70], [-60, -150], [50, -160], [140, -86], [172, 20], [120, 128],
    [24, 172], [-80, 152], [-168, 54], [-34, -46], [78, 54], [-108, 26]
  ];

  ART.particles = function (cls, o) {
    o = o || {};
    var out = '';
    for (var i = 0; i < PART_POS.length; i++) {
      var cx = 540 + PART_POS[i][0];
      var cy = 1000 + PART_POS[i][1];
      var tx, ty;
      if (o.toward) { tx = o.toward[0] - cx; ty = o.toward[1] - cy; }
      else { tx = PART_POS[i][0] * 0.55; ty = PART_POS[i][1] * 0.55; }
      /* 가장자리를 흐린다. 또렷한 원이면 물에 푼 염료가 아니라 **떠 있는 알갱이**로
       * 보이고, 열두 개가 모이면 배양접시의 세포가 된다. 반지름도 줄였다. */
      var r = 8 + (i % 4) * 3;
      out += '<circle class="' + cls + '" filter="url(#f-blob)" cx="' + cx + '" cy="' + cy + '" r="' + r + '"' +
        ' fill="' + (i % 3 === 0 ? PAL.dyeLo : PAL.dye) + '"' +
        ' style="--tx:' + tx.toFixed(0) + 'px;--ty:' + ty.toFixed(0) + 'px;animation-delay:' + (i * 0.16).toFixed(2) + 's"/>';
    }
    return out;
  };

  /* ----------------------------------------------------------
   * 2-2. 장면별 그림 (o.still = true 면 애니메이션 클래스 제거)
   * ---------------------------------------------------------- */

  function anim(cls, still) { return still ? '' : cls; }

  // 1. 목표
  /* 1. 목표 — 밝은 옷과 짙은 옷을 하나씩 들고 있는 클로즈업.
   *
   * 예전에는 방 전체가 보이는 와이드 샷이었고, **장면 2 와 거의 같은 그림이었다** —
   * 같은 거리·같은 자리에 선 인물·같은 세탁기. 광고가 똑같은 프레임 두 장으로
   * 시작하고 있었다. 지금은 1 이 클로즈업, 2 가 와이드다.
   *
   * 이 광고의 전제는 "밝은 옷과 짙은 옷을 **같이** 빤다"이고, 그 둘을 나란히 든
   * 그림이면 첫 컷에 전제가 다 들어간다. 말풍선은 뺐다 — 얼굴이 없는 컷에서
   * 말풍선은 가리킬 대상이 없고, 담고 있던 문구("내일 입을 셔츠")는 자막이
   * 그대로 갖고 있어 정보량은 그대로다.
   *
   * 짙은 옷이 왼쪽·밝은 옷이 오른쪽인 것은 예전 배치 그대로다. */
  ART.s1 = function (o) {
    o = o || {};
    /* 둘을 나란히 같은 높이로 두면 두 물건이 대등해 보이고 화면 아래가 통째로 빈다.
     * 짙은 옷을 왼쪽 위 · 밝은 옷을 오른쪽 아래로 어긋나게 놓아 대각선을 만든다 —
     * 세로 화면이 채워지고, 크기 차이로 **밝은 옷이 주인공**인 것도 같이 말한다. */
    var put = function (shape, S, X, Y) {
      var m = ART.GARMENT_BODY[shape] || ART.GARMENT_BODY.shirt;
      return { x: X - S * m.cx, y: Y - S * m.cy, hx: X, hy: Y - S * (m.cy - m.top), s: S };
    };
    var dark = put(V.dark.shape, 3.6, 280, 860);
    var light = put(V.light.shape, 4.4, 760, 1180);
    var aD = ART.armFromTop(dark.hx, dark.hy, -1, 118, 2.6);
    var aL = ART.armFromTop(light.hx, light.hy, 1, 130, 2.6);

    return ART.room({ noProps: true }) +
      '<rect x="0" y="0" width="1080" height="1920" fill="url(#g-vig)"/>' +
      aD.arm + aL.arm +
      ART.darkGarment({ x: dark.x, y: dark.y, s: dark.s, cls: 's1-hold s1-hold-d' }) +
      ART.lightGarment({ x: light.x, y: light.y, s: light.s, cls: 's1-hold s1-hold-l' }) +
      aD.hand + aL.hand;
  };


  /* 2. 제품 미사용 — 상자는 선반 위에 그대로(사용하지 않음)
   *
   * 왜 전신 인물을 걷어냈나
   *   예전에는 방 왼쪽에 인물이 서서 빨래를 세탁기로 던졌다. 그 인물이 점 눈 ·
   *   손가락 없는 원 손 · 콩 몸통 · 4.5등신의 **아동 도서 삽화**였고, 배경을 성인
   *   광고 톤으로 갈고 나자 화면에서 그것만 남아 튀었다.
   *
   *   벡터로 어른을 사실적으로 그리는 쪽은 어설퍼질 위험이 커서, 이 범주의 실사
   *   광고가 실제로 하는 방식을 골랐다 — **얼굴과 몸은 프레임 밖에 두고 손·옷·기계만
   *   남긴다.** 장면 4·8 은 이미 같은 이유로 클로즈업이었다(holdCloseup 주석).
   *
   *   덤이 둘. 게임 자극(잠수정 — 사람이 없다)과의 비대칭이 하나 줄었고, 인물
   *   마크업(person·armsHold·armsLift·holdFigure·holdFrame)이 통째로 사라져 코드가
   *   줄었다. 그 다섯은 여기가 마지막 사용처였다.
   *
   * 조건 간 비대칭은 없다 — 장면 2 는 watch·intervene 이 함께 보는 장면이다.
   *
   * 팔은 화면 위에서 들어온다. 옷을 쥔 손이 투입구 쪽으로 내려갔다가 놓고 물러난다
   * (s2-hands). 옷이 날아 들어가는 것은 예전 그대로 s2-toss 다 — 두 그룹이 따로
   * 움직여야 "놓았다"가 된다. 한 그룹에 묶으면 손도 드럼 안으로 빨려 들어간다. */
  ART.s2 = function (o) {
    o = o || {};
    /* 팔뚝은 **짧고 굵어야** 팔로 보인다. 처음에는 손을 옷마다 하나씩(y 1045·1140)
     * 두고 폭 86·74 로 그렸는데, 프레임 위에서 거기까지 내려오는 600px 짜리 가는
     * 막대 둘이 되어 팔이 아니라 촉수였다. 손을 위로 올려 팔을 짧게 하고(340px)
     * 폭을 130 으로 키웠다 — 길이:폭이 2.6:1 이면 팔뚝으로 읽힌다.
     *
     * 손은 밝은 옷의 **어깨**를 잡는다. 옷 상자의 원점(x,y)에 두면 옷 왼쪽 위
     * 허공을 쥔다. 어깨 자리는 소재마다 다르므로 GARMENT_BODY 를 쓴다 —
     * 클로즈업(holdCloseup)이 쓰는 것과 같은 표다. ver B(수건)도 저절로 맞는다.
     *
     * 짙은 옷은 밝은 옷 위에 얹는다. 손 셋이 필요 없고, "둘을 같이 빤다"는 이
     * 광고의 전제가 한 뭉치로 보인다. */
    var S = 2.6, gx = 140, gy = 700;
    var m = ART.GARMENT_BODY[V.light.shape] || ART.GARMENT_BODY.shirt;
    var a1 = ART.armFromTop(gx + m.gx1 * S, gy + m.gy * S, -1, 96, 1.3);
    var a2 = ART.armFromTop(gx + m.gx2 * S, gy + m.gy * S, 1, 96, 1.3);
    return ART.room() +
      ART.washer(o.still ? { open: true } : { both: true }) +
      // 팔은 옷 뒤 · 손은 옷 앞. 같은 클래스라 두 그룹이 같이 움직인다
      '<g class="' + anim('s2-hands', o.still) + '">' + a1.arm + a2.arm + '</g>' +
      '<g class="' + anim('s2-toss', o.still) + '">' +
      ART.lightGarment({ x: gx, y: gy, s: S }) +
      ART.darkGarment({ x: gx + 130, y: gy + 330, s: 1.1 }) +
      '</g>' +
      '<g class="' + anim('s2-hands', o.still) + '">' + a1.hand + a2.hand + '</g>';
  };

  // 3. 실패 진행 — 짙은 색에서 염료가 번진다
  ART.s3 = function (o) {
    o = o || {};
    var tumble =
      '<g class="' + anim('s3-tumble', o.still) + '">' +
      '<circle cx="540" cy="1000" r="330" fill="none"/>' +
      ART.lightGarment({ x: 500, y: 780, s: 1.0 }) +
      ART.darkGarment({ x: 330, y: 980, s: 0.95 }) +
      '</g>';
    /* 염료는 이제 원판이 아니라 **물**을 물들인다(ART.drum 의 dye 층). 예전에는
     * 드럼 원판 전체에 반투명 원을 얹어 창 전체가 균일하게 붉어졌는데, 그러면
     * 물이 물드는 것이 아니라 조명 색이 바뀌는 것으로 보인다. */
    /* 염료 입자(ART.particles)는 여기서 뺐다. 물이 붉어지는 것으로 이미 말이 되고,
     * 또렷한 원 열두 개가 물 위에 떠 있으면 그게 다시 배양접시의 세포가 된다.
     * 입자는 **장면 7 에만** 남는다 — 거기서는 "시트가 염료를 붙잡는다"는 뜻이라
     * 하나하나가 눈에 보여야 하고, 실제로 시트 쪽으로 빨려 들어간다.
     *
     * 이 장면의 움직임은 셋으로 충분하다: 옷이 구르고(s3-tumble), 물이 출렁이고
     * (drum-slosh), 물이 붉어진다(s3-tint). */
    return ART.drum(
      tumble,
      { dyeClass: anim('s3-tint', o.still), dyeStill: !!o.still, still: o.still }
    );
  };

  // 4. 실패 결과
  ART.s4 = function (o) {
    o = o || {};
    return ART.holdCloseup({ stained: true, still: o.still });
  };

  /* 옷을 들어 올려 살펴보는 클로즈업 (장면 4·8·9 공용)
   *
   * 왜 전신 샷을 버렸나
   *   예전에는 방 전체가 보이는 와이드 샷에 인물이 옷을 가슴 앞에 들고 있었다.
   *   그 구도에서는 **옷이 몸통 위에 겹쳐 그려져 "들고 있다"가 아니라 "입고 있다"로
   *   읽혔고**, 정작 봐야 할 얼룩이 화면 폭의 6분의 1이었다. 세탁 광고가 사는 자리는
   *   천이 화면을 채우는 클로즈업이다 — 이 장면들의 일은 "색이 변한 것을 한눈에
   *   보이게"(SPEC 3장)이지 인물을 보여 주는 것이 아니다.
   *
   * 얼굴을 뺀 이유
   *   손과 소매만 남기고 얼굴은 프레임 밖이다. 표정으로 실패를 전하면 그 실패가
   *   **사람의 실수**로 읽히는데, 원인은 "시트를 안 넣은 것" 하나여야 하고 인물을
   *   무능하게 그리지 않는 것이 고정 원칙이다(SPEC 2장). 옷이 주인공이면 탓이
   *   염료로 간다. 대신 옷이 처지는 연출(s4-garment-check)이 감정을 맡는다.
   *
   * 두 조건·두 버전이 같은 함수를 쓴다. stained 값 하나만 다르다. */
  /* 옷 모양마다 다른 값 — 몸판의 중심(카메라가 맞출 자리)과 손이 잡는 어깨 위치.
   * 셔츠는 200×210 상자 안에서 몸판이 x54~146 뿐이라 상자 중심과 몸판 중심이 다르다.
   * 상자를 기준으로 맞추면 옷이 화면 가운데에서 아래로 밀린다. */
  ART.GARMENT_BODY = {
    shirt: { cx: 100, cy: 132, gx1: 44, gx2: 156, gy: 14, top: 8 },
    tee:   { cx: 100, cy: 132, gx1: 44, gx2: 156, gy: 14, top: 8 },
    towel: { cx: 100, cy: 108, gx1: 30, gx2: 170, gy: 26, top: 22 },
    socks: { cx: 114, cy: 119, gx1: 50, gx2: 150, gy: 34, top: 32 }
  };

  /* 위에서 내려온 팔 하나 + 그 끝의 손. 클로즈업 장면들이 공유한다. */
  ART.armFromTop = function (hx, hy, dir, w, handScale) {
    return {
      arm: '<path d="M' + (hx + dir * (w || 150)) + ',-120 L' + hx + ',' + hy + '"' +
        ' stroke="' + PAL.wear + '" stroke-width="' + (w || 150) + '" stroke-linecap="round" fill="none"/>',
      hand: '<g transform="translate(' + hx + ',' + hy + ') scale(' + (handScale || 3.4) + ')">' +
        ART.personHand(0, 0) + '</g>'
    };
  };

  ART.holdCloseup = function (o) {
    o = o || {};
    var S = 6.5;                                   // 몸판이 화면 폭의 약 55%가 되는 배율
    var m = ART.GARMENT_BODY[V.light.shape] || ART.GARMENT_BODY.shirt;
    var x = 540 - S * m.cx;                        // 몸판 중심을 화면 가운데로
    var y = 1000 - S * m.cy;
    var hx1 = x + m.gx1 * S, hx2 = x + m.gx2 * S, hy = y + m.gy * S;

    /* 팔은 화면 위에서 비스듬히 들어온다. 세로로 곧게 내리면 옷걸이로 보인다.
     * 옷과 손은 한 덩어리(.hold-garment)로 움직이고 팔은 가만히 있다 — 움직임이
     * 작고 손이 팔 끝을 덮어서 떨어져 보이지 않는다. */
    var arm = function (hx, dir) {
      return '<path d="M' + (hx + dir * 170) + ',-120 L' + hx + ',' + hy + '"' +
        ' stroke="' + PAL.wear + '" stroke-width="150" stroke-linecap="round" fill="none"/>';
    };
    var hand = function (hx) {
      return '<g transform="translate(' + hx + ',' + hy + ') scale(3.4)">' + ART.personHand(0, 0) + '</g>';
    };

    return ART.room({ noProps: true }) +
      '<rect x="0" y="0" width="1080" height="1920" fill="url(#g-vig)"/>' +
      arm(hx1, -1) + arm(hx2, 1) +
      '<g class="hold-garment">' +
      ART.lightGarment({ x: x, y: y, s: S, stained: !!o.stained }) +
      hand(hx1) + hand(hx2) +
      '</g>';
  };
  // 5. 되감기 — 장면 4→3→2 역방향 후 세탁 시작 직전에 정지
  ART.s5 = function (o) {
    o = o || {};
    var scan = '<g class="rew-scan" opacity=".5">';
    for (var y = 0; y < 1920; y += 24) {
      scan += '<rect x="0" y="' + y + '" width="1080" height="8" fill="#0B1830" opacity=".16"/>';
    }
    scan += '</g>';
    // 되감기 색보정 + 비네트
    var grade =
      '<rect x="0" y="0" width="1080" height="1920" fill="#2A3E6B" opacity=".16"/>' +
      '<rect x="0" y="0" width="1080" height="1920" fill="none" stroke="#0B1830" stroke-width="220" opacity=".18"/>';
    var badge =
      '<g class="rew-badge">' +
      '<rect x="60" y="120" width="316" height="100" rx="26" fill="#101725" opacity=".82"/>' +
      ART.text(218, 190, 52, '◀◀ 되감기', { fill: '#fff', weight: 700 }) +
      '</g>';
    return '<g class="rew-f rew-f1">' + ART.s4({ still: true }) + '</g>' +
      '<g class="rew-f rew-f2">' + ART.s3({ still: true }) + '</g>' +
      '<g class="rew-f rew-f3">' + ART.s2({ still: true }) + '</g>' +
      grade + scan + badge;
  };

  // 손가락 아이콘 (intervene 힌트용 — 인물이 아니라 UI 안내임을 드러내는 흰 아이콘)
  ART.hand = function () {
    return '<path d="M-8,18 q-34,32 -60,40 q-18,6 -24,-10 q-6,-16 10,-24 l44,-26 Z"' +
      ' fill="#fff" stroke="' + PAL.ink + '" stroke-width="6" stroke-linejoin="round"/>' +
      '<circle cx="0" cy="0" r="28" fill="#fff" stroke="' + PAL.ink + '" stroke-width="6"/>' +
      '<circle cx="0" cy="0" r="9" fill="' + PAL.brand + '"/>' +
      '<circle cx="0" cy="0" r="40" fill="none" stroke="' + PAL.brand + '" stroke-width="5" opacity=".55"/>';
  };

  /* 인물의 손 (watch 모드에서 시트를 집어 넣는 손 — 소매 + 손) */
  ART.handGrip = function () {
    return '<g transform="rotate(-16) scale(1.2)">' +
      // 소매(팔뚝 일부)
      '<path d="M10,-10 L92,36 q24,14 10,38 q-16,24 -40,10 L4,44 Z"' +
      ' fill="' + PAL.wear + '" stroke="' + PAL.wearLo + '" stroke-width="5" stroke-linejoin="round"/>' +
      '<path d="M62,18 L46,52" stroke="' + PAL.wearLo + '" stroke-width="7" stroke-linecap="round" opacity=".55"/>' +
      // 손가락 (손바닥 아래에 먼저)
      '<path d="M-40,-26 q-34,-6 -44,14 M-40,0 q-38,-2 -46,20 M-36,24 q-32,6 -36,26" fill="none"' +
      ' stroke="' + PAL.skin + '" stroke-width="26" stroke-linecap="round"/>' +
      '<path d="M-40,-26 q-34,-6 -44,14 M-40,0 q-38,-2 -46,20 M-36,24 q-32,6 -36,26" fill="none"' +
      ' stroke="' + PAL.skinEdge + '" stroke-width="4" stroke-linecap="round" opacity=".45"/>' +
      // 손바닥
      '<path d="M-46,-36 q52,-24 78,18 q18,30 -6,54 q-28,28 -64,8 q-36,-20 -34,-46 q2,-22 26,-34 Z"' +
      ' fill="' + PAL.skin + '" stroke="' + PAL.skinEdge + '" stroke-width="5" stroke-linejoin="round"/>' +
      // 엄지
      '<path d="M-34,-30 q-22,-16 -38,-2 q-14,14 4,26" fill="' + PAL.skin + '" stroke="' + PAL.skinEdge + '" stroke-width="5" stroke-linejoin="round"/>' +
      '</g>';
  };

  // 6. 수정 행동 — watch/intervene가 같은 그림을 쓰고 "수행 주체"만 다르다
  ART.S6 = {
    /* 시트 시작 위치와 투입구 — **화면 좌표**다. 포인터는 getScreenCTM 으로 뷰박스
     * 좌표로 바뀌므로 여기 값이 곧 참가자가 만지는 자리다.
     *
     * 예전에는 시트가 (270,1530) 왼쪽 아래 구석, 투입구가 (790,1180) 오른쪽이었고
     * 세탁기가 작아 **화면의 절반 이상이 빈 벽과 바닥**이었다. 개입 조건 참가자가
     * 실제로 조작하는 유일한 장면인데 정작 조작할 것들이 구석에 몰려 있었다.
     * 방·세탁기를 1.5배로 키워 앉히고(ART.s6) 두 자리를 화면 가운데로 끌어왔다.
     *
     * 끄는 거리는 627 → 675 로 8% 늘었다. 드롭 판정 반경(HIT)과 시트 크기는 그대로라
     * 조작 난이도 자체는 바뀌지 않는다. T_MANIP 을 예전 값과 직접 비교하지 말 것. */
    HOME: { x: 300, y: 1500 },
    DROP: { x: 600, y: 880 },
    /* 방·세탁기를 키우는 배율. 시트·투입구는 이 변환 밖에서 화면 좌표로 그린다 —
     * 안에 넣으면 포인터 좌표와 어긋나 드래그가 빗나간다. */
    ROOM_SCALE: 1.5,
    HIT: 190,
    IDLE_MS: 8000,
    WATCH_MS: WATCH_S6_MS   // watch 재생 길이 — 조정은 WATCH_S6_MS 한 곳에서
  };

  ART.s6 = function (o) {
    o = o || {};
    var S = ART.S6;
    /* 안내선은 두 자리 사이를 잇는다. 예전에는 휘는 지점이 숫자로 박혀 있어(Q560,1300)
     * 자리를 옮기면 선이 엉뚱한 데로 휘었다. 두 점에서 계산한다. */
    var qx = (S.HOME.x + S.DROP.x) / 2 - 40, qy = (S.HOME.y + S.DROP.y) / 2 + 60;
    var guide = '<path class="s6-guide" d="M' + (S.HOME.x + 90) + ',' + (S.HOME.y - 70) +
      ' Q' + qx.toFixed(0) + ',' + qy.toFixed(0) + ' ' + (S.DROP.x - 130) + ',' + (S.DROP.y + 40) + '"' +
      ' fill="none" stroke="' + PAL.brand + '" stroke-width="10" stroke-dasharray="22 22" stroke-linecap="round" opacity=".45"/>';
    var ring = '<g class="s6-ring">' +
      '<circle cx="' + S.DROP.x + '" cy="' + S.DROP.y + '" r="170" fill="' + PAL.brand + '" opacity=".12"/>' +
      '<circle cx="' + S.DROP.x + '" cy="' + S.DROP.y + '" r="150" fill="none" stroke="' + PAL.brand +
      '" stroke-width="10" stroke-dasharray="28 24" stroke-linecap="round"/>' +
      '</g>';
    var sheet = '<g class="s6-sheet" style="transform:translate(' + S.HOME.x + 'px,' + S.HOME.y + 'px)">' +
      '<circle r="132" fill="#fff" fill-opacity="0"/>' +
      '<circle r="118" fill="' + PAL.brand + '" opacity=".14"/>' +
      '<ellipse cy="94" rx="100" ry="18" fill="' + PAL.ink + '" opacity=".16"/>' +
      ART.sheet(0, 0, 1.3) +
      '</g>';
    var hand = '<g class="s6-hand">' + ART.hand() + '</g>' +
      '<g class="s6-grip">' + ART.handGrip() + '</g>';
    /* 방과 세탁기만 키운다. 투입구(DROP)가 커진 세탁기의 문 자리에 오도록 옮긴다 —
     * 원본에서 문은 (790,1180) 이므로 그 점이 DROP 으로 가는 평행이동을 구한다. */
    var RS = S.ROOM_SCALE;
    /* 키운 방은 화면을 다 못 덮는다(옮긴 만큼 한쪽이 비어 벽지가 끊긴다).
     * 뒤에 벽 한 장을 깔아 둔다 — 이게 없으면 프레임 가장자리가 투명하게 남는다. */
    var room = '<rect x="0" y="0" width="1080" height="1920" fill="url(#g-wall)"/>' +
      '<g transform="translate(' + (S.DROP.x - RS * 790).toFixed(1) + ',' +
      (S.DROP.y - RS * 1180).toFixed(1) + ') scale(' + RS + ')">' +
      ART.room() + ART.washer({ both: true }) + '</g>';
    return room + ring + guide + sheet + hand;
  };

  // 7. 제품 작동 (설명용 시각화)
  ART.s7 = function (o) {
    o = o || {};
    var inner =
      ART.lightGarment({ x: 480, y: 760, s: 0.9 }) +
      ART.darkGarment({ x: 300, y: 900, s: 0.85 }) +
      ART.particles(anim('s7-absorb', o.still) || 'part-static', { toward: [540, 1210] }) +
      '<circle cx="540" cy="1210" r="140" fill="' + PAL.brand + '" opacity=".16" filter="url(#f-soft)"/>' +
      ART.sheet(540, 1210, 1.15, anim('s7-sheet', o.still));
    var label =
      '<g>' +
      '<rect x="60" y="150" width="440" height="90" rx="24" fill="' + PAL.ink + '" opacity=".78"/>' +
      '<circle cx="112" cy="195" r="17" fill="none" stroke="#fff" stroke-width="4"/>' +
      ART.text(112, 208, 26, 'i', { fill: '#fff', weight: 800 }) +
      ART.text(298, 210, 44, '기능 설명 화면', { fill: '#fff', weight: 700 }) +
      '</g>';
    return ART.drum(inner, { still: o.still }) + label;
  };

  // 8. 개선 결과 — 원래 색에 "가까운" 상태
  ART.s8 = function (o) {
    o = o || {};
    return ART.holdCloseup({ stained: false, still: o.still });
  };

  // 9. 결과 비교 — 제품 사용 여부 외 조건 동일(같은 함수 · 같은 인물 · 같은 구도)
  ART.s9 = function () {
    var TOP = 600, H = 850; // 비교 박스
    var half = function (side, stained, label) {
      var clipX = side === 'L' ? 0 : 540;
      // 배율 1:1 · 같은 함수 · stained 값만 다르다
      var m = ART.GARMENT_BODY[V.light.shape] || ART.GARMENT_BODY.shirt;
      var GS = 3.1;                                   // 반쪽 폭(540) 안에서 몸판이 약 53%
                                                      // (3.4 는 어깨가 비교 박스 윗변에 잘렸다)
      var gx = clipX + 270 - GS * m.cx;
      var gy = TOP + H / 2 - GS * m.cy;
      return '<clipPath id="s9-' + side + '"><rect x="' + clipX + '" y="' + TOP + '" width="540" height="' + H + '"/></clipPath>' +
        '<g clip-path="url(#s9-' + side + ')">' +
        '<rect x="' + clipX + '" y="' + TOP + '" width="540" height="' + H + '" fill="url(#g-wall)"/>' +
        '<rect x="' + clipX + '" y="1382" width="540" height="' + (TOP + H - 1382) + '" fill="url(#g-floor)"/>' +
        '<rect x="' + clipX + '" y="1374" width="540" height="26" fill="' + PAL.base + '"/>' +
        /* 옷만 크게 놓는다. 예전에는 인물 전신 두 명이 나란히 서 있었는데, 둘이
         * 같은 포즈·같은 색이라 **차이를 찾아야 보였다.** 전후 비교는 광고의 절정이고
         * 0.3초 안에 때려야 하는 자리다. 얼굴을 빼면 남는 차이가 얼룩 하나뿐이다 —
         * "제품 사용 여부 외 조건이 동일"(SPEC 7장 수용 기준)도 더 엄격하게 지켜진다. */
        ART.lightGarment({ x: gx, y: gy, s: GS, stained: stained }) +
        '</g>' +
        '<g>' +
        '<rect x="' + (clipX + 110) + '" y="' + (TOP - 92) + '" width="320" height="66" rx="33" fill="' +
        (stained ? PAL.mute : PAL.brand) + '" opacity="' + (stained ? '.22' : '.16') + '"/>' +
        ART.text(clipX + 270, TOP - 44, 44, label, { weight: 700, fill: stained ? PAL.ink : PAL.brandLo }) +
        '</g>';
    };
    return '<rect x="0" y="0" width="1080" height="1920" fill="url(#g-wall)"/>' +
      half('L', true, '시트 없이') +
      half('R', false, '시트와 함께') +
      '<path d="M540,' + TOP + ' V' + (TOP + H) + '" stroke="' + PAL.edge + '" stroke-width="6"/>' +
      '<rect x="0" y="' + TOP + '" width="1080" height="' + H + '" fill="none" stroke="' + PAL.edge + '" stroke-width="4" opacity=".7"/>';
  };

  // 10. 제품 메시지 + CTA
  ART.s10 = function (o) {
    o = o || {};
    return '<rect x="0" y="0" width="1080" height="1920" fill="url(#g-pack)"/>' +
      '<circle cx="540" cy="700" r="330" fill="#fff" opacity=".55"/>' +
      '<ellipse cx="540" cy="900" rx="300" ry="42" fill="' + PAL.ink + '" opacity=".12" filter="url(#f-soft)"/>' +
      '<g class="' + anim('s10-pack', o.still) + '">' +
      '<g transform="translate(540,740)">' +
      ART.sheet(170, 90, 0.95) +
      '<g transform="translate(-216,-230) scale(2.4)">' +
      '<rect x="0" y="0" width="180" height="140" rx="12" fill="' + PAL.box + '" stroke="' + PAL.boxEdge + '" stroke-width="5"/>' +
      '<rect x="0" y="0" width="180" height="46" rx="12" fill="' + PAL.brandPale + '"/>' +
      '<path d="M0,46 h180 v16 H0 Z" fill="' + PAL.brand + '"/>' +
      ART.text(90, 32, 24, BRAND, { fill: PAL.brandLo, weight: 800 }) +
      ART.text(90, 88, 19, '이염 방지', { fill: PAL.ink, opacity: '.85' }) +
      ART.text(90, 112, 19, '세탁 시트', { fill: PAL.ink, opacity: '.85' }) +
      '<path d="M126,120 q14,-12 26,0 t-6,16" fill="none" stroke="' + PAL.brand + '" stroke-width="5" stroke-linecap="round"/>' +
      '</g>' +
      '</g>' +
      '</g>' +
      '<g class="s10-name">' + ART.text(540, 1214, 76, BRAND, { weight: 800, fill: PAL.brandLo }) + '</g>' +
      /* 제품명을 빛이 한 번 스친다. 자르기(clip)는 바깥 그룹이 걸고 움직이는 것은 안쪽
       * 그룹이다 — 자른 영역과 움직이는 띠가 같은 그룹에 있으면 자르는 창까지 같이
       * 따라가서 띠가 영영 창 안에 머문다. 한 번만 돈다(무한 반복 아님). */
      '<g clip-path="url(#c-s10name)"><g class="s10-sheen">' +
      '<g transform="translate(540,1182)">' +
      '<rect x="-400" y="-62" width="120" height="124" fill="url(#g-sheen)" transform="skewX(-14)"/>' +
      '</g></g></g>' +
      '<rect class="s10-rule" x="384" y="1252" width="312" height="6" rx="3" fill="' + PAL.brand + '" opacity=".45"/>' +
      '<g class="s10-sub">' + ART.text(540, 1320, 44, '이염 방지 세탁 시트', { fill: PAL.mute }) + '</g>' +
      '<g class="s10-note">' + ART.text(540, 1600, 26, '* 세탁 조건에 따라 효과는 달라질 수 있습니다.', { fill: PAL.mute, weight: 500 }) + '</g>';
  };

  /* ----------------------------------------------------------
   * 2-3. 장면 6 상호작용 (SPEC 4장)
   *  - intervene: 포인터(터치·마우스) 드래그 → 투입구 드롭
   *  - watch    : 같은 경로를 인물의 손이 대신 수행, 입력 무시
   * ---------------------------------------------------------- */

  var Scene6 = {
    attach: function (el, ctx) {
      var S = ART.S6;
      var timers = [];
      var enteredAt = performance.now();     // 장면 6 진입 시점(조작 지연 계산 기준)
      function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }

      if (ctx.cfg.mode !== MODES.INTERVENE) {
        // watch: 광고 속 인물의 손이 같은 경로로 시트를 넣는다(참가자 입력 없음).
        // 재생 길이는 WATCH_S6_MS 하나가 결정한다 — CSS 애니메이션도 같은 값을 쓴다.
        el.__cleanup = function () {
          for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
          timers.length = 0;
        };
        el.classList.add('is-watch');
        el.style.setProperty('--s6-watch-dur', S.WATCH_MS + 'ms');
        /* 시연·힌트 애니메이션이 두 자리를 CSS 에서 받아 간다. 예전에는 키프레임에
         * 좌표가 박혀 있어서 ART.S6 를 고치면 손과 시트만 옛 자리로 날아갔다. */
        el.style.setProperty('--s6-home-x', S.HOME.x + 'px');
        el.style.setProperty('--s6-home-y', S.HOME.y + 'px');
        el.style.setProperty('--s6-drop-x', S.DROP.x + 'px');
        el.style.setProperty('--s6-drop-y', S.DROP.y + 'px');
        /* 시연에도 개입과 같은 신호를 같은 순서로 낸다 — 집는 소리, 투입되는 소리.
         * 수행 주체만 다르고 들리는 것은 같아야 한다. */
        Sfx.play('grab');
        later(function () {
          el.classList.add('is-closed');
          Sfx.play('beat');
        }, S.WATCH_MS * DOOR_CLOSE_AT);
        return;
      }

      var svg = el.querySelector('svg');
      var sheet = el.querySelector('.s6-sheet');
      var pos = { x: S.HOME.x, y: S.HOME.y };
      var grab = { x: 0, y: 0 };
      var dragging = false, done = false, idle = null;
      var firstDownAt = 0;   // 첫 pointerdown (performance.now)

      /* 조작 시간 집계 — 성공하면 성공 시점까지, 미완료로 장면을 떠나면 그때까지 */
      function commitManip(at) {
        if (!firstDownAt) return;
        ctx.log.T_MANIP = round2((at - firstDownAt) / 1000);
      }
      el.__cleanup = function () {
        for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
        timers.length = 0;
        if (!done) commitManip(performance.now());
      };

      function place(x, y, extra) {
        sheet.style.transform = 'translate(' + x + 'px,' + y + 'px)' + (extra || '');
      }
      /* 화면 좌표 → SVG 사용자 좌표(1080x1920) */
      function toUser(ev) {
        try {
          var m = svg.getScreenCTM && svg.getScreenCTM();
          if (m && svg.createSVGPoint) {
            var p = svg.createSVGPoint();
            p.x = ev.clientX; p.y = ev.clientY;
            return p.matrixTransform(m.inverse());
          }
        } catch (e) { /* 아래 폴백 */ }
        var r = svg.getBoundingClientRect();
        if (!r.width || !r.height) return { x: pos.x, y: pos.y };
        return {
          x: (ev.clientX - r.left) * 1080 / r.width,
          y: (ev.clientY - r.top) * 1920 / r.height
        };
      }

      /* 무조작 8초 → 힌트(손가락이 경로를 시연). 정답을 대신 수행하지 않는다 */
      function armIdle() { clearTimeout(idle); idle = later(showHint, S.IDLE_MS); }
      function showHint() {
        if (done || el.classList.contains('hint-on')) return;
        el.classList.add('hint-on');
        ctx.log.HINT_SHOWN++;              // 노출(활성화) 1회당 1
      }
      function hideHint() { el.classList.remove('hint-on'); }

      function down(ev) {
        if (done) return;
        ev.preventDefault();
        dragging = true;
        if (!firstDownAt) {                  // 드래그 시작까지 걸린 시간(초)
          firstDownAt = performance.now();
          ctx.log.T_FIRST_DRAG = round2((firstDownAt - enteredAt) / 1000);
          Sfx.play('grab');                  // 첫 조작 — 게임 자극의 첫 조작음과 같은 자리다
        }
        var u = toUser(ev);
        grab.x = u.x - pos.x;
        grab.y = u.y - pos.y;
        sheet.style.transition = 'none';
        sheet.classList.add('is-dragging');
        hideHint();
        clearTimeout(idle);
        try { sheet.setPointerCapture(ev.pointerId); } catch (e) { /* noop */ }
      }
      function move(ev) {
        if (!dragging) return;
        ev.preventDefault();
        var u = toUser(ev);
        pos.x = u.x - grab.x;
        pos.y = u.y - grab.y;
        place(pos.x, pos.y, ' scale(1.06)');
      }
      function up(ev) {
        if (!dragging) return;
        dragging = false;
        sheet.classList.remove('is-dragging');
        try { sheet.releasePointerCapture(ev.pointerId); } catch (e) { /* noop */ }
        var dx = pos.x - S.DROP.x, dy = pos.y - S.DROP.y;
        if (Math.sqrt(dx * dx + dy * dy) <= S.HIT) succeed();
        else snapBack();
      }

      /* 오답: 비난 문구 없이 원위치로 스냅백 */
      function snapBack() {
        ctx.log.INT_ATTEMPTS++;
        Sfx.play('miss');                    // 비난 문구가 없으니 소리도 나무라지 않는 짧은 신호다
        pos.x = S.HOME.x; pos.y = S.HOME.y;
        sheet.style.transition = 'transform 340ms cubic-bezier(.2,.9,.3,1.1)';
        place(pos.x, pos.y);
        armIdle();
      }

      /* 성공: 시트 투입 → 문 닫힘 → 장면 7 자동 진행 */
      function succeed() {
        done = true;
        hideHint();
        clearTimeout(idle);
        commitManip(performance.now());
        ctx.log.INT_DONE = 1;
        el.classList.add('is-dropped');
        sheet.style.transition = 'transform 420ms cubic-bezier(.4,0,.2,1), opacity 260ms 200ms linear';
        place(S.DROP.x, S.DROP.y, ' scale(.22)');
        sheet.style.opacity = '0';
        later(function () {
          el.classList.add('is-closed');
          Sfx.play('beat');                  // 투입 완료 — 성공음(success)은 개선 결과 장면 몫이다
        }, 440);
        later(function () { ctx.engine.next(); }, 1150);
      }

      sheet.addEventListener('pointerdown', down);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      armIdle();

      // 심사·리허설용: 콘솔에서 성공 판정을 강제할 수 있게 노출
      el.__drop = succeed;
    }
  };

  var SCENES = [
    {
      no: 1,
      title: '목표',
      dur: DUR[1],
      subtitle: function () {
        return '내일 ' + V.light.use + ' ' + V.light.name + ', 오늘 같이 빨래하기';
      },
      render: function () { return ART.svg(ART.s1({ still: CFG.still !== null }), 'sc1'); }
    },
    {
      no: 2,
      title: '제품 미사용',
      dur: DUR[2],
      sfx: 'beat',
      subtitle: function () { return '그대로 세탁 시작'; },
      render: function () { return ART.svg(ART.s2({ still: CFG.still !== null }), 'sc2'); }
    },
    {
      no: 3,
      title: '실패 진행',
      dur: DUR[3],
      sfx: 'bad',
      subtitle: function () { return '세탁 중…'; },
      render: function () { return ART.svg(ART.s3({ still: CFG.still !== null }), 'sc3'); }
    },
    {
      no: 4,
      title: '실패 결과',
      dur: DUR[4],
      sfx: 'fail',
      subtitle: function () { return V.light.name + ' 색이 변해 버렸다'; },
      render: function () { return ART.svg(ART.s4({ still: CFG.still !== null }), 'sc4'); }
    },
    {
      no: 5,
      title: '되감기',
      /* 되감기는 저절로 시작하지 않는다 — 참가자가 [되돌리기]를 눌러야 한다.
       * 그래서 이 장면은 길이가 정해져 있지 않다(누르기까지 대기 + 누른 뒤 6초).
       *
       * 예전에는 6초 뒤 광고가 알아서 되감았다. 그러면 되돌리는 주체가 광고이고
       * 참가자는 구경꾼이다. 실패-수정형 광고에서 재려는 것이 "내가 고쳤다"는
       * 경험이므로, 고치기로 하는 첫 결정도 참가자가 내려야 한다.
       * 게임 자극도 같은 자리에 같은 버튼이 있다(INTEGRATION.md §11). */
      dur: null,
      /* 되감기음은 장면 진입이 아니라 **버튼을 누른 순간** 울린다 — 아래 start() 참고 */
      sfx: null,
      subtitle: function () { return '세탁을 시작하기 전에, 이 제품을 사용했다면?'; },
      render: function (ctx) {
        var el = ART.svg(ART.s5({ still: CFG.still !== null }), 'sc5',
          '<div class="rewind-prompt">' +
          '<p class="rw-msg">지금 이 세탁을 되돌린다면?</p>' +
          '<button type="button" class="rewind-btn">되돌리기</button>' +
          '</div>');
        // 스토리보드 캡처(?still=5)는 대기 없이 되감기 화면 그대로를 보여 준다
        if (CFG.still !== null) return el;

        el.classList.add('is-hold');     // 되감기 애니메이션을 첫 프레임에 세워 둔다
        var shownAt = performance.now();
        var started = false;
        var timer = null;

        function start() {
          if (started) return;           // 두 번 눌러도 한 번만 먹는다
          started = true;
          ctx.log.T_REWIND = round2((performance.now() - shownAt) / 1000);
          el.classList.remove('is-hold');
          el.classList.add('is-rewinding');
          Sfx.play('rewind');            // 게임 자극의 되감기와 같은 자리다
          timer = setTimeout(function () { ctx.engine.next(); }, 6000);
        }

        el.querySelector('.rewind-btn').addEventListener('click', start);
        el.__cleanup = function () { if (timer) clearTimeout(timer); };
        return el;
      }
    },
    {
      no: 6,
      title: '수정 행동',
      // watch: WATCH_S6_MS 고정 / intervene: 가변(드롭 성공 시 진행)
      get dur() {
        return CFG.mode === MODES.INTERVENE ? null : ART.S6.WATCH_MS / 1000;
      },
      // 자막도 같은 어간을 공유하고 "수행 주체"를 나타내는 끝맺음만 다르다
      subtitle: function () {
        /* "넣어 주세요"는 눌러서 넣으라는 말로도 읽힌다. 실제 조작은 드래그 하나뿐이므로
         * 동작을 그대로 말한다 — 조작을 몰라 못 하는 것은 조건이 아니라 잡음이다. */
        return '시트를 세탁기 안으로 끌어다 ' +
          (CFG.mode === MODES.INTERVENE ? '놓아 주세요' : '놓기만 하면');
      },
      render: function (ctx) {
        var el = ART.svg(ART.s6({ still: CFG.still !== null }), 'sc6');
        if (CFG.still === null) Scene6.attach(el, ctx);
        /* 정지 화면에서도 watch 는 조작 UI 가 꺼져 있어야 한다. attach 가 재생에서만
         * 돌기 때문에 여태 ?still=6 스토리보드에는 intervene 전용 UI 가 그대로 찍혔다.
         * 표시를 끄는 CSS 는 이미 있었고, 그걸 켜 줄 클래스만 없었다. */
        else if (CFG.mode !== MODES.INTERVENE) el.classList.add('is-watch');
        return el;
      }
    },
    {
      no: 7,
      title: '제품 작동',
      dur: DUR[7],
      sfx: 'beat',
      subtitle: function () { return '떠다니는 염료를 시트가 붙잡아요'; },
      render: function () { return ART.svg(ART.s7({ still: CFG.still !== null }), 'sc7'); }
    },
    {
      no: 8,
      title: '개선 결과',
      dur: DUR[8],
      sfx: 'success',
      subtitle: function () { return '색은 그대로'; },
      render: function () { return ART.svg(ART.s8({ still: CFG.still !== null }), 'sc8'); }
    },
    {
      no: 9,
      title: '결과 비교',
      dur: DUR[9],
      sfx: 'beat',
      subtitle: function () { return '시트 하나의 차이'; },
      render: function () { return ART.svg(ART.s9(), 'sc9'); }
    },
    {
      no: 10,
      title: '제품 메시지 + CTA',
      dur: DUR[10],
      sfx: 'card',
      subtitle: function () { return '세탁 중 이염을 줄여 밝은 옷을 보호하세요'; },
      render: function (ctx) {
        /* 나가는 길이 [지금 구매하기] 하나뿐이면 그 클릭이 "사고 싶다"가 아니라
         * "나가려면 이것밖에 없다"가 된다. CTA_CLICK 이 종속변인이라 이건
         * 측정 문제다 — 실제 광고처럼 오른쪽 위에 닫기를 둔다.
         * 게임 자극의 제품 카드에도 같은 버튼이 있다(INTEGRATION.md §5-13). */
        var el = ART.svg(
          ART.s10({ still: CFG.still !== null }), 'sc10',
          '<button type="button" class="ad-close" aria-label="광고 닫기">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
          '<path d="M7 7 L17 17 M17 7 L7 17"/></svg>' +
          '</button>' +
          '<button type="button" class="cta">지금 구매하기</button>'
        );
        if (CFG.still !== null) return el;

        var shownAt = performance.now();
        var done = false;

        /** 두 버튼이 공유하는 마무리 — 어느 쪽을 눌렀는지만 다르다 */
        function end(which, node) {
          if (done) return;
          done = true;
          var clickedAt = Date.now();
          node.disabled = true;              // 모의 광고 — 외부 이동 없음
          node.classList.add('is-pressed');
          ctx.log.T_CARD = round2((performance.now() - shownAt) / 1000);
          ctx.log[which] = 1;
          /* 종료(=로그 스냅숏) 전에 울려야 SFX_COUNT 에 이 클릭이 포함된다. */
          Sfx.play(which === 'CTA_CLICK' ? 'cta' : 'beat');
          ctx.engine.finish({ endAt: clickedAt });   // DWELL_TOTAL은 클릭 시점까지
        }

        var btn = el.querySelector('.cta');
        /* 이 클릭음은 게임 자극과 음색까지 같다 — sfx.js 의 CTA_VOICE. */
        btn.addEventListener('click', function () { end('CTA_CLICK', btn); });

        /* 닫기는 가장 작은 신호(beat)로 받는다. 소리를 안 내면 CTA 만 청각 보상을
         * 갖게 되어 그 자체가 CTA 쪽으로 미는 힘이 된다. 보상이 아니라 눌렸다는
         * 확인이라 큐 목록에 새 신호를 만들지 않고 가장 작은 것을 쓴다. */
        var close = el.querySelector('.ad-close');
        close.addEventListener('click', function () { end('CLOSE_CLICK', close); });
        return el;
      }
    }
  ];

  /* ----------------------------------------------------------
   * 2-4. 조건별 재생 목록
   *
   *  watch     — 실패까지만 보여주고 제품 메시지로 끝난다. 되감기(5)와
   *              수정·개선 흐름(6~9)이 없다.
   *  intervene — 실패 → 되감기 → 참가자 개입 → 개선까지 전부 재생한다.
   *
   *  장면 "정의"는 위 SCENES 하나뿐이다. 여기서는 어떤 장면을 재생할지만
   *  고른다 — 그래서 두 조건이 공유하는 장면(1·2·3·4·10)은 여전히 같은
   *  렌더 함수·같은 자막·같은 길이를 쓴다(조건별 장면을 따로 만들지 않는다).
   * ---------------------------------------------------------- */

  var PLAYLIST = {
    watch: [1, 2, 3, 4, 10],
    intervene: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  };

  function playlistFor(mode) {
    return (PLAYLIST[mode] || PLAYLIST[MODES.WATCH]).map(function (no) {
      return SCENES.filter(function (s) { return s.no === no; })[0];
    });
  }

  /* ==========================================================
   * 3. 로그 — 행동 로그 시트 스키마와 1:1 (SPEC 5장)
   * ========================================================== */

  var STORE_KEY = 'ad_log_' + CFG.sid;

  var LOG = {
    sid: CFG.sid,
    mode: CFG.mode,
    ver: CFG.ver,
    t_start: 0,                                    // epoch ms, 장면 1 시작
    t_end: 0,                                      // epoch ms, 종료(0 = 미완료)
    DWELL_TOTAL: 0,                                // 초
    // 장면 6 체류(초). watch는 그 장면 자체가 없으므로 공란 의미로 null
    DWELL_INT: CFG.mode === MODES.INTERVENE ? 0 : null,
    INT_DONE: CFG.mode === MODES.INTERVENE ? 0 : null, // watch는 공란 의미로 null
    INT_ATTEMPTS: 0,                               // 목표 밖 드롭(스냅백) 횟수
    T_FIRST_DRAG: null,                            // 초, 장면 6 진입~첫 드래그 시작. watch/미조작은 null
    T_MANIP: null,                                 // 초, 첫 드래그~성공(미완료면 장면 이탈까지). watch는 null
    /* 초, 장면 5에서 [되돌리기]가 뜬 뒤 실제로 누르기까지.
     * 예전에는 광고가 알아서 되감았다. 참가자가 누르게 바꾸면서 생긴 값이고,
     * 개입 조건의 재생 길이가 참가자마다 달라지는 원인이기도 하다.
     * watch에는 장면 5가 없으므로 null. 게임 자극도 같은 이름으로 기록한다. */
    T_REWIND: null,
    HINT_SHOWN: 0,                                 // 힌트 노출 횟수
    CTA_CLICK: 0,
    /* 오른쪽 위 [×]. CTA 와 짝이 되는 행동이다 — 나가는 길이 구매뿐이면 CTA_CLICK 이
     * "사고 싶다"가 아니라 "나가려면 이것밖에 없다"를 재게 된다. 둘 다 0 이면
     * 8초가 지나 저절로 끝난 것이다. 게임 자극도 같은 이름으로 기록한다. */
    CLOSE_CLICK: 0,
    /* 초, 제품 메시지 화면이 뜬 뒤 누르기까지. 안 누르고 끝나면 null.
     * 바로 닫은 것과 8초를 다 보고 닫은 것은 다른 행동이다. */
    T_CARD: null,
    REDUCED_MOTION: readsReducedMotion(),          // OS 동작 줄이기 설정. 자극에는 영향 없음(기록 전용)
    /* 소리가 실제로 났는지 1/0, 해당 없음(sound=0·장치 없음)이면 null.
     * 자동재생 정책에 막히면 그 참가자만 무음으로 본 것이라, 이 값을 안 남기면
     * 분석에서 소리를 통제했다고 말할 수 없다. 게임 자극도 같은 이름으로 기록한다. */
    AUDIO_OK: null,
    SFX_COUNT: 0,                                  // 낸 신호 수(들렸는지와 무관) — 자극 간 청각 밀도 비교용
    /* 나래이션이 실제로 들렸는지 1/0, 해당 없음이면 null. AUDIO_OK 와 따로 두는 이유:
     * 재생 경로가 달라서(전용 AudioContext) 한쪽만 막힐 수 있다. 게임 자극에는
     * 나래이션이 없으므로 이 두 필드는 세탁 쪽에만 있다. */
    VOICE_OK: null,
    VOICE_SPOKEN: 0,                               // 읽기를 요청한 문장 수(들렸는지와 무관)
    scene_times: {},                               // 장면별 체류(초)
    scene_enter: {}                                // 장면별 최초 진입 시각(epoch ms)
  };
  window.AD_RESULT = LOG;

  function round2(n) { return Math.round(n * 100) / 100; }

  var Log = {
    storeOk: null,     // localStorage 저장 성공 여부 (file:// 등에서 실패할 수 있음)
    storeError: '',

    /** 스키마 순서를 고정한 사본 */
    snapshot: function () {
      var byNo = function (src) {
        var out = {};
        Object.keys(src).sort(function (a, b) { return a - b; })
          .forEach(function (k) { out[k] = src[k]; });
        return out;
      };
      var st = byNo(LOG.scene_times);
      return {
        sid: LOG.sid,
        mode: LOG.mode,
        ver: LOG.ver,
        t_start: LOG.t_start,
        t_end: LOG.t_end,
        DWELL_TOTAL: LOG.DWELL_TOTAL,
        DWELL_INT: LOG.DWELL_INT,
        INT_DONE: LOG.INT_DONE,
        INT_ATTEMPTS: LOG.INT_ATTEMPTS,
        T_FIRST_DRAG: LOG.T_FIRST_DRAG,
        T_MANIP: LOG.T_MANIP,
        T_REWIND: LOG.T_REWIND,
        HINT_SHOWN: LOG.HINT_SHOWN,
        CTA_CLICK: LOG.CTA_CLICK,
        CLOSE_CLICK: LOG.CLOSE_CLICK,
        T_CARD: LOG.T_CARD,
        REDUCED_MOTION: LOG.REDUCED_MOTION,
        // 스냅숏을 뜨는 시점의 실제 상태를 읽는다 — 재생 도중 잠금이 풀릴 수 있다
        AUDIO_OK: Sfx.audioOk(),
        SFX_COUNT: Sfx.fired,
        VOICE_OK: Voice.voiceOk(),
        VOICE_SPOKEN: Voice.spoken,
        scene_times: st,
        scene_enter: byNo(LOG.scene_enter)
      };
    },

    /** localStorage 저장 (+ window.AD_RESULT_JSON) */
    persist: function () {
      var payload = Log.snapshot();
      var json = JSON.stringify(payload);
      window.AD_RESULT_JSON = json;
      try {
        window.localStorage.setItem(STORE_KEY, json);
        Log.storeOk = true;
      } catch (e) {
        Log.storeOk = false;
        Log.storeError = (e && e.message) ? e.message : String(e);
      }
      return payload;
    },

    /** 종료 통지 — postMessage + localStorage 둘 다 */
    done: function () {
      var payload = Log.persist();
      try {
        window.parent.postMessage({ type: 'AD_DONE', payload: payload }, '*');
      } catch (e) { /* 부모 프레임이 없거나 접근 불가 — 로컬 저장은 이미 완료 */ }
      return payload;
    }
  };

  window.AD_LOG = Log; // 심사·리허설용

  /* ==========================================================
   * 4. 엔진
   * ========================================================== */

  var dom = {};

  var Engine = {
    idx: -1,
    playing: false,
    finished: false,
    timer: null,
    sceneEnteredAt: 0,   // performance.now()
    remaining: 0,        // 일시정지 시 남은 시간(ms)
    current: null,       // 현재 장면 DOM

    // 현재 조건의 재생 목록. boot()에서 채운다(?still은 전 장면 접근을 허용)
    list: [],

    get scene() { return this.list[this.idx] || null; },

    /** 장면 번호로 이동 — 조건마다 목록이 다르므로 인덱스 대신 번호로 찾는다 */
    gotoNo: function (no) {
      for (var i = 0; i < this.list.length; i++) {
        if (this.list[i].no === no) { this.goto(i); return true; }
      }
      return false;   // 이 조건에는 없는 장면
    },

    /* 자동재생이 막혀 있으면 **광고를 아직 시작하지 않는다.**
     *
     * 왜 필요한가
     *   소리가 막힌 채로 재생이 굴러가면 그 사이 장면의 나래이션은 영영 못 듣는다.
     *   voice.js 의 재시도는 잠금이 풀린 "그 순간의 장면"만 되살리므로 지나간
     *   문장은 잃는다. 길이를 나래이션에 맞춰 줄인 뒤로는(INTEGRATION §5-14)
     *   watch 가 10.8초라 **화면을 한 번 누르는 사이에 광고의 절반이 지나간다.**
     *
     * 기다리는 방식이 두 가지인 이유
     *   러너 안(iframe)에서는 **상한을 둔다.** 시청 조건 참가자는 광고가 끝날
     *   때까지 화면을 한 번도 안 건드릴 수 있어서, 무한정 기다리면 그 참가자에게는
     *   광고가 아예 시작되지 않는다. 러너는 참가자가 버튼을 누른 제스처를 들고
     *   AD_UNLOCK 을 보내므로 실제 실험 경로에서는 이 대기가 거의 0 이다.
     *
     *   단독으로 열렸을 때(심사·리허설용 직접 주소)는 **제스처를 기다린다.**
     *   참가자가 아니라 사람이 확인하는 경로라 안 시작하고 기다리는 편이 낫다 —
     *   여기서 그냥 시작해 버리면 확인하는 사람이 나래이션을 못 듣는다.
     *
     * 소리가 꺼져 있거나(sound=0) 장치가 아예 없으면 기다리지 않는다. */
    IN_RUNNER: (function () { try { return window.parent !== window; } catch (e) { return true; } })(),
    AUDIO_WAIT_MS: 2500,

    waitForAudio: function (go) {
      if (Voice.state() !== 'blocked') return false;   // off · none · on 이면 그냥 간다
      var self = this;
      var startedAt = Date.now();
      var tick = function () {
        Voice.unlock();
        Sfx.unlock && Sfx.unlock();
        if (Voice.state() !== 'blocked') { go(); return; }
        if (self.IN_RUNNER && Date.now() - startedAt >= self.AUDIO_WAIT_MS) { go(); return; }
        self.audioTimer = setTimeout(tick, 100);
      };
      this.audioTimer = setTimeout(tick, 60);
      return true;
    },

    start: function () {
      var self = this;
      if (!this.audioReady) {
        if (this.waitForAudio(function () { self.audioReady = true; self.start(); })) return;
        this.audioReady = true;
      }
      LOG.t_start = Date.now();
      this.playing = true;
      Sfx.play('start');
      /* 배경음 — 잠금이 아직 안 풀렸으면 풀리는 순간 알아서 켜진다.
       * ?still=N 정지 화면은 재생이 아니므로 여기 안 온다. */
      Sfx.startBed();
      this.goto(0);
    },

    /** 장면 인덱스로 이동 */
    goto: function (idx) {
      if (idx < 0 || idx >= this.list.length) return;
      this.clearTimer();
      this.commitDwell();

      this.idx = idx;
      var scene = this.list[idx];
      // 장면별 진입 시각 — 최초 진입만 남긴다(디버그 점프로 되돌아와도 덮어쓰지 않음)
      if (LOG.scene_enter[scene.no] === undefined) LOG.scene_enter[scene.no] = Date.now();

      // 렌더 & 교차 전환
      var prev = this.current;
      if (prev && typeof prev.__cleanup === 'function') prev.__cleanup(); // 장면 타이머 정리
      var el = scene.render({ cfg: CFG, ver: V, brand: BRAND, engine: Engine, log: LOG });
      el.classList.add('scene');
      el.dataset.scene = String(scene.no);
      /* 장면 안의 애니메이션(카메라 밀기·인물·드럼…)은 장면 길이에 맞춰 짜여 있다.
       * 길이를 나래이션에 맞춰 줄였으므로 애니메이션도 같이 줄어야 중간에 잘리지
       * 않는다. CSS 는 이 값을 var(--scene-dur) 로 받는다 — 장면 6 이 예전부터
       * 쓰던 --s6-watch-dur 와 같은 방식이다. */
      if (scene.dur) el.style.setProperty('--scene-dur', Math.round(scene.dur * 1000) + 'ms');
      dom.layer.appendChild(el);
      // 강제 리플로우 후 페이드 인
      void el.offsetWidth;
      el.classList.add('is-in');
      if (prev) {
        prev.classList.remove('is-in');
        prev.classList.add('is-out');
        var dead = prev;
        setTimeout(function () { if (dead.parentNode) dead.parentNode.removeChild(dead); }, 500);
      }
      this.current = el;

      this.setSubtitle(scene.subtitle());

      /* 장면 진입음. 정지 화면(?still)에서는 울리지 않는다 — 스토리보드 캡처용이라
       * 참가자가 보는 재생이 아니다. 장면 1 은 start 가 이미 울렸으므로 비워 둔다. */
      if (CFG.still === null && scene.sfx) Sfx.play(scene.sfx);

      /* 자막을 목소리로도 읽는다. 정지 화면(?still)에서는 읽지 않는다 —
       * 스토리보드 캡처는 참가자가 보는 재생이 아니다.
       * 앞 장면 문장이 아직 울리고 있으면 say() 안에서 끊는다. */
      if (CFG.still === null) Voice.say(voiceKey(scene.no));

      /* 자동재생이 막혀 있어 이 문장을 못 읽었더라도, 참가자가 화면을 누르는 순간
       * 소리가 열리면서 **그때 떠 있는 장면의 문장**을 다시 읽는다. 지나간 문장을
       * 몰아 읽지는 않는다. */
      if (Voice.onOpened !== undefined) {
        var self2 = this;
        Voice.onOpened = function () {
          return self2.scene ? voiceKey(self2.scene.no) : null;
        };
      }

      this.sceneEnteredAt = performance.now();
      this.remaining = scene.dur === null ? Infinity : scene.dur * 1000;
      if (this.playing && CFG.still === null) this.arm(this.remaining);

      Debug.sync();
    },

    /** 남은 시간만큼 타이머를 건다 */
    arm: function (ms) {
      if (!isFinite(ms)) return;         // 상호작용 대기 장면
      var self = this;
      this.timerStartedAt = performance.now();
      this.timer = setTimeout(function () { self.next(); }, Math.max(0, ms));
    },

    clearTimer: function () {
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    },

    /** 현재 장면 체류시간을 로그에 누적 */
    commitDwell: function () {
      if (this.idx < 0) return;
      var scene = this.list[this.idx];
      var elapsed = (performance.now() - this.sceneEnteredAt) / 1000;
      var key = String(scene.no);
      LOG.scene_times[key] = round2((LOG.scene_times[key] || 0) + elapsed);
      // 장면 6 체류 — watch는 고정 재생 길이, intervene은 실제 체류
      if (scene.no === 6) {
        LOG.DWELL_INT = CFG.mode === MODES.INTERVENE ? LOG.scene_times[key] : scene.dur;
      }
      if (LOG.t_start && !LOG.t_end) LOG.DWELL_TOTAL = round2((Date.now() - LOG.t_start) / 1000);
    },

    next: function () {
      if (this.idx >= this.list.length - 1) { this.finish(); return; }
      this.goto(this.idx + 1);
    },

    prev: function () {
      if (this.idx > 0) this.goto(this.idx - 1);
    },

    pause: function () {
      if (!this.playing) return;
      this.playing = false;
      if (this.timer) {
        var used = performance.now() - this.timerStartedAt;
        this.remaining = Math.max(0, this.remaining - used);
        this.clearTimer();
      }
      Debug.sync();
    },

    resume: function () {
      if (this.playing) return;
      this.playing = true;
      if (CFG.still === null) this.arm(this.remaining);
      Debug.sync();
    },

    toggle: function () { this.playing ? this.pause() : this.resume(); },

    /** 디버그 재시작 — 로그도 초기 상태로 되돌린다 */
    restart: function () {
      this.clearTimer();
      if (this.current && typeof this.current.__cleanup === 'function') this.current.__cleanup();
      this.finished = false;
      this.idx = -1;
      LOG.scene_times = {};
      LOG.scene_enter = {};
      LOG.t_end = 0;
      LOG.DWELL_TOTAL = 0;
      LOG.DWELL_INT = 0;
      LOG.INT_DONE = CFG.mode === MODES.INTERVENE ? 0 : null;
      LOG.INT_ATTEMPTS = 0;
      LOG.T_FIRST_DRAG = null;
      LOG.T_MANIP = null;
      LOG.T_REWIND = null;
      LOG.HINT_SHOWN = 0;
      LOG.CTA_CLICK = 0;
      delete document.documentElement.dataset.state;
      this.playing = true;
      this.start();
    },

    setSubtitle: function (text) {
      var t = dom.subtitle;
      t.classList.remove('is-in');
      // 다음 프레임에 새 문구를 넣어 페이드가 다시 돌게 한다
      requestAnimationFrame(function () {
        t.textContent = text || '';
        requestAnimationFrame(function () { if (text) t.classList.add('is-in'); });
      });
    },

    /**
     * 종료 — 장면 10 자동 종료(8초) 또는 CTA 클릭.
     * o.endAt: 종료 시각(ms). CTA는 "클릭 시점"을 넘긴다.
     */
    finish: function (o) {
      o = o || {};
      if (this.finished) return;
      this.clearTimer();
      if (this.current && typeof this.current.__cleanup === 'function') this.current.__cleanup();
      this.commitDwell();
      this.finished = true;
      this.playing = false;
      LOG.t_end = o.endAt || Date.now();
      LOG.DWELL_TOTAL = round2((LOG.t_end - LOG.t_start) / 1000);
      Sfx.stopBed();   // 잦아들며 꺼진다 — 아래 로그 마감은 이걸 기다리지 않는다
      Voice.stop();    // 마지막 문장이 종료 화면까지 넘어가지 않게 끊는다
      document.documentElement.dataset.state = 'ended';
      Log.done();
      Debug.sync();
    },

    /** ?still=N 정지 화면 */
    renderStill: function (no) {
      // 스토리보드 캡처는 조건과 무관하게 전 장면에 접근한다
      this.list = SCENES;
      var idx = SCENES.findIndex(function (s) { return s.no === no; });
      if (idx < 0) idx = 0;
      this.playing = false;
      this.goto(idx);
    }
  };

  window.AD_ENGINE = Engine; // 디버그/외부 제어용
  window.AD_ART = ART;       // 스토리보드 추출·검증용

  /* ==========================================================
   * 5. 디버그 패널 (?debug=1)
   * ========================================================== */

  var Debug = {
    on: false,
    el: null,

    init: function () {
      if (!CFG.debug) return;
      this.on = true;
      this.el = document.getElementById('debug');
      this.el.hidden = false;
      this.status = document.getElementById('dbg-status');
      this.store = document.getElementById('dbg-store');
      this.logEl = document.getElementById('dbg-log');

      // 장면 점프 버튼
      var jump = document.getElementById('dbg-jump');
      Engine.list.forEach(function (s, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = s.no;
        b.title = s.title;
        b.dataset.jump = String(i);
        jump.appendChild(b);
      });

      var self = this;
      this.el.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.jump !== undefined) {
          Engine.finished = false;
          Engine.goto(parseInt(b.dataset.jump, 10));
        } else if (b.dataset.act) {
          self.act(b.dataset.act);
        } else if (b.dataset.set) {
          var url = new URL(location.href);
          url.searchParams.set(b.dataset.set, b.dataset.val);
          url.searchParams.set('debug', '1');
          url.searchParams.set('sid', CFG.sid);
          location.href = url.toString();
        } else if (b.id === 'dbg-collapse') {
          self.el.classList.toggle('collapsed');
        }
      });

      // 키보드 단축키: ← → 장면 이동, space 재생/정지
      document.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') Engine.next();
        else if (e.key === 'ArrowLeft') Engine.prev();
        else if (e.code === 'Space') { e.preventDefault(); Engine.toggle(); }
      });

      // 활성 mode/ver 표시
      Array.prototype.forEach.call(this.el.querySelectorAll('[data-set]'), function (b) {
        if (CFG[b.dataset.set] === b.dataset.val) b.classList.add('active');
      });

      setInterval(function () { self.sync(); }, 250);
      this.sync();
    },

    act: function (a) {
      if (a === 'next') { Engine.finished = false; Engine.next(); }
      else if (a === 'prev') { Engine.finished = false; Engine.prev(); }
      else if (a === 'playpause') Engine.toggle();
      else if (a === 'restart') Engine.restart();
      else if (a === 'finish') Engine.finish();
      else if (a === 'copy') this.copy();
    },

    copy: function () {
      var json = JSON.stringify(Log.snapshot(), null, 1);
      var btn = this.el.querySelector('[data-act="copy"]');
      var flash = function (msg) {
        btn.textContent = msg;
        setTimeout(function () { btn.textContent = 'JSON 복사'; }, 1200);
      };
      var fallback = function () {
        var ta = document.createElement('textarea');
        ta.value = json;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        document.body.removeChild(ta);
        flash(ok ? '복사됨' : '복사 실패');
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json).then(function () { flash('복사됨'); }, fallback);
      } else {
        fallback();
      }
    },

    sync: function () {
      if (!this.on || !this.el) return;
      var s = Engine.scene;
      var pp = this.el.querySelector('[data-act="playpause"]');
      if (pp) pp.textContent = Engine.playing ? '⏸ 정지' : '▶ 재생';

      var elapsed = Engine.idx >= 0 ? (performance.now() - Engine.sceneEnteredAt) / 1000 : 0;
      this.status.textContent =
        // 조건명은 debug 패널에만 노출된다 (참가자 화면에는 어디에도 표시하지 않는다)
        CFG.mode + '/' + CFG.ver +
        ' · 장면 ' + (s ? s.no + ' ' + s.title : '-') +
        ' · ' + elapsed.toFixed(1) + 's' +
        (s && s.dur !== null ? ' / ' + s.dur + 's' : ' / 가변') +
        (Engine.finished ? ' · 종료' : '');

      Array.prototype.forEach.call(this.el.querySelectorAll('[data-jump]'), function (b) {
        b.classList.toggle('active', parseInt(b.dataset.jump, 10) === Engine.idx);
      });

      // 저장 상태
      this.store.textContent = 'key: ' + STORE_KEY + ' · ' +
        (Log.storeOk === null ? '저장 전(종료 시 기록)'
          : Log.storeOk ? 'localStorage 저장됨' : '저장 실패 — ' + Log.storeError);

      // 실시간 로그 (진행 중 값 반영)
      var live = Log.snapshot();
      if (!Engine.finished && LOG.t_start) live.DWELL_TOTAL = round2((Date.now() - LOG.t_start) / 1000);
      this.logEl.textContent = JSON.stringify(live, null, 1);
    }
  };

  /* ==========================================================
   * 6. 부트
   * ========================================================== */

  function boot() {
    dom.stage = document.getElementById('stage');
    dom.layer = document.getElementById('scene-layer');
    dom.subtitle = document.getElementById('subtitle-text');

    document.documentElement.dataset.mode = CFG.mode;
    document.documentElement.dataset.ver = CFG.ver;

    // 조건별 재생 목록 — Debug 패널이 이 목록으로 점프 버튼을 만들므로 먼저 정한다
    Engine.list = CFG.still !== null ? SCENES : playlistFor(CFG.mode);

    // 중도 이탈 대비 — 스키마 그대로 저장하되 t_end = 0 (미완료)
    window.addEventListener('pagehide', function () {
      if (Engine.finished || CFG.still !== null) return;
      Engine.commitDwell();
      Log.persist();
    });

    Debug.init();

    if (CFG.still !== null) {
      Engine.renderStill(CFG.still);
    } else {
      Engine.start();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
