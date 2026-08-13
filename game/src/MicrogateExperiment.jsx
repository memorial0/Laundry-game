/* ==========================================================
 * MicrogateExperiment — 마이크로게이트 실패-수정형 게임 자극
 *
 * 이 컴포넌트는 **자극 하나만** 재생한다. 참가자 ID·실험 안내·설문·최종 비교·
 * CSV 내보내기는 전부 통합 러너(session.html)가 맡는다. 규격은 INTEGRATION.md.
 *
 *   ?mode=watch      실패까지 자동 재생하고 끝난다 (옛 이름 fail)
 *   ?mode=intervene  실패 → 되감기 → 참가자가 직접 구출 (옛 이름 rewind)
 *   ?mode=tutorial   조작 연습. 첫 게임 블록 직전에 러너가 한 번만 띄운다
 * ========================================================== */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CFG, LOG, IS_TUTORIAL, IS_INTERVENE, finish, secondsSince } from './stimulus';


/** 자극 하나의 진행 단계 — 러너가 붙기 전의 STAGES(인트로·설문·완료)는 전부 없앴다.
 *  시작 화면도 없다. 세탁 자극과 마찬가지로 러너가 iframe 을 띄우는 순간 바로 재생된다. */
const STAGES = {
  PLAY: 'play',
  ENDED: 'ended'    // 종료 통지 후 러너가 화면을 걷어갈 때까지의 대기 화면
};

/* 캔버스 좌표계 — 로직은 이 크기 안에서만 계산한다(화면 크기와 무관).
 *
 * 480×853 은 9:16 이다(480 × 16/9 = 853.3). 세탁 자극과 러너의 자극 틀이 9:16 이라
 * 여기에 맞춰야 두 자극이 화면에서 같은 크기를 차지한다. 예전 720(2:3)일 때는
 * 위아래에 검은 띠가 남아 게임만 틀의 84% 만 채웠다.
 *
 * 높이를 늘려도 **게임 진행은 하나도 바뀌지 않는다.** 배의 y 는 550 고정이고,
 * 게이트·적은 y=-120 에서 생겨 배까지 늘 670px 를 이동한다 — 즉 사건이 일어나는 시각도,
 * 참가자가 반응할 시간도 그대로다. 늘어난 133px 는 전부 배 **아래쪽** 빈 우주다.
 * height 를 쓰는 곳은 배경·격자·중앙 문구·별 순환뿐이다.
 *
 * 그래서 CANVAS_W 는 절대 못 바꾼다 — 타임라인의 게이트 x·w 가 전부 이 폭 기준이다. */
const CANVAS_W = 480;
const CANVAS_H = 853;

/* 로직 틱 — 타임라인의 t 단위가 곧 이 틱이다. 60틱 = 1초.
 * 화면 주사율이 얼마든 1초에 TICK_HZ 번만 돈다. */
const TICK_HZ = 60;
const TICK_MS = 1000 / TICK_HZ;
const MAX_FRAME_MS = 250;        // 한 프레임에서 인정할 최대 경과 시간
const MAX_CATCHUP_STEPS = 5;     // 밀렸을 때 한 프레임에 몰아 돌릴 틱 수 상한

/** 초 → 타임라인 틱 */
const sec = s => Math.round(s * TICK_HZ);

/* 자극 길이 — 세탁 자극(SPEC 3장: watch 31초, intervene 55초 고정 + 조작 시간)에 맞춘다.
 * 여기 숫자만 고치고 test/smoke.cjs 로 실측해 확인한다. */
const RESCUE_SEC = 20.3;    // 개입 구간에서 살아남아야 하는 시간
const TUTORIAL_SEC = 8;     // 조작 연습 길이
const REWIND_SEC = 14;      // 실패 지점에서 되감아 돌아가는 깊이 (되돌림 기록 상한이기도 하다).
                            // 자동 조종의 첫 오판(13.7초)보다 앞으로 돌아가야 한다 —
                            // 이미 손해를 본 상태에서 시작하면 참가자가 만회할 수 없다
const REWIND_FLOOR_SEC = 3; // 아무리 되감아도 이 시각 이전으로는 가지 않는다
const REWIND_SPEED = 15;    // 되감기 한 틱에 되돌릴 기록 수 — 클수록 빨리 되감긴다

/* ----------------------------------------------------------
 * 타임라인 — t 는 초. 게이트는 좌/우 두 상자 중 하나를 지나며 파워가 변하고,
 * 적은 파워가 HP 이상일 때만 통과한다(그만큼 파워가 깎인다).
 *
 * autoTarget 은 **자동 재생이 겨냥할 x 좌표**다. 즉 "광고 속 자동 조종이 어떤
 * 선택을 하는가"를 여기서 정한다. 실패는 조작 미숙이 아니라 이 선택의 결과여야 한다 —
 * 세탁 자극에서 실패 원인을 "시트를 넣지 않음" 하나로 제한한 것과 같은 요구다.
 * ---------------------------------------------------------- */

const gate = (t, left, right, autoTarget) => {
  const g = { type: 'gate', t: sec(t), x1: left.x, w1: left.w, p1: left.p, x2: right.x, w2: right.w, p2: right.p };
  if (autoTarget != null) g.autoTarget = autoTarget;
  return g;
};
const foe = (t, x, w, h, hp) => ({ type: 'enemy', t: sec(t), x, w, h, hp });

