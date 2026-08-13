/* ==========================================================
 * survey.js — 통합 설문 문항 은행 (연구참여자 제시용 전문 구현)
 *
 * 두 자극(laundry-ad · game)이 공유한다. 그래서 자극 폴더가 아니라 저장소 루트에 둔다.
 * 이 파일만 고치면 러너는 건드릴 필요가 없다 — 화면·CSV 열·하위척도 평균이 따라온다.
 *
 * 전체 구성 (총 123문항)
 *   사전 문항        3      동의 취득 직후 · 광고 제시 전
 *   광고별 설문     29 × 4  광고 1편 종료 직후. 문항·순서·문구가 4회 모두 같다
 *   응답 확인        2      광고 2 · 광고 4 블록 말미에만
 *   기본 정보        2      광고 4편 종료 후
 *
 * 문항 스키마
 *   id       {string}  고유 식별자 = CSV 열 이름. 쉼표·따옴표·공백 금지
 *   type     {string}  'likert' 7점 동의 | 'sd' 7점 의미변별(양극) | 'choice' 선택지
 *   sub      {string}  하위척도 key (SUBSCALES). 평균 계산 대상이 아니면 생략
 *   stem     {string}  문두 (likert·choice)
 *   poles    {[string,string]}  좌/우 라벨 (sd 전용)
 *   options  {string[]}         선택지 (choice 전용)
 *   scale    {number}  척도점수 (기본 7)
 *   reverse  {boolean} 역문항 — 평균 계산 시 (scale + 1 - x) 로 재코딩
 *   expect   {number}  정답이 정해진 문항(응답 확인)에서 기대하는 응답값
 * ========================================================== */
