/* ==========================================================
 * survey.js — 회차별 설문 문항 은행 (29문항)
 *
 * 이 파일만 고치면 session.html(러너)은 건드릴 필요가 없다.
 *   - 문항을 추가/삭제하면 설문 화면·CSV 열·하위척도 평균이 자동으로 따라간다.
 *   - id 는 CSV 열 이름에 그대로 쓰인다 → 조건 접두어 + id (예: w_A_광고태도1).
 *     id 에는 쉼표·따옴표·공백을 넣지 말 것.
 *   - 문항 순서 = 화면에 보이는 순서. 4회차 모두 동일 순서로 제시된다(회차별 셔플 없음).
 *
 * 문항 스키마
 *   id       {string}  고유 식별자 = CSV 열 이름 (하위척도명 + 번호 권장)
 *   sub      {string}  하위척도 (SUBSCALES 의 key 와 일치해야 평균이 계산된다)
 *   stem     {string}  문두
 *   scale    {number}  척도점수 (기본 7)
 *   reverse  {boolean} 역문항 여부 — 평균 계산 시 (scale + 1 - x) 로 재코딩
 *   anchors  {[string,string]} 좌/우 라벨 (생략 시 DEFAULT_ANCHORS)
 * ========================================================== */
(function () {
  'use strict';

  /** 척도 기본값 — 개별 문항에서 덮어쓸 수 있다 */
  var DEFAULT_SCALE = 7;
  var DEFAULT_ANCHORS = ['전혀 그렇지 않다', '매우 그렇다'];

  /** 하위척도 정의 — 표시 순서와 CSV 평균 열(<접두어>_<key>_M) 이름의 근거 */
  var SUBSCALES = [
    { key: '광고태도', label: '광고에 대한 태도' },
    { key: '제품태도', label: '제품에 대한 태도' },
    { key: '구매의도', label: '구매 의도' },
    { key: '유능감', label: '유능감' },
    { key: '통제감', label: '통제감' },
    { key: '노력', label: '인지적 노력' },
    { key: '짜증', label: '짜증·성가심' },
    { key: '조작점검', label: '조작 점검' }
  ];

  /** 설문 안내문 (매 회차 상단에 표시) */
  var INSTRUCTION =
    '방금 보신 광고에 대해 느낀 그대로 답해 주세요. 정답과 오답은 없습니다. ' +
    '각 문항에서 1(전혀 그렇지 않다)~7(매우 그렇다) 중 하나를 골라 주세요.';

  /* ---------- 문항 29개 ---------- */
  var ITEMS = [
    /* 광고태도 4 */
    { id: '광고태도1', sub: '광고태도', stem: '방금 본 광고가 마음에 든다.' },
    { id: '광고태도2', sub: '광고태도', stem: '이 광고는 흥미로웠다.' },
    { id: '광고태도3', sub: '광고태도', stem: '이 광고에 호감이 간다.' },
    { id: '광고태도4', sub: '광고태도', stem: '이 광고는 지루했다.', reverse: true },

    /* 제품태도 4 */
    { id: '제품태도1', sub: '제품태도', stem: '광고에 나온 제품에 호의적인 느낌이 든다.' },
    { id: '제품태도2', sub: '제품태도', stem: '이 제품은 쓸모 있어 보인다.' },
    { id: '제품태도3', sub: '제품태도', stem: '이 제품은 믿을 만해 보인다.' },
    { id: '제품태도4', sub: '제품태도', stem: '이 제품은 나에게 별로 매력적이지 않다.', reverse: true },

    /* 구매의도 3 */
    { id: '구매의도1', sub: '구매의도', stem: '기회가 된다면 이 제품을 구매해 보고 싶다.' },
    { id: '구매의도2', sub: '구매의도', stem: '다음에 세탁 용품을 살 때 이 제품을 고려하겠다.' },
    { id: '구매의도3', sub: '구매의도', stem: '이 제품을 다른 사람에게 추천할 의향이 있다.' },

    /* 유능감 4 */
    { id: '유능감1', sub: '유능감', stem: '광고를 보는 동안 상황을 잘 해낼 수 있다고 느꼈다.' },
    { id: '유능감2', sub: '유능감', stem: '광고 속 문제를 해결하는 방법을 분명히 알 수 있었다.' },
    { id: '유능감3', sub: '유능감', stem: '광고를 보는 동안 스스로 유능하다고 느꼈다.' },
    { id: '유능감4', sub: '유능감', stem: '광고를 보는 동안 서툴게 느껴졌다.', reverse: true },

    /* 통제감 4 */
    { id: '통제감1', sub: '통제감', stem: '광고가 진행되는 과정을 내가 이끌어 간다고 느꼈다.' },
    { id: '통제감2', sub: '통제감', stem: '내 반응이 광고의 전개에 영향을 준다고 느꼈다.' },
    { id: '통제감3', sub: '통제감', stem: '광고를 보는 동안 내가 주도권을 갖고 있다고 느꼈다.' },
    { id: '통제감4', sub: '통제감', stem: '광고를 보는 동안 나는 그저 지켜보기만 하는 입장이었다.', reverse: true },

    /* 노력 3 */
    { id: '노력1', sub: '노력', stem: '광고를 보는 동안 정신적으로 애를 써야 했다.' },
    { id: '노력2', sub: '노력', stem: '광고에 집중하기 위해 노력이 필요했다.' },
    { id: '노력3', sub: '노력', stem: '광고를 끝까지 보는 데 힘이 들었다.' },

    /* 짜증 4 */
    { id: '짜증1', sub: '짜증', stem: '광고를 보는 동안 짜증이 났다.' },
    { id: '짜증2', sub: '짜증', stem: '광고가 성가시게 느껴졌다.' },
    { id: '짜증3', sub: '짜증', stem: '광고를 보는 동안 답답했다.' },
    { id: '짜증4', sub: '짜증', stem: '광고를 보는 동안 마음이 편안했다.', reverse: true },

    /* 조작점검 3 */
    { id: '조작점검1', sub: '조작점검', stem: '이 광고에서 문제가 생긴 이유는 세탁 시트를 넣지 않았기 때문이다.' },
    { id: '조작점검2', sub: '조작점검', stem: '이 광고에서 문제를 바로잡는 행동을 내가 직접 수행했다.' },
    { id: '조작점검3', sub: '조작점검', stem: '이 광고에 나온 밝은색 옷과 짙은 색 옷이 무엇이었는지 분명히 기억한다.' }
  ];

  /* ---------- 파생값 (러너가 사용) ---------- */

  ITEMS.forEach(function (it) {
    if (typeof it.scale !== 'number') it.scale = DEFAULT_SCALE;
    if (!it.reverse) it.reverse = false;
    if (!it.anchors) it.anchors = DEFAULT_ANCHORS;
  });

  /** 역문항 재코딩 — 원점수 → 정방향 점수 */
  function recode(item, value) {
    if (value == null || value === '') return null;
    var v = Number(value);
    if (!isFinite(v)) return null;
    return item.reverse ? (item.scale + 1 - v) : v;
  }

  /** 하위척도 평균 (역문항 재코딩 후). 결측이 하나라도 있으면 null */
  function subscaleMean(sub, responses) {
    var items = ITEMS.filter(function (it) { return it.sub === sub; });
    if (!items.length) return null;
    var sum = 0;
    for (var i = 0; i < items.length; i++) {
      var v = recode(items[i], responses ? responses[items[i].id] : null);
      if (v == null) return null;
      sum += v;
    }
    return Math.round((sum / items.length) * 1000) / 1000;
  }

  /** 문항 구성 자기점검 — 중복 id / 미정의 하위척도를 조기에 잡는다 */
  function validate() {
    var errs = [];
    var seen = {};
    var subKeys = SUBSCALES.map(function (s) { return s.key; });
    ITEMS.forEach(function (it, i) {
      if (!it.id) errs.push('#' + (i + 1) + ' id 없음');
      if (seen[it.id]) errs.push('id 중복: ' + it.id);
      seen[it.id] = true;
      if (/[,"\s]/.test(it.id || '')) errs.push('id 에 쉼표/따옴표/공백: ' + it.id);
      if (subKeys.indexOf(it.sub) < 0) errs.push('정의되지 않은 하위척도: ' + it.sub + ' (' + it.id + ')');
      if (!it.stem) errs.push('문두 없음: ' + it.id);
      if (!(it.scale >= 2)) errs.push('척도점수 오류: ' + it.id);
    });
    return errs;
  }

  var api = {
    ITEMS: ITEMS,
    SUBSCALES: SUBSCALES,
    INSTRUCTION: INSTRUCTION,
    DEFAULT_SCALE: DEFAULT_SCALE,
    DEFAULT_ANCHORS: DEFAULT_ANCHORS,
    recode: recode,
    subscaleMean: subscaleMean,
    validate: validate
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SURVEY = api;
})();