const TUTORIAL_TIMELINE = [
  gate(0.7, { x: 20, w: 180, p: 10 }, { x: 280, w: 180, p: 5 }),
  foe(2.0, 140, 200, 60, 3),
  gate(3.3, { x: 20, w: 180, p: 5 }, { x: 280, w: 180, p: 15 }),
  foe(5.0, 80, 320, 80, 8)
];

/* ver A.
 * 게이트마다 **이득 상자와 손해 상자**가 한 쌍이다. 손해 쪽이 마이너스여야 선택이 선택이 된다 —
 * 둘 다 플러스면 아무 데나 지나도 파워가 올라 "개입이 결과를 바꾼다"는 조작이 성립하지 않는다.
 *
 * 자동 조종(autoTarget)은 전반에는 맞게 고르다가 후반에 계속 손해 쪽을 골라 파워를 잃고,
 * 마지막 큰 적 앞에서 멈춘다. 인물을 무능하게 그리지 않기 위해 후반에도 몇 번은 맞게 고른다.
 * 실패 지점 이후에도 게이트·적이 이어진다 — 개입 조건에서 참가자가 그 구간을 직접 지나기 때문이다.
 *
 * 적은 x 폭이 좁으면 피할 수 있고, 화면을 거의 채우면 파워로만 통과한다.
 */
const MAIN_TIMELINE_A = [
  gate(0.7, { x: 20, w: 210, p: 8 }, { x: 250, w: 210, p: -4 }, 125),    // 이득 쪽
  foe(2.0, 20, 440, 60, 4),
  gate(3.3, { x: 20, w: 200, p: -4 }, { x: 240, w: 220, p: 7 }, 350),    // 이득 쪽
  foe(4.6, 300, 160, 60, 5),
  gate(5.9, { x: 20, w: 230, p: 8 }, { x: 270, w: 190, p: -5 }, 135),    // 이득 쪽
  foe(7.2, 20, 440, 70, 6),
  gate(8.5, { x: 20, w: 190, p: -5 }, { x: 230, w: 230, p: 7 }, 345),    // 이득 쪽
  foe(9.8, 20, 440, 70, 7),
  gate(11.1, { x: 20, w: 220, p: 9 }, { x: 260, w: 200, p: -5 }, 130),   // 이득 쪽
  foe(12.4, 20, 440, 80, 8),
  gate(13.7, { x: 20, w: 200, p: 10 }, { x: 240, w: 220, p: -8 }, 350),  // ← 손해 쪽: 자동 조종의 첫 오판
  foe(15.0, 40, 180, 60, 5),
  gate(16.3, { x: 20, w: 230, p: -8 }, { x: 270, w: 190, p: 10 }, 135),  // ← 손해 쪽
  gate(17.6, { x: 20, w: 210, p: 10 }, { x: 250, w: 210, p: -8 }, 125),  // 이득 쪽 (계속 틀리지는 않는다)
  foe(18.9, 260, 200, 60, 4),
  gate(20.2, { x: 20, w: 200, p: 10 }, { x: 240, w: 220, p: -8 }, 350),  // ← 손해 쪽
  gate(21.5, { x: 20, w: 220, p: -8 }, { x: 260, w: 200, p: 10 }, 360),  // 이득 쪽
  foe(22.8, 20, 440, 70, 6),
  gate(24.1, { x: 20, w: 210, p: 10 }, { x: 250, w: 210, p: -8 }, 125),  // 이득 쪽
  gate(25.4, { x: 20, w: 230, p: -8 }, { x: 270, w: 190, p: 10 }, 135),  // ← 손해 쪽: 큰 적 직전에 파워가 모자라진다
  foe(26.2, 20, 440, 100, 24),                                           // ← 실패 지점: 파워가 모자란다
  /* 여기부터는 개입 조건에서만 실제로 지나가는 구간이다 */
  gate(28.0, { x: 20, w: 200, p: 10 }, { x: 240, w: 220, p: -8 }),
  foe(29.3, 20, 440, 80, 14),
  gate(30.6, { x: 20, w: 220, p: -8 }, { x: 260, w: 200, p: 11 }),
  foe(31.9, 60, 200, 70, 10),
  gate(33.2, { x: 20, w: 210, p: 11 }, { x: 250, w: 210, p: -8 }),
  foe(34.5, 20, 440, 90, 14),
  gate(35.8, { x: 20, w: 230, p: -8 }, { x: 270, w: 190, p: 12 }),
  foe(37.1, 20, 440, 90, 16)
];

