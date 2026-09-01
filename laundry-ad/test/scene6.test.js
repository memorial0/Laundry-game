/* 장면 6 상호작용 (SPEC 4장)
 *  intervene: 드래그 → 드롭 / 스냅백 / 8초 힌트
 *  watch    : 시연 애니메이션 · 입력 무시
 */
'use strict';
const { bootPage, wait, dragSheet, suite } = require('./lib/harness');

/* 시트 시작 위치·투입구는 ART.S6 에서 읽는다(w.AD_ART.S6).
 * 여기 숫자를 박아 두면 자극에서 자리를 옮겼을 때 검사만 옛 자리를 짚어,
 * 빗나간 드롭을 통과로 읽는다. */
const s6 = w => w.AD_ART.S6;

/** 장면 6까지 이동한 상태의 창을 만든다 */
async function atScene6(query, idleMs) {
  const w = bootPage(query);
  await wait(150);
  if (idleMs) w.AD_ART.S6.IDLE_MS = idleMs;   // 힌트 대기시간 단축 (실제 8초)
  w.AD_ENGINE.pause();
  w.AD_ENGINE.gotoNo(6);
  await wait(50);
  return w;
}

module.exports = async function () {
  const t = suite('장면 6 · 수정 행동');

  t.section('intervene — 드래그');
  const w = await atScene6('?mode=intervene&sid=s6-int', 400);
  const E = w.AD_ENGINE;
  t.ok(!!w.document.querySelector('.s6-sheet'), '시트 요소 존재');
  t.ok(E.scene.dur === null, '장면 길이 = 가변(입력 대기)');
  t.ok(!!w.document.querySelector('.s6-ring'), '투입구 점선 하이라이트');

  // 1) 드롭 존 밖 → 스냅백
  const { el, sheet } = dragSheet(w, s6(w).HOME, { x: 200, y: 900 });
  await wait(60);
  t.ok(w.AD_RESULT.INT_ATTEMPTS === 1, '드롭존 밖 → INT_ATTEMPTS 1', w.AD_RESULT.INT_ATTEMPTS);
  const atHome = win => new RegExp('translate\\(' + s6(win).HOME.x + 'px,\\s*' + s6(win).HOME.y + 'px\\)');
  t.ok(atHome(w).test(sheet.style.transform), '원위치로 스냅백', sheet.style.transform);
  t.ok(E.scene.no === 6, '장면 6 유지');
  t.ok(w.AD_RESULT.INT_DONE === 0, 'INT_DONE 아직 0');

  // 2) 무조작 → 힌트
  await wait(600);
  t.ok(el.classList.contains('hint-on'), '무조작 시 힌트 표시');
  t.ok(w.AD_RESULT.HINT_SHOWN === 1, 'HINT_SHOWN 1', w.AD_RESULT.HINT_SHOWN);
  t.ok(atHome(w).test(sheet.style.transform), '힌트가 정답을 대신 수행하지 않음');

  // 3) 투입구에 드롭 → 성공
  dragSheet(w, s6(w).HOME, s6(w).DROP);
  t.ok(w.AD_RESULT.INT_DONE === 1, '드롭 성공 → INT_DONE 1');
  t.ok(!el.classList.contains('hint-on'), '성공 시 힌트 종료');
  t.ok(el.classList.contains('is-dropped'), '행동 직후 즉각 반응(is-dropped)');
  await wait(600);
  t.ok(el.classList.contains('is-closed'), '문 닫힘');
  await wait(700);
  t.ok(E.scene.no === 7, '장면 7 자동 진행', E.scene.no);
  t.ok(w.AD_RESULT.DWELL_INT > 0, 'DWELL_INT 기록', w.AD_RESULT.DWELL_INT);
  t.ok(w.AD_RESULT.INT_ATTEMPTS === 1, '성공 드롭은 스냅백에 포함되지 않음');

  t.section('watch — 수정 행동 장면이 없다');
  const w2 = bootPage('?mode=watch&sid=s6-watch');
  await wait(150);
  t.ok(w2.AD_ENGINE.list.map(s => s.no).join(',') === '1,2,3,4,10',
    'watch 재생 목록 = 실패까지 + 제품 메시지', w2.AD_ENGINE.list.map(s => s.no).join(','));
  t.ok(w2.AD_ENGINE.gotoNo(6) === false, '장면 6으로 이동할 수 없다');
  t.ok(w2.AD_RESULT.INT_DONE === null && w2.AD_RESULT.DWELL_INT === null,
    '개입 지표는 전부 null(공란)');

  // 정의 자체는 남아 있다 — ?still=6 스토리보드 캡처와 조건 되돌리기용
  const w3 = bootPage('?mode=watch&still=6&sid=s6-still');
  await wait(150);
  const el3 = w3.document.querySelector('.sc6');
  t.ok(!!el3, '?still=6 으로는 여전히 렌더된다');
  t.ok(!!w3.document.querySelector('.s6-grip'), '인물의 손 요소 보존');

  t.section('장면 이탈 시 정리');
  const w4 = await atScene6('?mode=intervene&sid=s6-clean', 300);
  const el4 = w4.document.querySelector('.sc6');
  t.ok(typeof el4.__cleanup === 'function', '__cleanup 등록');
  w4.AD_ENGINE.goto(0);
  await wait(500);
  t.ok(w4.AD_RESULT.HINT_SHOWN === 0, '이탈 후 힌트 타이머 미발동');

  return t.failed;
};
