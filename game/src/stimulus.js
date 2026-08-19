/* ==========================================================
 * stimulus.js — 자극 ↔ 통합 러너 인터페이스 (INTEGRATION.md 1·2·3장 구현)
 *
 * 이 파일에는 게임 로직이 없다. URL 파라미터를 읽고, 로그를 스키마대로 채우고,
 * 종료 시 러너에 통지하는 일만 한다. 세탁 자극(laundry-ad/scenes.js)의
 * 같은 역할 코드와 필드 이름·의미가 1:1로 맞아야 한다.
 * ========================================================== */

import SFX from './sfx';

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
  /* 실패 화면에서 [되돌리기]가 뜬 뒤 실제로 누르기까지 (초).
   * 예전에는 광고가 알아서 되감았다. 참가자가 누르게 바꾸면서 이 값이 생겼고,
   * 개입 조건의 재생 길이가 참가자마다 달라지는 원인이기도 하다.
   * watch 에는 되감기 자체가 없으므로 null 이다. 세탁 자극도 같은 이름으로 기록한다. */
  T_REWIND: null,
  HINT_SHOWN: 0,          // 게임에는 힌트 연출이 없어 항상 0
  /* 종료 카드의 [지금 다운로드] 클릭 1/0. 예전에는 게임에 CTA 가 없어 null 이었다 —
   * 세탁 쪽에만 CTA 가 있으면 이 열은 두 자극을 비교할 수 없는 열이 된다. */
  CTA_CLICK: 0,
  REDUCED_MOTION: readsReducedMotion(),
  /* 소리가 실제로 났는지 1/0, 해당 없음(sound=0·장치 없음)이면 null.
   * 자동재생 정책에 막히면 그 참가자만 무음으로 본 것이라, 이 값을 안 남기면
   * 분석에서 소리를 통제했다고 말할 수 없다. 세탁 자극도 같은 이름으로 기록한다. */
  AUDIO_OK: null,
  SFX_COUNT: 0,           // 낸 신호 수(들렸는지와 무관) — 자극 간 청각 밀도 비교용
  // --- 게임 전용 ---
  RESULT: '',             // scripted_fail | rescue_success | rescue_fail
  FAIL_REASON: null,      // 마지막 실패 사유 문자열 (성공으로 끝나면 그대로 null)
  COLLISION_T: null,      // 초, 자극 시작~자동재생 충돌
  POWER_END: null,
  GATES_PASSED: 0,
  VER_FALLBACK: 0         // 요청한 ver 의 타임라인이 없어 A로 대체됨 (A·B 가 다 있는 지금은 늘 0)
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
 *
 * @param {{endAt?: number}} [opts] endAt 은 종료로 칠 시각(ms). CTA 클릭처럼
 *   "누른 순간"이 종료인 경우에 넘긴다 — 안 넘기면 지금 시각을 쓴다.
 *   세탁 자극의 Engine.finish({endAt}) 와 같은 뜻이다.
 */
export function finish(opts) {
  if (finished) return LOG;
  finished = true;

  LOG.t_end = (opts && opts.endAt) || Date.now();
  LOG.DWELL_TOTAL = LOG.t_start ? round2((LOG.t_end - LOG.t_start) / 1000) : 0;

  // 종료 시점의 실제 재생 상태를 읽는다 — 도중에 잠금이 풀렸을 수 있다
  LOG.AUDIO_OK = SFX.audioOk();
  LOG.SFX_COUNT = SFX.fired;
  SFX.stopBed();   // 잦아들며 꺼진다 — 아래 로그 마감은 이걸 기다리지 않는다

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