/* ver B — A 의 평행 자극.
 *
 * 같은 것: 사건 수(게이트 16 · 적 13), 각 사건의 시각, 이득/손해 값, 적 HP,
 *          자동 조종이 오판하는 지점(13.7 · 16.3 · 20.2 · 25.4), 실패 지점(26.2초).
 * 다른 것: 이득 상자가 나오는 좌우 패턴과 적의 좌우 위치.
 *
 * 즉 참가자가 겪는 난이도와 노출 시간은 같고, 눈에 보이는 배치만 다르다.
 * 같은 참가자가 시청·개입을 모두 겪는 설계라서, 두 번째 노출을 기억으로 되풀이할 수 없어야 한다.
 * A 를 좌우로 뒤집기만 하면 금방 알아채므로 이득 쪽 순서 자체를 다르게 뒀다.
 * 좌우 패턴에는 두 가지 제약이 걸린다.
 *  - 전부 뒤집으면 정확한 거울상이라 "아까 그거 뒤집은 것"으로 읽힌다 → 일부는 A 와 같은 쪽에 둔다.
 *  - 같은 쪽이 세 번 이상 이어지면 한자리에 가만히 있는 배가 그 줄을 그대로 타고 가
 *    무조작으로도 구출에 성공한다(실제로 그랬다) → 같은 쪽 연속은 최대 2회로 제한한다.
 *   A: 좌우 좌우 좌 좌우 좌좌 우 좌우 좌우 좌우
 *   B: 우좌 우좌 우 좌좌 우우 좌 좌우 우좌 우좌
 */
const MAIN_TIMELINE_B = [
  gate(0.7, { x: 20, w: 210, p: -4 }, { x: 250, w: 210, p: 8 }, 355),    // 이득 쪽
  foe(2.0, 20, 440, 60, 4),
  gate(3.3, { x: 20, w: 220, p: 7 }, { x: 260, w: 200, p: -4 }, 130),    // 이득 쪽
  foe(4.6, 20, 160, 60, 5),
  gate(5.9, { x: 20, w: 220, p: -5 }, { x: 260, w: 200, p: 8 }, 360),    // 이득 쪽
  foe(7.2, 20, 440, 70, 6),
  gate(8.5, { x: 20, w: 230, p: 7 }, { x: 270, w: 190, p: -5 }, 135),    // 이득 쪽
  foe(9.8, 20, 440, 70, 7),
  gate(11.1, { x: 20, w: 200, p: -5 }, { x: 240, w: 220, p: 9 }, 350),   // 이득 쪽
  foe(12.4, 20, 440, 80, 8),
  gate(13.7, { x: 20, w: 200, p: 10 }, { x: 240, w: 220, p: -8 }, 350),  // ← 손해 쪽: 자동 조종의 첫 오판
  foe(15.0, 260, 180, 60, 5),
  gate(16.3, { x: 20, w: 210, p: 10 }, { x: 250, w: 210, p: -8 }, 355),  // ← 손해 쪽
  gate(17.6, { x: 20, w: 210, p: -8 }, { x: 250, w: 210, p: 10 }, 355),  // 이득 쪽 (계속 틀리지는 않는다)
  foe(18.9, 20, 200, 60, 4),
  gate(20.2, { x: 20, w: 220, p: -8 }, { x: 260, w: 200, p: 10 }, 130),  // ← 손해 쪽
  gate(21.5, { x: 20, w: 200, p: 10 }, { x: 240, w: 220, p: -8 }, 120),  // 이득 쪽
  foe(22.8, 20, 440, 70, 6),
  gate(24.1, { x: 20, w: 230, p: 10 }, { x: 270, w: 190, p: -8 }, 135),  // 이득 쪽
  gate(25.4, { x: 20, w: 190, p: -8 }, { x: 230, w: 230, p: 10 }, 115),  // ← 손해 쪽: 큰 적 직전에 파워가 모자라진다
  foe(26.2, 20, 440, 100, 24),                                           // ← 실패 지점: 파워가 모자란다
  /* 여기부터는 개입 조건에서만 실제로 지나가는 구간이다 */
  gate(28.0, { x: 20, w: 200, p: -8 }, { x: 240, w: 220, p: 10 }),
  foe(29.3, 20, 440, 80, 14),
  gate(30.6, { x: 20, w: 220, p: 11 }, { x: 260, w: 200, p: -8 }),
  foe(31.9, 220, 200, 70, 10),
  gate(33.2, { x: 20, w: 210, p: -8 }, { x: 250, w: 210, p: 11 }),
  foe(34.5, 20, 440, 90, 14),
  gate(35.8, { x: 20, w: 230, p: 12 }, { x: 270, w: 190, p: -8 }),
  foe(37.1, 20, 440, 90, 16)
];

const TIMELINES = { A: MAIN_TIMELINE_A, B: MAIN_TIMELINE_B };

/* 평행성 검사(test/parallel.cjs)가 두 버전을 뜯어볼 수 있도록 내보낸다.
 * 자극 동작에는 쓰이지 않는다 — 세탁 자극이 window.AD_ART 를 노출하는 것과 같은 목적이다. */
if (typeof window !== 'undefined') window.AD_TIMELINES = TIMELINES;

const resolveTimeline = () => {
  if (IS_TUTORIAL) return TUTORIAL_TIMELINE;
  const wanted = TIMELINES[CFG.ver];
  if (!wanted) {
    LOG.VER_FALLBACK = 1;
    return MAIN_TIMELINE_A;
  }
  return wanted;
};