(function () {
  'use strict';

  var DEFAULT_SCALE = 7;

  /* 7점 동의 척도의 눈금 라벨 — 1·4·7 에만 글자가 붙는다 (제시용 전문 그대로) */
  var LIKERT_TICKS = { 1: '전혀 그렇지 않다', 4: '보통이다', 7: '매우 그렇다' };

  /* 비게임 앱 카테고리 — 예비조사를 거쳐 자극과 함께 확정한다.
   * 문항 구조·선택지는 바뀌지 않으므로 이 상수만 갈아 끼우면 된다.
   * 확정 전에는 validate() 가 경고한다. */
  var NONGAME_CATEGORY = '[비게임 앱 카테고리]';

  /* ---------- 하위척도 ----------
   * 노력·짜증은 점수가 높을수록 부정적인 구성개념이다. 역문항이 아니라 척도 자체가 그렇다 —
   * 재코딩하면 안 된다. 정본에 역문항은 하나도 없다. */
  var SUBSCALES = [
    { key: '유능감',        label: '유능감',            items: ['유능감1', '유능감2', '유능감3'] },
    { key: '노력',          label: '인지적 노력·부담',   items: ['노력1', '노력2', '노력3'] },
    { key: '통제감',        label: '통제감',            items: ['통제감1', '통제감2', '통제감3', '통제감4'] },
    { key: '짜증',          label: '짜증·성가심',        items: ['짜증1', '짜증2', '짜증3'] },
    { key: '광고태도',      label: '광고에 대한 태도',   items: ['광고태도1', '광고태도2', '광고태도3'] },
    { key: '제품태도',      label: '제품(앱)에 대한 태도', items: ['제품태도1', '제품태도2', '제품태도3', '제품태도4'] },
    { key: '이용의도',      label: '이용 의향',          items: ['이용의도1', '이용의도2', '이용의도3'] },
    { key: '조작점검_실패', label: '조작 점검 — 실패 제시', items: ['조작점검_실패1', '조작점검_실패2', '조작점검_실패3'] },
    { key: '조작점검_개입', label: '조작 점검 — 개입 가능', items: ['조작점검_개입1', '조작점검_개입2', '조작점검_개입3'] }
  ];

  /* ==========================================================
   * 0. 시작 화면 (서면 동의를 이미 받았어도 화면에 있어야 한다)
   *
   * 철회권은 동의 시점이 아니라 참여 내내 유효하다. 그래서 중단 안내를 시작 화면에 둔다.
   *
   * 화면 제목은 포괄 고지용이다. 정식 과제명("실패에 대한 개입이…")을 쓰면 참가자가 무엇을
   * 비교하는 연구인지 알아채고 포괄 고지 설계가 무너진다 — 디브리핑에서 고지한다.
   * 소요 시간은 설명서 3항에 공개한 숫자와 같아야 한다. 문항 수는 여기서 세지 않고
   * 실제 문항 은행에서 계산한다(SUMMARY_TEXT) — 문항을 고치면 화면이 저절로 따라온다.
   * ========================================================== */

  var STUDY_TITLE = '모바일 광고에 대한 소비자 반응 연구';
  var DURATION_TEXT = '약 18~22분';
  var STRUCTURE_TEXT = '광고 4편을 차례로 경험하고, 각 광고 후 설문에 응답합니다.';
  var WITHDRAW_TEXT =
    '언제든 중단하실 수 있으며 불이익은 없습니다. 중단을 원하시면 연구원에게 말씀해 주세요.';
  var SID_LABEL = '식별 번호';
  var SID_HELP = '연구원이 알려 드리는 번호를 입력해 주세요. 이름은 수집하지 않습니다.';

  /* ==========================================================
   * 1. 사전 문항 (동의 취득 직후 · 광고 제시 전 · 3문항)
   * ========================================================== */

  var PRE_INSTRUCTION =
    '설문에 참여해 주셔서 감사합니다. 먼저 평소 앱 이용과 광고 경험에 대한 간단한 질문에 ' +
    '답해 주십시오.';

  var FREQ_OPTIONS = ['전혀 안 함', '월 1회 이하', '월 2–3회', '주 1회', '주 2–3회', '거의 매일'];

  /* 실패 광고 노출 빈도 — 제시용 전문에서 사전 문항 안내와 '사전 1' 사이에 번호 없이 놓여 있어
   * 한때 보류했던 문항이다. 넣기로 정했고, 전문에 놓인 자리 그대로 사전 문항 맨 앞에 둔다.
   *
   * 전문에서 한 군데 고쳤다: '게임 속 인물' · '모바일 게임 광고' → '광고 속 인물' · '모바일 앱 광고'.
   * 이 문항이 재려는 것은 실패-수정형이라는 광고 형식을 겪어 봤는지 여부인데, 게임으로 한정하면
   * 자극 넷 중 둘(세탁 시트 광고)에서 겪은 노출이 응답에 안 잡힌다. 형식은 그대로고 대상만 넓혔다.
   *
   * "(이하 ‘실패 광고’)"는 전문 그대로 둔다. 한 번 뺐다가 되돌렸다 —
   * 빼면 화면에 '실패 광고'라는 말이 한 글자도 남지 않아, 이 문항이 무엇을 묻는지 찾는 쪽에서
   * 문항 자체가 없는 것처럼 보인다. 구성개념 이름을 화면에 안 쓴다는 원칙의 예외이고,
   * 그래도 되는 이유는 이 문항이 **광고를 하나도 보기 전에** 나오기 때문이다.
   * 아직 아무 자극도 겪지 않은 시점이라 무엇을 비교하는 연구인지 짚을 근거가 없다.
   * 광고를 본 뒤에 나오는 문항(섹션 F 등)에는 이 용어를 쓰지 않는다.
   *
   * 척도는 7점 동의형이 아니라 **빈도 구간 선택**이다. 재려는 것이 태도가 아니라 접촉량이라,
   * "1~7 중 몇 점" 으로 물으면 참가자마다 '자주'의 기준이 달라 같은 노출량이 다른 점수로 들어온다.
   * 구간을 말로 못 박으면 그 편차가 사라지고, 필요하면 분석에서 다시 순서형 점수로 쓸 수 있다.
   * 이 문항은 다른 두 사전 문항(FREQ_OPTIONS · 6단)보다 구간을 잘게 나눈다 — 저빈도(월)와
   * 고빈도(주 5~6회·매일)를 함께 갈라야 하는 문항이라 6단으로는 위쪽이 뭉친다. */
  var EXPOSURE_FREQ_OPTIONS = [
    '전혀 접하지 않았다', '월 1회 미만', '월 1~3회',
    '주 1~2회', '주 3~4회', '주 5~6회', '거의 매일 또는 하루에 여러 번'
  ];

  var PRE = [
    { id: '사전_실패광고노출', type: 'choice', options: EXPOSURE_FREQ_OPTIONS,
      stem: '평소 광고 속 인물이 쉬워 보이는 과제에 반복해서 실패하는 형태의 ' +
            '모바일 앱 광고(이하 ‘실패 광고’)를 얼마나 자주 접하십니까?' },
    { id: '사전_게임앱빈도', type: 'choice', options: FREQ_OPTIONS,
      stem: '귀하는 모바일 게임(게임 앱)을 얼마나 자주 이용하십니까?' },
    { id: '사전_비게임앱빈도', type: 'choice', options: FREQ_OPTIONS,
      stem: '귀하는 ' + NONGAME_CATEGORY + ' 앱을 얼마나 자주 이용하십니까?' }
  ];

  /* ==========================================================
   * 2. 광고별 설문 (광고 1편 종료 직후 · 29문항 · 4편 반복)
   *
   * 페이지 단위로 나눠 둔다. 정본이 명시적으로 요구하는 것은 "섹션 C 와 D 의 화면 분리"
   * 하나지만, 섹션마다 지시문과 척도 형식이 달라 섹션별 1페이지로 통일했다.
   * 한 화면에 형식이 다른 척도를 섞으면 응답 형식을 오해하기 쉽다.
   * ========================================================== */

  var BEFORE_AD =
    '지금부터 광고를 하나 경험하시게 됩니다. 끝까지 경험하신 뒤 다음으로 넘어가 주십시오.';

  /* 개입 조건에만 한 줄 더 붙는다. 조작이 필요한데 알려 주지 않으면 참가자가 화면을 보고만 있다가
   * 구간이 끝나 버린다 — 조건 자체가 성립하지 않는다.
   * 조건 이름('개입형')이 아니라 "무엇을 하면 되는지"만 말한다. 이 문장 하나가 두 조건의
   * 안내량 차이를 만들지만, 없애면 조작 불능이 되므로 감수하고 넣는다. */
  var BEFORE_AD_INTERVENE = '화면 안내에 따라 직접 조작하는 부분이 있습니다.';

  var AFTER_AD = '방금 경험하신 광고에 대해 답해 주십시오.';

  /* 광고와 광고 사이 휴식 (계획서 8항 "원하면 언제든 휴식") */
  var BREAK_TEXT = '잠시 쉬셔도 됩니다. 준비되시면 다음을 눌러 주세요.';

  /* 설문 화면마다 붙는 필수 응답 안내 */
  var REQUIRED_NOTE = '모든 문항에 응답해 주셔야 다음으로 넘어갑니다.';

  var BLOCK_PAGES = [
    {
      key: 'A', title: '광고를 경험하는 동안',
      instruction: '다음 각 문장에 어느 정도 동의하시는지 표시해 주십시오.',
      items: [
        { id: '유능감1', sub: '유능감', type: 'likert', stem: '이 광고를 경험하는 동안 나는 유능하다고 느꼈다' },
        { id: '유능감2', sub: '유능감', type: 'likert', stem: '이 광고를 경험하는 동안 나는 매우 유능하고 효과적이라고 느꼈다' },
        { id: '유능감3', sub: '유능감', type: 'likert', stem: '내 능력이 이 광고가 제시한 상황에 잘 맞았다' },
        { id: '노력1', sub: '노력', type: 'likert', stem: '이 광고를 이해하고 따라가는 데 정신적으로 부담이 되었다' },
        { id: '노력2', sub: '노력', type: 'likert', stem: '이 광고를 경험하는 데 많은 노력을 들여야 했다' },
        { id: '노력3', sub: '노력', type: 'likert', stem: '이 광고를 경험하는 과정이 번거로웠다' },
        { id: '통제감1', sub: '통제감', type: 'likert', stem: '나는 이 광고 경험을 상당 부분 통제했다고 느꼈다' },
        { id: '통제감2', sub: '통제감', type: 'likert', stem: '광고를 보는 동안 내 행동이 경험을 결정했다' },
        { id: '통제감3', sub: '통제감', type: 'likert', stem: '나는 광고를 내 방식대로 통제할 수 있었다' },
        { id: '통제감4', sub: '통제감', type: 'likert', stem: '나는 광고와의 상호작용을 통제할 수 있었다' }
      ]
    },
    {
      key: 'B', title: '이 광고에 대한 느낌',
      instruction: '',
      items: [
        { id: '짜증1', sub: '짜증', type: 'likert', stem: '이 광고는 짜증스러웠다' },
        { id: '짜증2', sub: '짜증', type: 'likert', stem: '이 광고는 성가셨다' },
        { id: '짜증3', sub: '짜증', type: 'likert', stem: '이 광고는 사람의 지능을 모독하는 것 같았다' }
      ]
    },
    {
      /* C 와 D 는 반드시 화면을 분리한다 — 대상('광고' vs '제품(앱)')이 다른데
       * 같은 화면에 두면 응답자가 무엇을 평가하는지 혼동한다. 지시문의 대상은 굵게 표기한다. */
      key: 'C', title: '이 광고에 대한 전반적인 평가',
      instruction: '방금 경험하신 <b>광고</b>에 대한 생각과 가장 가까운 곳에 표시해 주십시오.',
      items: [
        { id: '광고태도1', sub: '광고태도', type: 'sd', poles: ['나쁘다', '좋다'] },
        { id: '광고태도2', sub: '광고태도', type: 'sd', poles: ['불쾌하다', '유쾌하다'] },
        { id: '광고태도3', sub: '광고태도', type: 'sd', poles: ['비호의적이다', '호의적이다'] }
      ]
    },
    {
      key: 'D', title: '이 제품(앱)에 대한 전반적인 평가',
      instruction: '이번에는 광고가 아니라, 광고에 나온 <b>제품(앱)</b> 자체에 대해 표시해 주십시오.',
      items: [
        { id: '제품태도1', sub: '제품태도', type: 'sd', poles: ['마음에 안 든다', '마음에 든다'] },
        { id: '제품태도2', sub: '제품태도', type: 'sd', poles: ['부정적이다', '긍정적이다'] },
        { id: '제품태도3', sub: '제품태도', type: 'sd', poles: ['나쁘다', '좋다'] },
        { id: '제품태도4', sub: '제품태도', type: 'sd', poles: ['바람직하지 않다', '바람직하다'] }
      ]
    },
    {
      key: 'E', title: '이용 의향',
      instruction: '',
      items: [
        { id: '이용의도1', sub: '이용의도', type: 'likert', stem: '나는 이 앱을 다운로드할 의향이 있다' },
        { id: '이용의도2', sub: '이용의도', type: 'likert', stem: '나는 이 앱을 사용해 볼 의향이 있다' },
        { id: '이용의도3', sub: '이용의도', type: 'likert', stem: '이 광고를 보고 나니 이 앱을 한번 사용해 보고 싶다' }
      ]
    },
    {
      key: 'F', title: '광고 내용 확인',
      instruction: '방금 경험하신 광고의 내용에 대해 표시해 주십시오.',
      items: [
        { id: '조작점검_실패1', sub: '조작점검_실패', type: 'likert', stem: '이 광고에는 실패하거나 잘못되는 상황이 나왔다' },
        { id: '조작점검_실패2', sub: '조작점검_실패', type: 'likert', stem: '광고에는 인물이 원하던 결과를 얻지 못하는 장면이 있었다' },
        { id: '조작점검_실패3', sub: '조작점검_실패', type: 'likert', stem: '광고에서 문제 상황이 분명히 드러났다' },
        { id: '조작점검_개입1', sub: '조작점검_개입', type: 'likert', stem: '이 광고에서 나는 직접 손을 대 잘못된 부분을 고칠 수 있었다' },
        { id: '조작점검_개입2', sub: '조작점검_개입', type: 'likert', stem: '이 광고는 내가 개입해서 결과를 바꿀 수 있게 되어 있었다' },
        { id: '조작점검_개입3', sub: '조작점검_개입', type: 'likert', stem: '그냥 보기만 한 게 아니라 직접 조작하는 부분이 있었다' }
      ]
    }
  ];

  /* ==========================================================
   * 3. 응답 확인 (광고 2 · 광고 4 블록 말미에만 · 각 1문항)
   *
   * 마지막 페이지(F) 끝에 붙인다. 별도 화면에 혼자 두면 눈에 띄어 거의 전원이 통과하므로
   * 불성실 응답을 걸러내는 힘을 잃는다.
   * ========================================================== */

  var ATTENTION = {
    id: '응답확인', type: 'likert', expect: 2,
    stem: '이 문항에는 ‘2’를 선택해 주십시오'
  };
  /** 응답 확인이 붙는 블록 번호 (제시 순서 기준) */
  var ATTENTION_BLOCKS = [2, 4];

  /* ==========================================================
   * 4. 기본 정보 (광고 4편 종료 후 · 2문항)
   * ========================================================== */

  var DEMO_INSTRUCTION = '마지막으로 간단한 기본 정보를 여쭙겠습니다.';

  var DEMO = [
    { id: '기본_연령대', type: 'choice', stem: '귀하의 연령대는 어떻게 되십니까?',
      options: ['만 19–29세', '30대', '40대', '50대', '60세 이상'] },
    { id: '기본_성별', type: 'choice', stem: '귀하의 성별은 어떻게 되십니까?',
      options: ['남성', '여성', '응답하지 않음'] }
  ];

  var CLOSING = '모든 설문이 끝났습니다. 잠시 후 연구원이 연구에 대한 자세한 설명을 드리겠습니다.';

  /* ==========================================================
   * 5. 파생값 (러너가 사용)
   * ========================================================== */

  /** 광고별 설문 29문항을 평평하게 (응답 확인 제외) */
  var BLOCK_ITEMS = BLOCK_PAGES.reduce(function (acc, p) { return acc.concat(p.items); }, []);

  /** 참가자가 실제로 채우는 문항 수 — 시작 화면과 설명서가 같은 숫자를 쓰게 하는 근거 */
  var TOTAL_ITEMS = PRE.length + BLOCK_ITEMS.length * 4 + ATTENTION_BLOCKS.length + DEMO.length;
  var SUMMARY_TEXT = '총 ' + TOTAL_ITEMS + '문항, ' + DURATION_TEXT;

  function fill(it) {
    if (typeof it.scale !== 'number') it.scale = DEFAULT_SCALE;
    if (!it.reverse) it.reverse = false;
    if (!it.ticks && it.type === 'likert') it.ticks = LIKERT_TICKS;
  }
  BLOCK_ITEMS.forEach(fill);
  PRE.forEach(fill);
  DEMO.forEach(fill);
  fill(ATTENTION);

  /** 역문항 재코딩 — 원점수 → 정방향 점수. 정본에 역문항은 없지만 스키마는 유지한다 */
  function recode(item, value) {
    if (value == null || value === '') return null;
    var v = Number(value);
    if (!isFinite(v)) return null;
    return item.reverse ? (item.scale + 1 - v) : v;
  }

  function itemById(id) {
    for (var i = 0; i < BLOCK_ITEMS.length; i++) if (BLOCK_ITEMS[i].id === id) return BLOCK_ITEMS[i];
    return null;
  }

  /** 하위척도 평균 (역문항 재코딩 후). 결측이 하나라도 있으면 null */
  function subscaleMean(key, responses) {
    var sub = null;
    for (var i = 0; i < SUBSCALES.length; i++) if (SUBSCALES[i].key === key) sub = SUBSCALES[i];
    if (!sub) return null;
    var sum = 0;
    for (var j = 0; j < sub.items.length; j++) {
      var it = itemById(sub.items[j]);
      var v = recode(it, responses ? responses[sub.items[j]] : null);
      if (v == null) return null;
      sum += v;
    }
    return Math.round((sum / sub.items.length) * 1000) / 1000;
  }

  /** 문항 구성 자기점검 — 중복 id·미정의 하위척도·총계 어긋남을 조기에 잡는다 */
  function validate() {
    var errs = [];
    var seen = {};
    var all = [].concat(PRE, BLOCK_ITEMS, [ATTENTION], DEMO);

    all.forEach(function (it, i) {
      if (!it.id) errs.push('#' + (i + 1) + ' id 없음');
      if (seen[it.id]) errs.push('id 중복: ' + it.id);
      seen[it.id] = true;
      if (/[,"\s]/.test(it.id || '')) errs.push('id 에 쉼표/따옴표/공백: ' + it.id);
      if (it.type === 'sd') {
        if (!it.poles || it.poles.length !== 2) errs.push('sd 문항에 양극 라벨이 없다: ' + it.id);
      } else if (it.type === 'choice') {
        if (!it.options || !it.options.length) errs.push('choice 문항에 선택지가 없다: ' + it.id);
      } else if (it.type === 'likert') {
        if (!it.stem) errs.push('문두 없음: ' + it.id);
        if (!(it.scale >= 2)) errs.push('척도점수 오류: ' + it.id);
      } else {
        errs.push('알 수 없는 type: ' + it.id + ' (' + it.type + ')');
      }
    });

    if (BLOCK_ITEMS.length !== 29) errs.push('광고별 설문이 29문항이 아니다: ' + BLOCK_ITEMS.length);

    // 하위척도가 가리키는 문항이 실제로 있는지
    SUBSCALES.forEach(function (s) {
      s.items.forEach(function (id) {
        if (!itemById(id)) errs.push('하위척도 ' + s.key + ' 가 없는 문항을 가리킨다: ' + id);
      });
    });
    // 하위척도에 안 잡힌 문항
    BLOCK_ITEMS.forEach(function (it) {
      var found = SUBSCALES.some(function (s) { return s.items.indexOf(it.id) >= 0; });
      if (!found) errs.push('어느 하위척도에도 안 들어간 문항: ' + it.id);
    });

    // 총계 = 사전 3 + 29×4 + 응답확인 2 + 기본 2 = 123
    var total = PRE.length + BLOCK_ITEMS.length * 4 + ATTENTION_BLOCKS.length + DEMO.length;
    if (total !== 123) errs.push('총 문항 수가 123이 아니다: ' + total);

    if (NONGAME_CATEGORY.indexOf('[') === 0) {
      errs.push('경고: 비게임 앱 카테고리가 아직 확정되지 않았다 — ' + NONGAME_CATEGORY);
    }
    return errs;
  }

  var api = {
    SUBSCALES: SUBSCALES,
    STUDY_TITLE: STUDY_TITLE, DURATION_TEXT: DURATION_TEXT,
    STRUCTURE_TEXT: STRUCTURE_TEXT, WITHDRAW_TEXT: WITHDRAW_TEXT,
    SID_LABEL: SID_LABEL, SID_HELP: SID_HELP,
    TOTAL_ITEMS: TOTAL_ITEMS, SUMMARY_TEXT: SUMMARY_TEXT,
    PRE: PRE, PRE_INSTRUCTION: PRE_INSTRUCTION,
    BLOCK_PAGES: BLOCK_PAGES, BLOCK_ITEMS: BLOCK_ITEMS,
    BEFORE_AD: BEFORE_AD, BEFORE_AD_INTERVENE: BEFORE_AD_INTERVENE, AFTER_AD: AFTER_AD,
    BREAK_TEXT: BREAK_TEXT, REQUIRED_NOTE: REQUIRED_NOTE,
    ATTENTION: ATTENTION, ATTENTION_BLOCKS: ATTENTION_BLOCKS,
    DEMO: DEMO, DEMO_INSTRUCTION: DEMO_INSTRUCTION, CLOSING: CLOSING,
    DEFAULT_SCALE: DEFAULT_SCALE, LIKERT_TICKS: LIKERT_TICKS,
    NONGAME_CATEGORY: NONGAME_CATEGORY,
    recode: recode, subscaleMean: subscaleMean, itemById: itemById, validate: validate
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SURVEY = api;
})();
