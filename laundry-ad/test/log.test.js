/* 로깅 (SPEC 5장) — 스키마 1:1, postMessage, localStorage, CTA */
'use strict';
const { bootPage, wait, dragSheet, suite } = require('./lib/harness');

const SCHEMA = ['sid', 'mode', 'ver', 't_start', 't_end', 'DWELL_TOTAL', 'DWELL_INT',
  'INT_DONE', 'INT_ATTEMPTS', 'T_FIRST_DRAG', 'T_MANIP', 'T_REWIND', 'HINT_SHOWN', 'CTA_CLICK',
  // 오른쪽 위 [×] — CTA 와 짝이 되는 행동. 둘 다 0 이면 8초가 지나 저절로 끝난 것이다
  'CLOSE_CLICK', 'T_CARD',
  'REDUCED_MOTION', 'AUDIO_OK', 'SFX_COUNT',
  // 나래이션 — 세탁 자극에만 있다(게임에는 짝이 없다). INTEGRATION.md §5-12
  'VOICE_OK', 'VOICE_SPOKEN',
  'scene_times', 'scene_enter', 'scene_order'];

const done = w => (w.__messages.find(m => m && m.type === 'AD_DONE') || {}).payload;

module.exports = async function () {
  const t = suite('로깅 · AD_RESULT');

  t.section('watch — 장면 10 자동 종료');
  const a = bootPage('?mode=watch&ver=A&sid=log-w');
  await wait(120);
  const E = a.AD_ENGINE;
  for (let i = 0; i < 10; i++) { E.next(); await wait(12); }
  await wait(40);

  t.ok(E.finished, '종료 상태');
  const p = done(a);
  t.ok(!!p, 'postMessage AD_DONE 수신');
  t.ok(JSON.stringify(Object.keys(p)) === JSON.stringify(SCHEMA), '스키마 키·순서 1:1', Object.keys(p));
  const stored = a.localStorage.getItem('ad_log_log-w');
  t.ok(!!stored, "localStorage['ad_log_log-w'] 저장");
  t.ok(stored === JSON.stringify(p), 'localStorage 내용 = payload');
  t.ok(a.AD_LOG.storeOk === true, '저장 성공 플래그');
  t.ok(a.AD_RESULT_JSON === stored, 'window.AD_RESULT_JSON 동기화');
  t.ok(p.sid === 'log-w' && p.mode === 'watch' && p.ver === 'A', 'sid/mode/ver 그대로 기록',
    [p.sid, p.mode, p.ver]);
  t.ok(p.INT_DONE === null, 'watch → INT_DONE null(공란)');
  t.ok(p.DWELL_INT === null, 'watch → DWELL_INT null(장면 6 자체가 없음)', p.DWELL_INT);
  t.ok(p.T_FIRST_DRAG === null && p.T_MANIP === null, 'watch → 조작 지표 null(공란)');
  t.ok(p.CTA_CLICK === 0, 'CTA 미클릭 0');
  t.ok(p.REDUCED_MOTION === 0 || p.REDUCED_MOTION === 1 || p.REDUCED_MOTION === null,
    'REDUCED_MOTION 기록(자극에는 영향 없음)', p.REDUCED_MOTION);
  t.ok(p.t_start > 0 && p.t_end >= p.t_start, 't_start/t_end epoch ms');
  t.ok(Math.abs(p.DWELL_TOTAL - (p.t_end - p.t_start) / 1000) < 0.02, 'DWELL_TOTAL = t_end - t_start');
  t.ok(p.scene_order.join(',') === '1,2,3,4,11,10', 'scene_order = watch 재생 순서',
    p.scene_order.join(','));
  /* 지도의 키 순서는 재생 순서가 아니다 — 정수 꼴 키라 JS 가 오름차순으로 돌려준다.
   * 장면 11 이 4 뒤에 나오므로 지도는 …4,10,11 이 된다. 순서는 scene_order 로 본다. */
  t.ok(Object.keys(p.scene_times).join(',') === '1,2,3,4,10,11', 'scene_times = 장면 번호순');
  t.ok(Object.keys(p.scene_enter).join(',') === '1,2,3,4,10,11', 'scene_enter = 장면 번호순');
  const enters = p.scene_order.map(n => p.scene_enter[n]);
  t.ok(enters.every((v, i) => v >= p.t_start && (i === 0 || v >= enters[i - 1])),
    'scene_enter = t_start 이후, 재생 순서대로 오름차순 epoch ms');

  const before = a.__messages.length;
  E.finish();
  await wait(20);
  t.ok(a.__messages.length === before, '종료 재호출은 무시(중복 전송 없음)');

  t.section('CTA 클릭 종료');
  const b = bootPage('?mode=watch&sid=log-cta');
  await wait(120);
  b.AD_ENGINE.pause();
  b.AD_ENGINE.gotoNo(10);
  await wait(300);
  const btn = b.document.querySelector('.cta');
  t.ok(!!btn, 'CTA 버튼 존재');
  const clickedAt = Date.now();
  btn.dispatchEvent(new b.MouseEvent('click', { bubbles: true }));
  await wait(30);
  const p2 = done(b);
  t.ok(!!p2, 'CTA 클릭 → AD_DONE 전송');
  t.ok(p2.CTA_CLICK === 1, 'CTA_CLICK 1');
  t.ok(Math.abs(p2.t_end - clickedAt) < 60, 't_end = 클릭 시점', p2.t_end - clickedAt);
  t.ok(btn.disabled === true, '버튼 비활성 — 외부 이동 없음');
  t.ok(btn.classList.contains('is-pressed'), '눌림 피드백');
  t.ok(b.document.documentElement.dataset.state === 'ended', '종료 상태 표시');
  btn.dispatchEvent(new b.MouseEvent('click', { bubbles: true }));
  await wait(20);
  t.ok(b.__messages.filter(m => m && m.type === 'AD_DONE').length === 1, '재클릭해도 1회만 기록');
  t.ok(p2.CLOSE_CLICK === 0, 'CTA 로 끝내면 CLOSE_CLICK 0');
  t.ok(typeof p2.T_CARD === 'number', 'T_CARD 기록', p2.T_CARD);

  /* 나가는 길이 [지금 구매하기] 하나뿐이면 그 클릭이 "사고 싶다"가 아니라
   * "나가려면 이것밖에 없다"가 된다. CTA_CLICK 이 종속변인이라 닫기가 있어야
   * 그 클릭이 선택이 된다 — 여기서는 닫기가 **CTA 로 세어지지 않는지**를 본다. */
  t.section('[×] 로 나가기');
  const xw = bootPage('?mode=watch&sid=log-close');
  await wait(120);
  xw.AD_ENGINE.pause();
  xw.AD_ENGINE.gotoNo(10);
  await wait(300);
  const x = xw.document.querySelector('.ad-close');
  t.ok(!!x, '닫기 버튼 존재');
  t.ok(!!xw.document.querySelector('.cta'), '두 길이 함께 있다 (닫기가 CTA 를 대체하지 않는다)');
  const closedAt = Date.now();
  x.dispatchEvent(new xw.MouseEvent('click', { bubbles: true }));
  await wait(30);
  const pc = done(xw);
  t.ok(!!pc, '[×] → AD_DONE 전송');
  t.ok(pc.CLOSE_CLICK === 1, 'CLOSE_CLICK 1');
  t.ok(pc.CTA_CLICK === 0, '**닫기는 CTA 로 세지 않는다**', pc.CTA_CLICK);
  t.ok(Math.abs(pc.t_end - closedAt) < 60, 't_end = 누른 시점', pc.t_end - closedAt);
  t.ok(x.classList.contains('is-pressed'), '눌림 피드백');
  x.dispatchEvent(new xw.MouseEvent('click', { bubbles: true }));
  xw.document.querySelector('.cta').dispatchEvent(new xw.MouseEvent('click', { bubbles: true }));
  await wait(20);
  t.ok(xw.__messages.filter(m => m && m.type === 'AD_DONE').length === 1,
    '닫은 뒤 CTA 를 눌러도 늘어나지 않는다');
  t.ok(done(xw).CTA_CLICK === 0, '닫은 뒤의 CTA 클릭은 기록되지 않는다');

  /* 아무것도 안 누르고 8초가 지나면 둘 다 0 이다 — 분석에서 세 갈래를 가른다 */
  t.ok(p.CTA_CLICK === 0 && p.CLOSE_CLICK === 0 && p.T_CARD === null,
    '안 누르고 끝나면 둘 다 0 · T_CARD null',
    { CTA: p.CTA_CLICK, CLOSE: p.CLOSE_CLICK, T_CARD: p.T_CARD });

  t.section('intervene — 개입 지표');
  const c = bootPage('?mode=intervene&ver=B&sid=log-i');
  await wait(120);
  c.AD_ART.S6.IDLE_MS = 300;
  c.AD_ENGINE.pause();
  c.AD_ENGINE.gotoNo(6);
  await wait(40);
  /* 좌표는 ART.S6 에서 읽는다 — 박아 두면 자극에서 자리를 옮겼을 때 검사만 옛 자리를
   * 짚어, 빗나간 드롭을 통과로 읽는다. 목적지는 '드롭 존 밖' 이면 되므로 그대로 둔다. */
  const S6 = c.AD_ART.S6;
  dragSheet(c, S6.HOME, { x: 150, y: 800 });
  await wait(20);
  dragSheet(c, S6.HOME, { x: 900, y: 1700 });
  await wait(20);
  t.ok(c.AD_RESULT.INT_ATTEMPTS === 2, 'INT_ATTEMPTS = 스냅백 2회', c.AD_RESULT.INT_ATTEMPTS);
  t.ok(typeof c.AD_RESULT.T_FIRST_DRAG === 'number' && c.AD_RESULT.T_FIRST_DRAG >= 0,
    'T_FIRST_DRAG = 첫 드래그까지 걸린 시간(초)', c.AD_RESULT.T_FIRST_DRAG);
  await wait(500);
  t.ok(c.AD_RESULT.HINT_SHOWN === 1, 'HINT_SHOWN 1');
  dragSheet(c, S6.HOME, S6.DROP);
  await wait(1300);
  t.ok(c.AD_RESULT.INT_DONE === 1, 'INT_DONE 1');
  t.ok(c.AD_RESULT.DWELL_INT > 0.5, 'DWELL_INT = 실제 체류(초)', c.AD_RESULT.DWELL_INT);
  const m = c.AD_RESULT;
  t.ok(typeof m.T_MANIP === 'number' && m.T_MANIP >= 0.5,
    'T_MANIP = 첫 드래그~성공까지의 조작 시간(초)', m.T_MANIP);
  t.ok(m.T_FIRST_DRAG + m.T_MANIP <= m.DWELL_INT + 0.05,
    'T_FIRST_DRAG + T_MANIP ≤ DWELL_INT', [m.T_FIRST_DRAG, m.T_MANIP, m.DWELL_INT]);
  c.AD_ENGINE.gotoNo(10);
  c.document.querySelector('.cta').dispatchEvent(new c.MouseEvent('click', { bubbles: true }));
  await wait(30);
  const p3 = done(c);
  t.ok(p3.ver === 'B' && p3.mode === 'intervene', 'ver/mode 기록', [p3.ver, p3.mode]);
  t.ok(p3.INT_DONE === 1 && p3.INT_ATTEMPTS === 2 && p3.HINT_SHOWN === 1 && p3.CTA_CLICK === 1,
    '개입 지표가 payload에 반영', [p3.INT_DONE, p3.INT_ATTEMPTS, p3.HINT_SHOWN, p3.CTA_CLICK]);

  t.section('중도 이탈 · sid');
  const d = bootPage('?mode=watch&sid=log-x');
  await wait(120);
  d.dispatchEvent(new d.Event('pagehide'));
  await wait(20);
  const raw = d.localStorage.getItem('ad_log_log-x');
  t.ok(!!raw, '이탈 시에도 localStorage 저장');
  const p4 = JSON.parse(raw || '{}');
  t.ok(p4.t_end === 0, '미완료는 t_end = 0', p4.t_end);
  t.ok(JSON.stringify(Object.keys(p4)) === JSON.stringify(SCHEMA), '이탈 로그도 같은 스키마');
  t.ok(d.__messages.filter(m => m && m.type === 'AD_DONE').length === 0, '이탈은 AD_DONE 전송 안 함');

  const e = bootPage('?mode=watch');
  await wait(120);
  t.ok(/^sid-[a-z0-9]{8}$/.test(e.AD_RESULT.sid), 'sid 미지정 시 랜덤 생성', e.AD_RESULT.sid);

  return t.failed;
};