const MicrogateExperiment = () => {
  const [stage, setStage] = useState(STAGES.PLAY);
  const [gamePhase, setGamePhase] = useState('none');
  const [gameResult, setGameResult] = useState('');

  const canvasRef = useRef(null);
  const reqRef = useRef(null);
  const gameState = useRef({
    ship: { x: 220, y: 550, w: 40, h: 40, power: 10, isDead: false, vx: 0, vy: 0, ang: 0, av: 0 },
    gates: [], enemies: [], stars: [], particles: [], rings: [], speed: 5, time: 0, eventIdx: 0, history: [], rescueGoal: 0,
    flash: 0, slowFactor: 1, timeline: MAIN_TIMELINE_A,
    shake: 0, resultAnim: { type: '', t: 0 }, vignette: 0, failReason: '', isEnding: false
  });
  const input = useRef({ left: false, right: false, mouseX: null });

  /* 로그용 시각 — 렌더 사이에 값이 상하지 않도록 state 가 아니라 ref 에 둔다 */
  const marks = useRef({ interveneStart: 0, firstDrag: 0 });

  const initGame = () => {
    gameState.current = {
      ship: { x: 220, y: 550, w: 40, h: 40, power: 10, isDead: false, vx: 0, vy: 0, ang: 0, av: 0 },
      gates: [], enemies: [], stars: Array.from({ length: 30 }, () => ({ x: Math.random() * CANVAS_W, y: Math.random() * CANVAS_H, s: 1 + Math.random() * 3 })),
      particles: [], rings: [], speed: 5, time: 0, eventIdx: 0, history: [], rescueGoal: 0,
      flash: 0, slowFactor: 1,
      timeline: resolveTimeline(),
      shake: 0, resultAnim: { type: '', t: 0 }, vignette: 0, failReason: '', isEnding: false
    };
    // 튜토리얼은 처음부터 참가자가 조작한다. 본 자극은 두 조건 모두 자동 재생 실패로 시작한다.
    setGamePhase(IS_TUTORIAL ? 'tutorial_play' : 'autoplay_fail_watch');
    input.current = { left: false, right: false, mouseX: null };
  };

  /* 마운트 즉시 재생 — 시작 버튼이 없다(세탁 자극과 동일).
   * StrictMode 는 개발 모드에서 effect 를 두 번 실행하므로 t_start 가 덮어써지지 않게 막는다. */
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    initGame();
    LOG.t_start = Date.now();
    marks.current = { interveneStart: 0, firstDrag: 0 };
  }, []);

  const spawnParticles = (x, y, count, color, speed = 5, size = 3) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const s = Math.random() * speed + 1;
      gameState.current.particles.push({
        x, y, vx: Math.cos(angle) * s, vy: Math.sin(angle) * s,
        life: 1.0, decay: 0.015 + Math.random() * 0.02, color, size: (2 + Math.random() * size)
      });
    }
  };

  /**
   * 자극 종료 — 로그를 마감하고 러너에 통지한다.
   * @param {'scripted_fail'|'rescue_success'|'rescue_fail'|'tutorial_done'|'tutorial_fail'} result
   */
  const endStimulus = useCallback((result) => {
    // 같은 프레임에서 두 번 불리는 것을 막는 동기 가드
    if (gameState.current.isEnding) return;
    gameState.current.isEnding = true;

    const state = gameState.current;
    const success = result === 'rescue_success' || result === 'tutorial_done';

    if (success) {
      /* 조건 이름을 화면에 쓰지 않는다 — '개입'은 이 연구가 비교하는 형식의 이름이다.
       * 결과만 말하고, 무엇을 조작한 연구인지는 디브리핑에서 고지한다. */
      state.resultAnim = { type: result === 'rescue_success' ? '성공' : '연습 완료', t: 1.0 };
      state.vignette = -2.5; state.flash = 1.0; state.shake = 12;
      state.ship.vy = -18; state.ship.vx = 0;
      spawnParticles(state.ship.x + state.ship.w / 2, state.ship.y + state.ship.h / 2, 100, '#00ffff', 18, 6);
      for (let i = 0; i < 4; i++) {
        setTimeout(() => {
          state.rings.push({ x: state.ship.x + state.ship.w / 2, y: state.ship.y + state.ship.h / 2, r: 10, life: 1.0, speed: 12 + i * 4, color: i % 2 === 0 ? '#ffffff' : '#00ffff' });
        }, i * 100);
      }
      if (result === 'rescue_success') {
        state.failReason = '결과가 달라졌습니다!';
        setTimeout(() => { spawnParticles(state.ship.x + state.ship.w / 2, state.ship.y + state.ship.h / 2, 150, '#ffffff', 25, 4); state.flash = 1.0; state.shake = 25; state.vignette = -3.0; }, 300);
      } else {
        state.failReason = '조작을 익혔습니다';
      }
      setGameResult('success'); setGamePhase('ended');
    } else {
      state.resultAnim = { type: 'FAILURE', t: 1.0 }; state.vignette = 1.0; setGameResult('fail');
      setTimeout(() => { setGamePhase('ended'); }, 800);
    }

    /* --- 로그 마감 (INTEGRATION.md 3장) --- */
    LOG.RESULT = result;
    LOG.POWER_END = state.ship.power;
    if (IS_INTERVENE) {
      LOG.INT_DONE = result === 'rescue_success' ? 1 : 0;
      LOG.DWELL_INT = secondsSince(marks.current.interveneStart);
      LOG.T_MANIP = secondsSince(marks.current.firstDrag);
    }

    const delay = success ? 3500 : 2500;
    setTimeout(() => {
      finish();               // postMessage + localStorage — 러너가 다음 블록으로 넘긴다
      setStage(STAGES.ENDED);
    }, delay);
  }, []);

  const checkCollisions = (state, onFail) => {
    const s = state.ship;
    state.gates.forEach(g => {
      if (!g.passed && g.y + 40 > s.y && g.y < s.y + s.h) {
        if (s.x + s.w / 2 > g.x1 && s.x + s.w / 2 < g.x1 + g.w1) {
          state.ship.power += g.p1; g.passed = true; LOG.GATES_PASSED++;
          spawnParticles(s.x + s.w / 2, g.y + 20, 15, g.p1 > 0 ? '#00ffcc' : '#ff3366', 4);
        }
        else if (s.x + s.w / 2 > g.x2 && s.x + s.w / 2 < g.x2 + g.w2) {
          state.ship.power += g.p2; g.passed = true; LOG.GATES_PASSED++;
          spawnParticles(s.x + s.w / 2, g.y + 20, 15, g.p2 > 0 ? '#00ffcc' : '#ff3366', 4);
        }
        if (state.ship.power <= 0) onFail('POWER DEPLETED');
      }
    });
    state.enemies.forEach(e => {
      if (!e.dead && s.x < e.x + e.w && s.x + s.w > e.x && s.y < e.y + e.h && s.y + s.h > e.y) {
        if (state.ship.power >= e.hp) {
          state.ship.power -= e.hp; e.dead = true; state.shake = 12; state.flash = 0.35;
          spawnParticles(e.x + e.w / 2, e.y + e.h / 2, 20, '#ff3366', 7);
        }
        else onFail(`HP ${e.hp} > POWER ${state.ship.power}`);
      }
    });
  };

  /* 로직 한 틱 — 항상 1/TICK_HZ 초에 해당한다. 그리기는 하지 않는다.
   * 프레임마다 부르면 화면 주사율에 따라 자극 길이가 달라지므로 절대 그렇게 부르지 말 것. */
  const stepGame = useCallback(() => {
    const state = gameState.current;
    const width = CANVAS_W, height = CANVAS_H;

    if (state.eventIdx < state.timeline.length && state.time >= state.timeline[state.eventIdx].t) {
      const ev = state.timeline[state.eventIdx];
      if (ev.type === 'gate') state.gates.push({ ...ev, y: -120, passed: false });
      else if (ev.type === 'enemy') state.enemies.push({ ...ev, y: -120, dead: false });
      state.eventIdx++;
    }

    const currentSpeed = state.speed * state.slowFactor;
    state.particles = state.particles.filter(p => p.life > 0);
    state.particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.life -= p.decay; });
    state.rings = state.rings.filter(r => r.life > 0);
    state.rings.forEach(r => { r.r += r.speed || 5; r.life -= 0.02; });

    state.stars.forEach(s => {
      const starSpeed = gameResult === 'success' && gamePhase === 'ended' ? currentSpeed * 8 : currentSpeed;
      s.y += starSpeed * s.s * 0.5;
      if (s.y > height) { s.y = -10; s.x = Math.random() * width; }
    });

    if (state.ship.isDead) {
      state.ship.x += state.ship.vx; state.ship.y += state.ship.vy; state.ship.ang += state.ship.av;
      state.ship.vx *= 0.95; state.ship.vy *= 0.95; state.ship.av *= 0.95;
      state.slowFactor = Math.max(0.05, state.slowFactor * 0.9);
    } else if (gameResult === 'success' && gamePhase === 'ended') {
      state.ship.y += state.ship.vy; state.ship.vy *= 0.96; state.time += 4;
    }

    if ((gamePhase === 'autoplay_fail_watch' || gamePhase === 'rewind_rescue' || gamePhase === 'tutorial_play') && !state.ship.isDead && !state.isEnding) {
      if (gamePhase === 'autoplay_fail_watch') {
        state.time += state.slowFactor;
        const currentGate = state.gates.find(g => !g.passed && g.y < state.ship.y);
        if (currentGate && currentGate.autoTarget) {
          state.ship.x += (currentGate.autoTarget - (state.ship.x + state.ship.w / 2)) * 0.04;
          state.ship.x += Math.sin(state.time * 0.1) * 0.5;
        }
        if (IS_INTERVENE) {
          // 되감기용 되돌림 기록. watch 는 되감지 않으므로 쌓지 않는다.
          state.history.push({ ship: { ...state.ship }, gates: state.gates.map(g => ({ ...g })), enemies: state.enemies.map(e => ({ ...e })), time: state.time, eventIdx: state.eventIdx });
          if (state.history.length > sec(REWIND_SEC)) state.history.shift();
        }
        const imminentEnemy = state.enemies.find(e => !e.dead && e.y + e.h > state.ship.y - 80 && e.y < state.ship.y + state.ship.h);
        if (imminentEnemy && state.ship.power < imminentEnemy.hp) {
          state.slowFactor = Math.max(0.1, state.slowFactor - 0.04);
        } else { state.slowFactor = Math.min(1.0, state.slowFactor + 0.1); }
      } else {
        state.time++; state.slowFactor = 1.0;
        if (input.current.mouseX !== null) {
          state.ship.x += (input.current.mouseX - state.ship.w / 2 - state.ship.x) * 0.2;
          if (state.ship.x < 0) state.ship.x = 0; if (state.ship.x > width - state.ship.w) state.ship.x = width - state.ship.w;
        }
      }
      state.gates.forEach(g => g.y += currentSpeed);
      state.enemies.forEach(e => e.y += currentSpeed);
      checkCollisions(state, (reason) => {
        state.ship.isDead = true; state.ship.vx = (Math.random() - 0.5) * 15; state.ship.vy = (Math.random() * 5 + 5); state.ship.av = (Math.random() - 0.5) * 0.4;
        state.flash = 0.8; state.shake = 35; state.vignette = 1.0; state.failReason = reason;
        LOG.FAIL_REASON = reason;   // 마지막 실패 사유 — watch 는 각본된 실패, intervene 은 구출 실패
        spawnParticles(state.ship.x + state.ship.w / 2, state.ship.y + state.ship.h / 2, 35, '#ffcc33', 12, 4);
        spawnParticles(state.ship.x + state.ship.w / 2, state.ship.y + state.ship.h / 2, 25, '#ff3366', 8, 6);

        if (IS_TUTORIAL) { endStimulus('tutorial_fail'); return; }
        if (gamePhase === 'rewind_rescue') { endStimulus('rescue_fail'); return; }
        if (!IS_INTERVENE) {
          // watch: 실패가 곧 결말이다. 되감기·구출은 재생하지 않는다.
          LOG.COLLISION_T = secondsSince(LOG.t_start);
          endStimulus('scripted_fail');
          return;
        }
        // intervene: 실패를 충분히 보여 준 뒤 되감는다
        LOG.COLLISION_T = secondsSince(LOG.t_start);
        setTimeout(() => {
          if (gamePhase !== 'ended') {
            setGamePhase('rewind_watch');
            setTimeout(() => { setGamePhase('rewind_back'); }, 1000);
          }
        }, 800);
      });
      if (IS_TUTORIAL && state.time > sec(TUTORIAL_SEC)) endStimulus('tutorial_done');
      // 구출 성공은 되감긴 지점 기준 상대 시간이다. 절대 시각으로 두면 자동 재생 길이를
      // 바꾸는 순간 구출 구간이 늘거나 사라진다.
      if (gamePhase === 'rewind_rescue' && state.rescueGoal && state.time >= state.rescueGoal) {
        endStimulus('rescue_success');
      }
    } else if (gamePhase === 'rewind_back') {
      if (state.history.length > 0 && state.time > sec(REWIND_FLOOR_SEC)) {
        for (let i = 0; i < REWIND_SPEED; i++) { if (state.history.length > 0) { const p = state.history.pop(); Object.assign(state, p); } }
      } else if (!marks.current.interveneStart) {
        /* setGamePhase 는 비동기라 다음 렌더까지 이 분기가 몇 프레임 더 돌 수 있다.
         * 기준 시각을 덮어쓰지 않도록 진입을 한 번으로 막는다. */
        state.rescueGoal = state.time + sec(RESCUE_SEC);   // 여기서부터 RESCUE_SEC 을 버티면 성공
        marks.current.interveneStart = Date.now();         // 개입 구간 진입 — DWELL_INT 의 기준점
        setGamePhase('rewind_rescue');
      }
    }

    // 시각 효과 감쇠도 틱에 묶는다 — 그리는 쪽에 두면 주사율에 따라 지속 시간이 달라진다
    if (state.shake > 0) state.shake *= 0.85;
    if (state.flash > 0) state.flash -= 0.04;
    if (state.vignette !== 0 && (gamePhase !== 'ended' || gameResult === 'success')) {
      state.vignette *= 0.97;
      if (Math.abs(state.vignette) < 0.01) state.vignette = 0;
    }
    if (state.resultAnim.type && state.resultAnim.t > 0) {
      state.resultAnim.t -= state.resultAnim.type !== 'FAILURE' ? 0.004 : 0.01;
    }
  }, [gamePhase, gameResult, endStimulus]);

  /* 그리기 — 상태를 바꾸지 않는다. 프레임마다 한 번 부른다. */
  const renderGame = useCallback(() => {
    const state = gameState.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;

    ctx.save();
    if (state.shake > 0) ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
    ctx.fillStyle = '#050a10'; ctx.fillRect(0, 0, width, height);
    let gridAlpha = state.shake > 10 ? 0.35 : 0.05;
    if (gameResult === 'success' && gamePhase === 'ended') gridAlpha = 0.25;
    ctx.strokeStyle = gameResult === 'success' && gamePhase === 'ended' ? `rgba(0, 255, 255, ${gridAlpha})` : `rgba(0, 255, 204, ${gridAlpha})`;
    ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i < width; i += 40) { ctx.moveTo(i, 0); ctx.lineTo(i, height); }
    const gridY = ((state.time * (state.ship.isDead ? 0.5 : 2.8)) % 40);
    for (let i = gridY; i < height; i += 40) { ctx.moveTo(0, i); ctx.lineTo(width, i); }
    ctx.stroke();
    ctx.fillStyle = '#fff'; state.stars.forEach(s => { ctx.globalAlpha = s.s / 4; ctx.fillRect(s.x, s.y, s.s, s.s); });
    ctx.globalAlpha = 1.0;

    state.gates.forEach(g => {
      if (g.passed) return;
      const drawBox = (x, w, power) => {
        const isPos = power > 0; const color = isPos ? '#00ffcc' : '#ff3366';
        ctx.fillStyle = isPos ? 'rgba(0, 255, 204, 0.25)' : 'rgba(255, 50, 80, 0.25)'; ctx.strokeStyle = color; ctx.lineWidth = 3;
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, g.y, w, 40, 8); else ctx.rect(x, g.y, w, 40); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center'; ctx.fillText(isPos ? `+${power}` : power, x + w / 2, g.y + 26);
      };
      drawBox(g.x1, g.w1, g.p1); drawBox(g.x2, g.w2, g.p2);
    });

    state.enemies.forEach(e => {
      if (e.dead) return;
      ctx.fillStyle = '#ff3366'; ctx.fillRect(e.x, e.y, e.w, e.h); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(e.x, e.y, e.w, e.h);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center'; ctx.fillText(`HP ${e.hp}`, e.x + e.w / 2, e.y + e.h / 2 + 8);
    });

    state.particles.forEach(p => { ctx.globalAlpha = p.life; ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size); });
    ctx.globalAlpha = 1.0;

    ctx.save(); ctx.translate(state.ship.x + state.ship.w / 2, state.ship.y + state.ship.h / 2); ctx.rotate(state.ship.ang);
    if (!state.ship.isDead) {
      const isVictory = gameResult === 'success' && gamePhase === 'ended';
      ctx.fillStyle = isVictory ? '#ffffff' : '#00ffff'; ctx.globalAlpha = isVictory ? 0.9 : (0.5 + Math.random() * 0.5);
      const tLen = isVictory ? 80 : 35; ctx.beginPath(); ctx.moveTo(-12, 20); ctx.lineTo(12, 20); ctx.lineTo(0, tLen); ctx.fill();
      ctx.globalAlpha = 1.0; ctx.fillStyle = isVictory ? '#aaffff' : '#00ffcc';
      if (isVictory) { ctx.shadowColor = '#00ffff'; ctx.shadowBlur = 40; }
    } else { ctx.fillStyle = '#445566'; }
    ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(20, 20); ctx.lineTo(-20, 20); ctx.closePath(); ctx.fill();
    if (!state.ship.isDead) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
    ctx.shadowBlur = 0; ctx.restore();

    if (!state.ship.isDead) {
      const isVictory = gameResult === 'success' && gamePhase === 'ended';
      ctx.fillStyle = isVictory ? '#00ffff' : '#ffffff'; ctx.font = 'bold 22px monospace'; ctx.textAlign = 'center';
      if (isVictory) { ctx.shadowColor = '#00ffff'; ctx.shadowBlur = 15; }
      ctx.fillText(state.ship.power, state.ship.x + state.ship.w / 2, state.ship.y + state.ship.h + 28);
      ctx.shadowBlur = 0;
    }

    state.rings.forEach(r => { ctx.globalAlpha = r.life; ctx.strokeStyle = r.color || '#ffffff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke(); });
    ctx.globalAlpha = 1.0; ctx.restore();

    if (state.flash > 0) { const flashColor = gameResult === 'success' ? '200, 255, 255' : '255, 255, 255'; ctx.fillStyle = `rgba(${flashColor}, ${state.flash})`; ctx.fillRect(0, 0, width, height); }
    if (state.vignette !== 0) {
      const grad = ctx.createRadialGradient(width / 2, height / 2, width * 0.05, width / 2, height / 2, width * 0.95);
      if (state.vignette > 0) { grad.addColorStop(0, 'rgba(0, 0, 0, 0)'); grad.addColorStop(1, `rgba(100, 0, 10, ${state.vignette * 0.85})`); }
      else { grad.addColorStop(0, `rgba(0, 255, 255, ${Math.abs(state.vignette) * 0.3})`); grad.addColorStop(1, 'rgba(0, 0, 0, 0)'); }
      ctx.fillStyle = grad; ctx.fillRect(0, 0, width, height);
    }

    if (state.resultAnim.type) {
      const s = state.resultAnim; const progress = Math.min(1, (1 - s.t) * 5); const isSuccess = s.type !== 'FAILURE';
      const bounce = isSuccess ? Math.sin(progress * Math.PI) * 0.2 : 0; const scale = (0.4 + progress * 0.6) + bounce;
      const alpha = Math.min(1, progress * 3);
      ctx.save(); ctx.translate(width / 2, height / 2 - 80); ctx.scale(scale, scale); ctx.globalAlpha = alpha;
      ctx.fillStyle = isSuccess ? '#00ffff' : '#ff3366'; ctx.shadowColor = isSuccess ? 'rgba(0, 255, 255, 1.0)' : 'rgba(255, 0, 50, 0.8)'; ctx.shadowBlur = isSuccess ? 70 : 35; ctx.font = 'bold 98px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(s.type, 0, 0);
      if (state.failReason) {
        ctx.fillStyle = '#fff'; ctx.font = 'bold 32px monospace'; ctx.shadowBlur = 0; ctx.fillText(state.failReason, 0, 100);
        if (isSuccess) { ctx.font = 'bold 22px monospace'; ctx.fillStyle = '#00ffff'; ctx.fillText('▶ 결과를 성공적으로 바꿨습니다', 0, 145); }
        else { ctx.font = '18px monospace'; ctx.fillStyle = '#94a3b8'; ctx.fillText('더 나은 선택이 가능했습니다', 0, 145); }
      }
      ctx.restore();
    }

    if (gamePhase === 'rewind_watch' || gamePhase === 'rewind_back') {
      ctx.fillStyle = '#fff'; ctx.font = 'bold 40px monospace'; ctx.textAlign = 'center'; ctx.shadowColor = 'rgba(255, 50, 80, 0.8)'; ctx.shadowBlur = 20;
      ctx.fillText(gamePhase === 'rewind_watch' ? 'COLLISION!' : '◀◀ REWIND', width / 2, height / 2 + 80);
      ctx.shadowBlur = 0;
    }
    if (gamePhase === 'ended') { ctx.fillStyle = gameResult === 'success' ? 'rgba(0, 40, 30, 0.15)' : 'rgba(0, 0, 0, 0.45)'; ctx.fillRect(0, 0, width, height); }
  }, [gamePhase, gameResult, endStimulus]);

  /* 진행 상태를 밖으로 노출한다 — 테스트 하네스가 화면을 볼 수 없으므로 이 값으로 단계를 읽는다.
   * 세탁 자극이 window.AD_ENGINE 을 노출하는 것과 같은 목적이다. */
  useEffect(() => { window.AD_PHASE = gamePhase; }, [gamePhase]);
  useEffect(() => { window.AD_STATE = gameState.current; }, [stage]);

  /* 재생 루프 — 로직은 실제 경과 시간만큼 고정 간격으로 돌리고, 그리기는 프레임마다 한 번.
   * 프레임마다 로직을 한 번씩 돌리면 120Hz 화면에서 자극이 2배 빨리 끝난다. 참가자 기기에
   * 따라 노출 시간이 달라지면 안 되므로 여기서 주사율을 떼어 낸다. */
  useEffect(() => {
    if (stage !== STAGES.PLAY) return;
    let acc = 0;
    let last = 0;
    const loop = (now) => {
      reqRef.current = requestAnimationFrame(loop);
      if (!last) { last = now; renderGame(); return; }
      const dt = Math.min(now - last, MAX_FRAME_MS);   // 탭 복귀 등으로 크게 밀린 구간은 버린다
      last = now;

      if (gamePhase !== 'ended' || gameResult === 'success') {
        acc += dt;
        let steps = 0;
        while (acc >= TICK_MS && steps < MAX_CATCHUP_STEPS) { acc -= TICK_MS; stepGame(); steps++; }
        if (steps >= MAX_CATCHUP_STEPS) acc = 0;       // 따라잡기를 포기하고 현재 시점에 맞춘다
      }
      renderGame();
    };
    reqRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(reqRef.current);
  }, [stage, gamePhase, gameResult, stepGame, renderGame]);

  useEffect(() => {
    if (stage !== STAGES.PLAY || gamePhase === 'autoplay_fail_watch' || gamePhase === 'ended') return;
    const move = (e) => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.touches ? e.touches[0].clientX : e.clientX;
      input.current.mouseX = (x - rect.left) * (canvasRef.current.width / rect.width);
      // 개입 구간의 첫 조작 시각 — T_FIRST_DRAG
      if (gamePhase === 'rewind_rescue' && !marks.current.firstDrag) {
        marks.current.firstDrag = Date.now();
        LOG.T_FIRST_DRAG = secondsSince(marks.current.interveneStart);
      }
    };
    window.addEventListener('mousemove', move); window.addEventListener('touchmove', move);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('touchmove', move); };
  }, [stage, gamePhase]);

  return (
    <div className="microgate-app">
      {stage === STAGES.PLAY && (
        <div className="game-container">
          {CFG.debug && (
            <p className="dbg-line dbg-overlay">
              sid={CFG.sid} · mode={CFG.mode} · ver={CFG.ver} · block={String(CFG.block)} · {gamePhase}
              {LOG.VER_FALLBACK ? ' · ⚠ 해당 ver 타임라인 없음 → A 재생' : ''}
            </p>
          )}
          {IS_TUTORIAL && (
            <div className="tutorial-overlay" style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.7)', padding: '10px 20px', borderRadius: '20px', zIndex: 10, pointerEvents: 'none', width: 'auto', textAlign: 'center', color: '#00ffcc', border: '1px solid #00ffcc' }}>마우스/드래그로 좌우로 이동하여 파워를 높이세요!</div>
          )}
          <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="game-canvas"></canvas>
        </div>
      )}

      {stage === STAGES.ENDED && (
        <div className="card completion-card">
          <p style={{ textAlign: 'center' }}>{IS_TUTORIAL ? '연습이 끝났습니다.' : '이 광고가 끝났습니다.'}</p>
          <p className="dbg-line" style={{ textAlign: 'center' }}>잠시만 기다려 주세요…</p>
          {CFG.debug && <pre className="dbg-line">{JSON.stringify(LOG, null, 1)}</pre>}
        </div>
      )}
    </div>
  );
};

export default MicrogateExperiment;
