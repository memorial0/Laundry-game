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

  var PAL = {
    // 세탁실
    wall: '#E7EEF4', wallLo: '#D8E3EC', wallHi: '#F3F8FB',
    floor: '#EBE4D8', floorLo: '#DCD3C3', base: '#CBC1AE',
    // 세탁기
    body: '#FFFFFF', bodyLo: '#E4EBF2', panel: '#EEF3F8', edge: '#C4CFDB',
    ring: '#B6C3D1', ringLo: '#93A2B4', door: '#DCE5EE', glass: '#8FA3B8', opening: '#3D4A5C',
    // 물 · 염료
    water: '#CFE1EC', dye: '#4A5A8C', dyeLo: '#7E8DC2', stain: '#8F9BC6',
    // 의류
    light: '#FCFDFF', lightEdge: '#D5DFEA', lightShade: '#EBF1F7',
    dark: '#2F3A56', darkEdge: '#212940', darkHi: '#44527C',
    // 인물
    skin: '#F1CBAB', skinEdge: '#DCAE8B', hair: '#3B3128', wear: '#7C9B8B', wearLo: '#658272',
    // 제품 (가상 브랜드)
    brand: '#2FA98C', brandLo: '#1E8B71', brandPale: '#DFF3ED',
    sheet: '#FFFFFF', sheetEdge: '#C9E2DA',
    box: '#F4F8F7', boxEdge: '#BFDCD3',
    ink: '#2B3440', mute: '#78868F'
  };

  // ver B: 소재 외에 인물 옷 색상·배경 색조만 다르다 (구도·길이·정보량 동일)
  if (CFG.ver === 'B') {
    PAL.wall = '#F2ECE4'; PAL.wallLo = '#E6DCD0'; PAL.wallHi = '#FBF7F1';
    PAL.floor = '#D6DBE0'; PAL.floorLo = '#C4CBD2'; PAL.base = '#B7BFC7';
    PAL.wear = '#C08466'; PAL.wearLo = '#A56C51';
    PAL.light = '#FFFCF6'; PAL.lightEdge = '#DDCDB2'; PAL.lightShade = '#F5EBDA';
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
      '<radialGradient id="g-water" cx="0.42" cy="0.36" r="0.78">' +
      '<stop offset="0" stop-color="#EAF3F8"/><stop offset="1" stop-color="' + PAL.water + '"/>' +
      '</radialGradient>' +
      '<radialGradient id="g-glass" cx="0.36" cy="0.3" r="0.8">' +
      '<stop offset="0" stop-color="#B9CBDD"/><stop offset="1" stop-color="' + PAL.glass + '"/>' +
      '</radialGradient>' +
      '<radialGradient id="g-pack" cx="0.5" cy="0.42" r="0.7">' +
      '<stop offset="0" stop-color="' + PAL.brandPale + '"/><stop offset="1" stop-color="' + PAL.wall + '"/>' +
      '</radialGradient>' +
      '<filter id="f-soft" x="-30%" y="-30%" width="160%" height="160%">' +
      '<feGaussianBlur stdDeviation="7"/></filter>' +
      '<filter id="f-blob" x="-40%" y="-40%" width="180%" height="180%">' +
      '<feGaussianBlur stdDeviation="4"/></filter>' +
      '</defs>';
  };

  ART.svg = function (inner, cls, html) {
    var el = document.createElement('div');
    el.className = 'scene ' + (cls || '');
    el.innerHTML =
      '<svg class="scene-svg" viewBox="0 0 1080 1920" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
      ART.defs() + inner + '</svg>' + (html || '');
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
    var basket = o.noProps ? '' :
      '<g class="basket">' +
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
      '<circle cx="650" cy="970" r="24" fill="' + PAL.body + '" stroke="' + PAL.ringLo + '" stroke-width="6"/>' +
      '<path d="M650,970 V952" stroke="' + PAL.ringLo + '" stroke-width="6" stroke-linecap="round"/>' +
      '<rect x="696" y="950" width="150" height="40" rx="10" fill="' + PAL.opening + '" opacity=".85"/>' +
      '<rect x="712" y="964" width="52" height="12" rx="6" fill="' + PAL.brand + '"/>' +
      '<circle cx="900" cy="970" r="11" fill="' + PAL.brand + '"/>' +
      '<circle cx="940" cy="970" r="11" fill="' + PAL.ring + '"/>' +
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

  /* 시트 1장 */
  ART.sheet = function (x, y, s, cls) {
    s = s === undefined ? 1 : s;
    return '<g class="' + (cls || '') + '" transform="translate(' + x + ',' + y + ') scale(' + s + ')">' +
      '<rect x="-90" y="-62" width="180" height="124" rx="20" fill="' + PAL.sheet + '" stroke="' + PAL.sheetEdge + '" stroke-width="5"/>' +
      '<rect x="-90" y="-62" width="180" height="124" rx="20" fill="' + PAL.brandPale + '" opacity=".55"/>' +
      '<path d="M-62,-14 q31,-20 62,0 t62,0 M-62,24 q31,-20 62,0 t62,0" fill="none" stroke="' + PAL.brand + '" stroke-width="5" stroke-linecap="round" opacity=".75"/>' +
      '<circle cx="0" cy="-36" r="13" fill="none" stroke="' + PAL.brand + '" stroke-width="5"/>' +
      '<circle cx="0" cy="-36" r="4" fill="' + PAL.brand + '"/>' +
      '</g>';
  };

  /* 의류 — kind: shirt | tee | towel | socks. (x,y)=좌상단, 로컬 200x210 */
  ART.garment = function (kind, o) {
    o = o || {};
    var fill = o.fill || PAL.light;
    var edge = o.edge || PAL.lightEdge;
    var s = o.s === undefined ? 1 : o.s;
    var body = '';

    var shade = o.shade || (o.fill ? PAL.darkHi : PAL.lightShade);

    if (kind === 'shirt' || kind === 'tee') {
      body =
        '<path d="M70,14 L44,6 L8,44 L40,80 L54,64 L54,200 L146,200 L146,64 L160,80 L192,44 L156,6 L130,14' +
        ' C122,42 78,42 70,14 Z" fill="' + fill + '" stroke="' + edge + '" stroke-width="5" stroke-linejoin="round"/>' +
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
      body =
        '<rect x="22" y="20" width="156" height="176" rx="12" fill="' + fill + '" stroke="' + edge + '" stroke-width="5"/>' +
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

    // 이염 얼룩 — 번진 느낌이 나도록 흐린 후광 + 진한 코어
    var stain = '';
    if (o.stained && kind !== 'socks') {
      var blots = [[78, 96, 30, 24], [124, 136, 25, 20], [68, 162, 21, 16], [128, 78, 16, 13], [100, 186, 22, 11]];
      var halo = '', core = '';
      for (var i = 0; i < blots.length; i++) {
        var b = blots[i];
        halo += '<ellipse cx="' + b[0] + '" cy="' + b[1] + '" rx="' + (b[2] + 8) + '" ry="' + (b[3] + 7) + '"/>';
        core += '<ellipse cx="' + b[0] + '" cy="' + b[1] + '" rx="' + b[2] + '" ry="' + b[3] + '"/>';
      }
      stain =
        '<g fill="' + PAL.stain + '" opacity=".45" filter="url(#f-blob)">' + halo + '</g>' +
        '<g fill="' + PAL.stain + '" opacity=".72">' + core + '</g>';
    }

    return '<g transform="translate(' + (o.x || 0) + ',' + (o.y || 0) + ') scale(' + s + ')">' + body + stain + '</g>';
  };

  ART.lightGarment = function (o) { return ART.garment(V.light.shape, o); };
  ART.darkGarment = function (o) {
    o = o || {};
    o.fill = PAL.dark; o.edge = PAL.darkEdge; o.shade = PAL.darkHi;
    return ART.garment(V.dark.shape, o);
  };

  /* 인물 — 발 밑선 기준. arms 마크업은 장면이 넘긴다 */
  ART.person = function (o) {
    o = o || {};
    var x = o.x === undefined ? 330 : o.x;
    var y = o.y === undefined ? 1400 : o.y;
    var mood = o.mood || 'neutral';
    var mouth = mood === 'happy'
      ? '<path d="M-28,-600 q28,32 56,0" fill="none" stroke="' + PAL.ink + '" stroke-width="7" stroke-linecap="round"/>'
      : mood === 'worried'
        ? '<path d="M-26,-586 q26,-22 52,0" fill="none" stroke="' + PAL.ink + '" stroke-width="7" stroke-linecap="round"/>'
        : '<path d="M-24,-592 h48" fill="none" stroke="' + PAL.ink + '" stroke-width="7" stroke-linecap="round"/>';
    var brow = mood === 'worried'
      ? '<path d="M-48,-670 l36,14 M48,-670 l-36,14" fill="none" stroke="' + PAL.hair + '" stroke-width="8" stroke-linecap="round"/>'
      : '<path d="M-44,-666 h30 M44,-666 h-30" fill="none" stroke="' + PAL.hair + '" stroke-width="8" stroke-linecap="round" opacity=".8"/>';
    var blush = mood === 'happy'
      ? '<ellipse cx="-46" cy="-612" rx="15" ry="9" fill="#E8836B" opacity=".28"/>' +
        '<ellipse cx="46" cy="-612" rx="15" ry="9" fill="#E8836B" opacity=".28"/>'
      : '';

    return '<g class="person ' + (o.cls || '') + '" transform="translate(' + x + ',' + y + ')">' +
      '<ellipse cx="0" cy="-6" rx="132" ry="24" fill="' + PAL.ink + '" opacity=".13"/>' +
      // 다리 · 신발
      '<rect x="-80" y="-268" width="66" height="248" rx="28" fill="' + PAL.wearLo + '"/>' +
      '<rect x="14" y="-268" width="66" height="248" rx="28" fill="' + PAL.wearLo + '"/>' +
      '<path d="M-88,-20 h82 q10,0 10,10 v10 q0,10 -12,10 h-70 q-12,0 -12,-14 Z" fill="' + PAL.ink + '" opacity=".78"/>' +
      '<path d="M6,-20 h82 q12,0 12,14 v6 q0,10 -12,10 h-70 q-12,0 -12,-10 v-10 q0,-10 10,-10 Z" fill="' + PAL.ink + '" opacity=".78"/>' +
      // 상의
      '<rect x="-96" y="-548" width="192" height="308" rx="54" fill="' + PAL.wear + '"/>' +
      '<path d="M-96,-420 q96,34 192,0 v146 q0,34 -34,34 h-124 q-34,0 -34,-34 Z" fill="' + PAL.wearLo + '" opacity=".45"/>' +
      '<path d="M-40,-548 q40,44 80,0" fill="none" stroke="' + PAL.wearLo + '" stroke-width="8"/>' +
      // 목 · 머리
      '<rect x="-24" y="-588" width="48" height="48" rx="10" fill="' + PAL.skin + '"/>' +
      '<path d="M-24,-568 q24,22 48,0 v-20 h-48 Z" fill="' + PAL.skinEdge + '" opacity=".55"/>' +
      '<circle cx="0" cy="-642" r="70" fill="' + PAL.skin + '" stroke="' + PAL.skinEdge + '" stroke-width="4"/>' +
      '<ellipse cx="-70" cy="-636" rx="12" ry="16" fill="' + PAL.skin + '" stroke="' + PAL.skinEdge + '" stroke-width="4"/>' +
      '<ellipse cx="70" cy="-636" rx="12" ry="16" fill="' + PAL.skin + '" stroke="' + PAL.skinEdge + '" stroke-width="4"/>' +
      '<path d="M-72,-648 a72,72 0 0 1 144,0 q-16,-16 -40,-14 q-30,4 -58,-10 q-16,-8 -26,10 q-12,4 -20,14 Z" fill="' + PAL.hair + '"/>' +
      '<path d="M-72,-648 q-6,26 2,44 q-24,-14 -18,-40 Z" fill="' + PAL.hair + '"/>' +
      '<path d="M72,-648 q6,26 -2,44 q24,-14 18,-40 Z" fill="' + PAL.hair + '"/>' +
      '<circle cx="-25" cy="-638" r="8" fill="' + PAL.ink + '"/>' +
      '<circle cx="25" cy="-638" r="8" fill="' + PAL.ink + '"/>' +
      '<circle cx="-22" cy="-641" r="3" fill="#fff"/>' +
      '<circle cx="28" cy="-641" r="3" fill="#fff"/>' +
      blush + brow + mouth + (o.arms || '') +
      '</g>';
  };

  /* 손 (인물) — 소매 끝 + 손바닥 */
  ART.personHand = function (cx, cy) {
    return '<g transform="translate(' + cx + ',' + cy + ')">' +
      '<circle cx="0" cy="0" r="26" fill="' + PAL.skin + '" stroke="' + PAL.skinEdge + '" stroke-width="4"/>' +
      '<path d="M-14,-18 q14,-10 28,0" fill="none" stroke="' + PAL.skinEdge + '" stroke-width="4" opacity=".7"/>' +
      '</g>';
  };

  ART.armsHold =
    '<path d="M-96,-500 q-54,72 -46,144" fill="none" stroke="' + PAL.wear + '" stroke-width="48" stroke-linecap="round"/>' +
    '<path d="M96,-500 q54,72 46,144" fill="none" stroke="' + PAL.wear + '" stroke-width="48" stroke-linecap="round"/>' +
    '<path d="M-148,-390 q10,-14 22,-8 M148,-390 q-10,-14 -22,-8" fill="none" stroke="' + PAL.wearLo + '" stroke-width="10" stroke-linecap="round"/>' +
    ART.personHand(-142, -356) + ART.personHand(142, -356);

  // 옷을 가슴 앞으로 들어 올린 자세 (표정이 가려지지 않도록 손 위치를 낮춘다)
  ART.armsLift =
    '<path d="M-100,-476 q-46,-24 -14,-76" fill="none" stroke="' + PAL.wear + '" stroke-width="48" stroke-linecap="round"/>' +
    '<path d="M100,-476 q46,-24 14,-76" fill="none" stroke="' + PAL.wear + '" stroke-width="48" stroke-linecap="round"/>' +
    ART.personHand(-114, -552) + ART.personHand(114, -552);

  /* 세탁기 창 클로즈업 (장면 3·7 공용) */
  ART.drum = function (inner, o) {
    o = o || {};
    // 드럼 안쪽 타공
    var holes = '';
    for (var a = 0; a < 360; a += 22.5) {
      var rad = a * Math.PI / 180;
      holes += '<circle cx="' + (540 + Math.cos(rad) * 306).toFixed(1) + '" cy="' + (1000 + Math.sin(rad) * 306).toFixed(1) +
        '" r="9" fill="' + PAL.ringLo + '" opacity=".35"/>';
    }
    return ART.room({ noProps: true }) +
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
      inner +
      '<circle cx="540" cy="1000" r="342" fill="none" stroke="' + PAL.ringLo + '" stroke-width="14" opacity=".45"/>' +
      '<path d="M290,832 q66,-102 186,-134" fill="none" stroke="#fff" stroke-width="34" stroke-linecap="round" opacity=".45"/>' +
      '<path d="M264,918 q14,-40 40,-72" fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round" opacity=".3"/>';
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
      var r = 11 + (i % 4) * 4;
      out += '<circle class="' + cls + '" cx="' + cx + '" cy="' + cy + '" r="' + r + '"' +
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
  ART.s1 = function (o) {
    o = o || {};
    var bubble =
      '<g class="' + anim('s1-bubble', o.still) + '">' +
      '<rect x="84" y="326" width="600" height="214" rx="48" fill="#fff" stroke="' + PAL.edge + '" stroke-width="6"/>' +
      '<path d="M300,538 L288,616 L372,536 Z" fill="#fff" stroke="' + PAL.edge + '" stroke-width="6" stroke-linejoin="round"/>' +
      '<path d="M302,536 H368" stroke="#fff" stroke-width="12"/>' +
      ART.text(384, 458, 56, '내일 ' + V.light.use + ' ' + V.light.name, { weight: 700 }) +
      '</g>';
    return ART.room() + ART.washer({}) +
      ART.person({ arms: ART.armsHold }) +
      ART.lightGarment({ x: 382, y: 1032, s: 0.92 }) +
      ART.darkGarment({ x: 118, y: 1036, s: 0.86 }) +
      bubble;
  };

  // 2. 제품 미사용 — 상자는 선반 위에 그대로(사용하지 않음)
  ART.s2 = function (o) {
    o = o || {};
    return ART.room() +
      ART.washer({ open: true }) +
      ART.person({ arms: ART.armsHold }) +
      '<g class="' + anim('s2-toss', o.still) + '">' +
      ART.lightGarment({ x: 382, y: 1032, s: 0.92 }) +
      ART.darkGarment({ x: 300, y: 1120, s: 0.6 }) +
      '</g>';
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
    return ART.drum(
      tumble +
      // 짙은 옷에서 배어 나오는 염료 구름
      '<g class="' + anim('s3-tint', o.still) + '"' + (o.still ? ' opacity=".45"' : '') + '>' +
      '<circle cx="540" cy="1000" r="342" fill="' + PAL.dye + '" opacity=".55"/>' +
      '<circle cx="430" cy="1080" r="180" fill="' + PAL.dye + '" opacity=".45" filter="url(#f-soft)"/>' +
      '</g>' +
      ART.particles(anim('s3-drift', o.still) || 'part-static', {})
    );
  };

  // 4. 실패 결과
  ART.s4 = function (o) {
    o = o || {};
    return ART.holdFrame({ stained: true, mood: 'worried', still: o.still });
  };

  // 4·8·9 공용 — 제품 사용 여부(stained)만 다르다. 인물·의류·구도는 같은 코드
  ART.holdFigure = function (o) {
    o = o || {};
    return ART.person({ mood: o.mood || 'neutral', arms: ART.armsLift }) +
      ART.lightGarment({ x: 220, y: 840, s: 1.1, stained: !!o.stained });
  };

  ART.holdFrame = function (o) {
    o = o || {};
    return ART.room() + ART.washer({ open: true }) + ART.holdFigure(o);
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
    HOME: { x: 270, y: 1530 },
    DROP: { x: 790, y: 1180 },
    HIT: 190,
    IDLE_MS: 8000,
    WATCH_MS: WATCH_S6_MS   // watch 재생 길이 — 조정은 WATCH_S6_MS 한 곳에서
  };

  ART.s6 = function (o) {
    o = o || {};
    var S = ART.S6;
    var guide = '<path class="s6-guide" d="M' + (S.HOME.x + 90) + ',' + (S.HOME.y - 70) +
      ' Q560,1300 ' + (S.DROP.x - 130) + ',' + (S.DROP.y + 40) + '"' +
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
    return ART.room() + ART.washer({ both: true }) + ring + guide + sheet + hand;
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
    return ART.drum(inner, {}) + label;
  };

  // 8. 개선 결과 — 원래 색에 "가까운" 상태
  ART.s8 = function (o) {
    o = o || {};
    return ART.holdFrame({ stained: false, mood: 'happy', still: o.still });
  };

  // 9. 결과 비교 — 제품 사용 여부 외 조건 동일(같은 함수 · 같은 인물 · 같은 구도)
  ART.s9 = function () {
    var TOP = 600, H = 850; // 비교 박스
    var half = function (side, stained, label) {
      var clipX = side === 'L' ? 0 : 540;
      // 배율 1:1 · 같은 함수 · stained 값만 다르다
      var dx = clipX + 270 - 330;
      return '<clipPath id="s9-' + side + '"><rect x="' + clipX + '" y="' + TOP + '" width="540" height="' + H + '"/></clipPath>' +
        '<g clip-path="url(#s9-' + side + ')">' +
        '<rect x="' + clipX + '" y="' + TOP + '" width="540" height="' + H + '" fill="url(#g-wall)"/>' +
        '<rect x="' + clipX + '" y="1382" width="540" height="' + (TOP + H - 1382) + '" fill="url(#g-floor)"/>' +
        '<rect x="' + clipX + '" y="1374" width="540" height="26" fill="' + PAL.base + '"/>' +
        '<g transform="translate(' + dx + ',0)">' +
        ART.holdFigure({ stained: stained, mood: stained ? 'worried' : 'happy' }) +
        '</g>' +
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
      ART.text(540, 1214, 76, BRAND, { weight: 800, fill: PAL.brandLo }) +
      '<rect x="384" y="1252" width="312" height="6" rx="3" fill="' + PAL.brand + '" opacity=".45"/>' +
      ART.text(540, 1320, 44, '이염 방지 세탁 시트', { fill: PAL.mute }) +
      ART.text(540, 1600, 26, '* 세탁 조건에 따라 효과는 달라질 수 있습니다.', { fill: PAL.mute, weight: 500 });
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
        later(function () { el.classList.add('is-closed'); }, S.WATCH_MS * DOOR_CLOSE_AT);
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
        later(function () { el.classList.add('is-closed'); }, 440);
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
      dur: 5,
      subtitle: function () {
        return '내일 ' + V.light.use + ' ' + V.light.name + ', 오늘 같이 빨래하기';
      },
      render: function () { return ART.svg(ART.s1({ still: CFG.still !== null }), 'sc1'); }
    },
    {
      no: 2,
      title: '제품 미사용',
      dur: 5,
      subtitle: function () { return '그대로 세탁 시작'; },
      render: function () { return ART.svg(ART.s2({ still: CFG.still !== null }), 'sc2'); }
    },
    {
      no: 3,
      title: '실패 진행',
      dur: 6,
      subtitle: function () { return '세탁 중…'; },
      render: function () { return ART.svg(ART.s3({ still: CFG.still !== null }), 'sc3'); }
    },
    {
      no: 4,
      title: '실패 결과',
      dur: 7,
      subtitle: function () { return V.light.name + ' 색이 변해 버렸다'; },
      render: function () { return ART.svg(ART.s4({ still: CFG.still !== null }), 'sc4'); }
    },
    {
      no: 5,
      title: '되감기',
      dur: 6,
      subtitle: function () { return '세탁을 시작하기 전에, 이 제품을 사용했다면?'; },
      render: function () { return ART.svg(ART.s5({ still: CFG.still !== null }), 'sc5'); }
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
        return '시트 한 장을 세탁기 안에 ' +
          (CFG.mode === MODES.INTERVENE ? '넣어 주세요' : '넣기만 하면');
      },
      render: function (ctx) {
        var el = ART.svg(ART.s6({ still: CFG.still !== null }), 'sc6');
        if (CFG.still === null) Scene6.attach(el, ctx);
        return el;
      }
    },
    {
      no: 7,
      title: '제품 작동',
      dur: 6,
      subtitle: function () { return '떠다니는 염료를 시트가 붙잡아요'; },
      render: function () { return ART.svg(ART.s7({ still: CFG.still !== null }), 'sc7'); }
    },
    {
      no: 8,
      title: '개선 결과',
      dur: 6,
      subtitle: function () { return '색은 그대로'; },
      render: function () { return ART.svg(ART.s8({ still: CFG.still !== null }), 'sc8'); }
    },
    {
      no: 9,
      title: '결과 비교',
      dur: 6,
      subtitle: function () { return '시트 하나의 차이'; },
      render: function () { return ART.svg(ART.s9(), 'sc9'); }
    },
    {
      no: 10,
      title: '제품 메시지 + CTA',
      dur: 8,
      subtitle: function () { return '세탁 중 이염을 줄여 밝은 옷을 보호하세요'; },
      render: function (ctx) {
        var el = ART.svg(
          ART.s10({ still: CFG.still !== null }), 'sc10',
          '<button type="button" class="cta">지금 구매하기</button>'
        );
        var btn = el.querySelector('.cta');
        btn.addEventListener('click', function () {
          if (btn.disabled) return;
          var clickedAt = Date.now();
          btn.disabled = true;             // 모의 광고 — 외부 이동 없음
          btn.classList.add('is-pressed');
          ctx.log.CTA_CLICK = 1;
          ctx.engine.finish({ endAt: clickedAt }); // DWELL_TOTAL은 클릭 시점까지
        });
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
    HINT_SHOWN: 0,                                 // 힌트 노출 횟수
    CTA_CLICK: 0,
    REDUCED_MOTION: readsReducedMotion(),          // OS 동작 줄이기 설정. 자극에는 영향 없음(기록 전용)
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
        HINT_SHOWN: LOG.HINT_SHOWN,
        CTA_CLICK: LOG.CTA_CLICK,
        REDUCED_MOTION: LOG.REDUCED_MOTION,
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

    start: function () {
      LOG.t_start = Date.now();
      this.playing = true;
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
