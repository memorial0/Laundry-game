/* ==========================================================
 * stimulus.js — 자극 ↔ 통합 러너 인터페이스 (INTEGRATION.md 1·2·3장 구현)
 *
 * 이 파일에는 게임 로직이 없다. URL 파라미터를 읽고, 로그를 스키마대로 채우고,
 * 종료 시 러너에 통지하는 일만 한다. 세탁 자극(laundry-ad/scenes.js)의
 * 같은 역할 코드와 필드 이름·의미가 1:1로 맞아야 한다.
 * ========================================================== */

var MODES = { WATCH: 'watch', INTERVENE: 'intervene', TUTORIAL: 'tutorial' };

function pick(value, allowed, fallback) {
  return allowed.indexOf(value) >= 0 ? value : fallback;
}

function randomSid() {
  var s = 'sid-';
  var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  var buf = new Uint8Array(8);
  window.crypto.getRandomValues(buf);
  for (var i = 0; i < buf.length; i++) s += chars[buf[i] % chars.length];
  return s;
}

function readsReducedMotion() {
  if (!window.matchMedia) return null;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 0;
  } catch (e) {
    return null;
  }
}

var qs = new URLSearchParams(window.location.search);

export var CFG = {
  mode: pick(qs.get('mode'), [MODES.WATCH, MODES.INTERVENE, MODES.TUTORIAL], MODES.WATCH),
  ver: pick(qs.get('ver'), ['A', 'B'], 'A'),
  sid: qs.get('sid') || randomSid(),
  block: qs.get('block') ? parseInt(qs.get('block'), 10) : null,
  sound: qs.get('sound') !== '0',
  debug: qs.get('debug') === '1'
};

export var IS_TUTORIAL = CFG.mode === MODES.TUTORIAL;
export var IS_INTERVENE = CFG.mode === MODES.INTERVENE;

/** 자극 식별자 — 통합 로그에서 세탁('laundry')과 구분하는 열 */
export var STIM = IS_TUTORIAL ? 'game_tutorial' : 'game';

/* ----------------------------------------------------------
 * 로그 — INTEGRATION.md 3장 스키마.
 * 해당 없는 항목은 null(공란)이고 0이 아니다. 0은 "0번 일어났다"는 뜻이다.
 * ---------------------------------------------------------- */

export var LOG = {
  sid: CFG.sid,
  stim: STIM,
  mode: CFG.mode,
  ver: CFG.ver,
  block: CFG.block,
  t_start: 0,
  t_end: 0,
  DWELL_TOTAL: 0,
  // 개입(구출) 구간 체류. watch에는 그 구간 자체가 없다.
  DWELL_INT: IS_INTERVENE ? 0 : null,
  INT_DONE: IS_INTERVENE ? 0 : null,
  INT_ATTEMPTS: 0,        // 게임은 스냅백·재시도가 없어 항상 0 (스키마 정렬용)
  T_FIRST_DRAG: null,
  T_MANIP: null,
  HINT_SHOWN: 0,          // 게임에는 힌트 연출이 없어 항상 0
  CTA_CLICK: null,        // 게임에는 CTA가 없다
  REDUCED_MOTION: readsReducedMotion(),
  // --- 게임 전용 ---
  RESULT: '',             // scripted_fail | rescue_success | rescue_fail
  COLLISION_T: null,      // 초, 자극 시작~자동재생 충돌
  POWER_END: null,
  GATES_PASSED: 0,
  VER_FALLBACK: 0         // ver=B 를 요청했지만 B 타임라인이 없어 A로 대체됨
};

window.AD_RESULT = LOG;

function round2(n) { return Math.round(n * 100) / 100; }

/** 초 단위 경과 — 기준 시각이 없으면 null */
export function secondsSince(from) {
  return from ? round2((Date.now() - from) / 1000) : null;
}

var finished = false;

/**
 * 종료 통지 — postMessage + window.AD_RESULT + localStorage 백업.
 * 두 번 호출해도 첫 번째만 반영된다(엔진의 이중 종료 방어).
 */
export function finish() {
  if (finished) return LOG;
  finished = true;

  LOG.t_end = Date.now();
  LOG.DWELL_TOTAL = secondsSince(LOG.t_start) || 0;

  var json = JSON.stringify(LOG);
  window.AD_RESULT_JSON = json;

  // 한 참가자(sid 하나)가 4블록을 돌기 때문에 키에 stim·mode가 들어간다
  try {
    window.localStorage.setItem('ad_log_' + CFG.sid + '_' + STIM + '_' + CFG.mode, json);
  } catch (e) {
    /* file:// 이나 저장 용량 초과 — postMessage 가 정식 경로이므로 진행을 막지 않는다 */
  }

  try {
    window.parent.postMessage({ type: 'AD_DONE', payload: LOG }, '*');
  } catch (e) {
    /* 러너 없이 단독 실행 중 */
  }

  return LOG;
}

export function isFinished() { return finished; }
