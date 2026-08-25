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
import SFX from './sfx';


/** 자극 하나의 진행 단계 — 러너가 붙기 전의 STAGES(인트로·설문·완료)는 전부 없앴다.
 *  시작 화면도 없다. 세탁 자극과 마찬가지로 러너가 iframe 을 띄우는 순간 바로 재생된다. */
const STAGES = {
  PLAY: 'play',
  ENDED: 'ended'    // 종료 통지 후 러너가 화면을 걷어갈 때까지의 대기 화면
};

/* ----------------------------------------------------------
 * 광고하는 앱 — 세탁 자극의 BRAND('클린가드')에 대응한다.
 *
 * 왜 있어야 하나
 *   설문 블록 D 는 "광고에 나온 **제품(앱)**"을 평가시키고, 블록 E 는 "나는 이 앱을
 *   다운로드할 의향이 있다"를 묻는다(survey.js). 화면에 앱이 없으면 그 7문항이
 *   가리킬 대상이 없다 — 세탁 조건 참가자는 클린가드를 보고 답하는데 게임 조건
 *   참가자는 아무것도 못 본 채 답하게 된다. 조건 간 비교가 성립하지 않는다.
 *
 * 지켜야 할 것 (세탁 자극과 같은 규칙)
 *   - 가상 앱이다. 실존 앱·상표·로고를 쓰지 않는다.
 *   - 과장 금지. "1위", "최고", "무한" 같은 표현을 쓰지 않는다.
 *   - 이름·문구는 여기만 고치면 카드 전체가 따라온다.
 * ---------------------------------------------------------- */
const APP = {
  name: '딥드리프트',
  genre: '한 손 심해 잠항 게임',
  message: '고르고, 뚫고, 살아남는 한 판 1분 잠항',
  /* cta 문구는 세탁 자극의 [지금 구매하기]와 짝이다. 두 자극의 버튼 문구가 다른 방식으로
   * 부추기면 CTA_CLICK 차이가 광고 형식이 아니라 문구 차이가 된다 — 바꾸지 말 것. */
  cta: '지금 다운로드',
  note: '무료 설치 · 인앱 결제 포함'
};

/* 제품 카드 길이 — 세탁 장면 10(제품 메시지 + CTA)과 같은 8초다.
 * CTA 를 누르면 그 시점에 끝난다(세탁과 동일). */
const PRODUCT_CARD_SEC = 8;

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

/* 한글이 들어가는 캔버스 문구용 글꼴.
 *
 * monospace 로 두면 안 된다 — 한글 글립을 가진 고정폭 글꼴이 있는 기기가 훨씬 적어서
 * OS 마다 제각각 다른 글꼴로 대체된다. 참가자마다 다른 화면을 보게 되면 그것 자체가
 * 자극 간 변량이다. 숫자·영문만 있는 배지(파워·HP·+N)는 monospace 그대로 둔다. */
const KO_FONT = '"Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", "Nanum Gothic", sans-serif';

/** 초 → 타임라인 틱 */
const sec = s => Math.round(s * TICK_HZ);

/* 자극 길이 — 세탁 자극(SPEC 3장: watch 31초, intervene 55초 고정 + 조작 시간)에 맞춘다.
 * 여기 숫자만 고치고 test/smoke.cjs 로 실측해 확인한다. */
/* 기뢰 요격 — 이 자극의 **유일한 반사신경 요소**다.
 *
 * 조작은 늘리지 않았다(좌우 이동 하나 그대로). 대신 게이트를 고르는 **동시에** 겨냥해야
 * 해서 주의가 갈리고, 그게 난이도가 된다. 새 버튼을 만들면 세탁 자극(1단계 드래그)과
 * 조작량이 더 벌어지고 연습(practice.js)도 늘려야 하므로 그 길은 택하지 않았다.
 *
 * 기뢰는 **안전한 물길의 반대쪽**에 놓인다 — 그래야 "맞히러 갈까, 안전한 쪽으로 갈까"가
 * 매번 실제 선택이 된다. 그냥 지나치면 파워가 깎이고, 그 손해가 실패로 이어질 수 있다.
 *
 * 시청 조건에서는 자동 조종이 **늘 요격에 성공한다**(위치와 무관하게 맞힌다). 광고 속
 * 자동 조종의 실패는 '선택' 때문이어야 하지 '손이 느려서'가 아니다 — 그래서 시청 조건의
 * 수치(POWER_END · GATES_PASSED · 실패 시각)는 기뢰를 넣기 전과 한 값도 안 달라진다. */
const MINE_R = 17;          // 기뢰 반지름 — 그림과 판정이 같은 값을 쓴다
const BEAM_HALF = 26;       // 빔이 닿는 좌우 폭(중심에서). 좁힐수록 겨냥이 어려워진다
const BEAM_REACH = 210;     // 빔이 닿는 거리(잠수정 위로). 짧을수록 반응 시간이 줄어든다
const MINE_COST = 7;        // 못 맞히고 지나치면 깎이는 파워

const RESCUE_SEC = 20.3;    // 개입 구간에서 살아남아야 하는 시간
const TUTORIAL_SEC = 8;     // 조작 연습 길이
const REWIND_SEC = 16;      // 실패 지점에서 되감아 돌아가는 깊이 (되돌림 기록 상한이기도 하다).
                            // 자동 조종의 첫 오판(5.7초)보다 앞으로 돌아가야 한다 —
                            // 이미 손해를 본 상태에서 시작하면 참가자가 만회할 수 없다.
                            // 도입부를 걷어내며 실패 지점이 8초 당겨졌으므로 이 값도 14→16 으로 늘렸다

/* 시작 파워.
 *
 * 왜 10 이 아니라 23 인가
 *   원래 타임라인은 0.7~7.2초에 자동 조종이 **전부 맞게 고르는** 도입부 6개 사건이 있었다.
 *   제품 카드 8초가 붙으면서 자극이 세탁(31초/55초)보다 8초 길어져 그 도입부를 들어냈는데,
 *   시작 파워를 그 구간을 통과했을 때의 값으로 올려 두면 **그 뒤 전개가 완전히 같아진다** —
 *   실패 지점도, 각 게이트에서의 파워도, 구출 난이도도 그대로고 길이만 8초 줄었다.
 *
 *   10 +8(게이트) −4(적) +7(게이트) −0 +8(게이트) −6(적) = 23
 *
 *   −0 자리는 옛 foe(4.6, x300~460) 이다. 배가 그 직후 게이트(autoTarget 135)를 향해
 *   왼쪽으로 이동하는 중이라 **좁은 적을 비껴간다** — 실측으로 확인한 값이다.
 *   여기를 −5 로 잘못 세어 18 로 두면 파워가 5 모자라 8.3초 게이트에서 바닥나고,
 *   실패가 18.2초가 아니라 10.4초에 일어나 각본이 통째로 무너진다(실제로 그랬다). */
const START_POWER = 23;
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
/** 기뢰 — x 는 그 구간에서 안전한 물길의 반대쪽에 둔다(위 MINE_R 주석 참고) */
const mine = (t, x) => ({ type: 'mine', t: sec(t), x });

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
 *
 * 도입부 6개 사건(옛 0.7~7.2초, 자동 조종이 전부 맞게 고르던 구간)은 걷어냈다.
 * 제품 카드 8초가 붙으면서 자극이 세탁(31초/55초)보다 8초 길어졌기 때문이다.
 * 그 구간의 순증(+13)을 START_POWER 에 얹어 두었으므로 **아래 전개는 예전과 완전히 같다** —
 * 각 게이트에서의 파워도, 실패 지점도, 구출 난이도도 그대로고 시각만 8초씩 앞당겨졌다.
 */
const MAIN_TIMELINE_A = [
  gate(0.5, { x: 20, w: 190, p: -5 }, { x: 230, w: 230, p: 7 }, 345),    // 이득 쪽
  foe(1.8, 20, 440, 70, 7),
  gate(3.1, { x: 20, w: 220, p: 9 }, { x: 260, w: 200, p: -5 }, 130),    // 이득 쪽
  foe(4.4, 20, 440, 80, 8),
  mine(5.05, 350),                                                       // 안전한 쪽(왼쪽 120)의 반대편
  gate(5.7, { x: 20, w: 200, p: 10 }, { x: 240, w: 220, p: -8 }, 350),   // ← 손해 쪽: 자동 조종의 첫 오판
  foe(7.0, 40, 180, 60, 5),
  gate(8.3, { x: 20, w: 230, p: -8 }, { x: 270, w: 190, p: 10 }, 135),   // ← 손해 쪽
  mine(9.0, 355),                                                        // 안전한 쪽(왼쪽 125)의 반대편
  gate(9.6, { x: 20, w: 210, p: 10 }, { x: 250, w: 210, p: -8 }, 125),   // 이득 쪽 (계속 틀리지는 않는다)
  foe(10.9, 260, 200, 60, 4),
  gate(12.2, { x: 20, w: 200, p: 10 }, { x: 240, w: 220, p: -8 }, 350),  // ← 손해 쪽
  mine(13.0, 125),                                                       // 안전한 쪽(오른쪽 360)의 반대편
  gate(13.5, { x: 20, w: 220, p: -8 }, { x: 260, w: 200, p: 10 }, 360),  // 이득 쪽
  foe(14.8, 20, 440, 70, 6),
  gate(16.1, { x: 20, w: 210, p: 10 }, { x: 250, w: 210, p: -8 }, 125),  // 이득 쪽
  mine(16.75, 120),                                                      // 안전한 쪽(오른쪽 365)의 반대편 — 실패 직전이라 가장 무겁다
  gate(17.4, { x: 20, w: 230, p: -8 }, { x: 270, w: 190, p: 10 }, 135),  // ← 손해 쪽: 큰 적 직전에 파워가 모자라진다
  foe(18.2, 20, 440, 100, 24),                                           // ← 실패 지점: 파워가 모자란다
  /* 여기부터는 개입 조건에서만 실제로 지나가는 구간이다 */
  gate(20.0, { x: 20, w: 200, p: 10 }, { x: 240, w: 220, p: -8 }),
  foe(21.3, 20, 440, 80, 14),
  gate(22.6, { x: 20, w: 220, p: -8 }, { x: 260, w: 200, p: 11 }),
  foe(23.9, 60, 200, 70, 10),
  gate(25.2, { x: 20, w: 210, p: 11 }, { x: 250, w: 210, p: -8 }),
  foe(26.5, 20, 440, 90, 14),
  gate(27.8, { x: 20, w: 230, p: -8 }, { x: 270, w: 190, p: 12 }),
  foe(29.1, 20, 440, 90, 16)
];

/* ver B — A 의 평행 자극.
 *
 * 같은 것: 사건 수(게이트 13 · 적 10), 각 사건의 시각, 이득/손해 값, 적 HP,
 *          자동 조종이 오판하는 지점(5.7 · 8.3 · 12.2 · 17.4), 실패 지점(18.2초).
 * 다른 것: 이득 상자가 나오는 좌우 패턴과 적의 좌우 위치.
 *
 * 즉 참가자가 겪는 난이도와 노출 시간은 같고, 눈에 보이는 배치만 다르다.
 * 같은 참가자가 시청·개입을 모두 겪는 설계라서, 두 번째 노출을 기억으로 되풀이할 수 없어야 한다.
 * A 를 좌우로 뒤집기만 하면 금방 알아채므로 이득 쪽 순서 자체를 다르게 뒀다.
 * 좌우 패턴에는 두 가지 제약이 걸린다.
 *  - 전부 뒤집으면 정확한 거울상이라 "아까 그거 뒤집은 것"으로 읽힌다 → 일부는 A 와 같은 쪽에 둔다.
 *  - 같은 쪽이 세 번 이상 이어지면 한자리에 가만히 있는 배가 그 줄을 그대로 타고 가
 *    무조작으로도 구출에 성공한다(실제로 그랬다) → 같은 쪽 연속은 최대 2회로 제한한다.
 *   A: 우좌 좌우 좌 좌우 좌우 좌 우좌 우
 *   B: 좌우 좌좌 우 우좌 좌우 우 좌우 좌
 */
const MAIN_TIMELINE_B = [
  gate(0.5, { x: 20, w: 230, p: 7 }, { x: 270, w: 190, p: -5 }, 135),    // 이득 쪽
  foe(1.8, 20, 440, 70, 7),
  gate(3.1, { x: 20, w: 200, p: -5 }, { x: 240, w: 220, p: 9 }, 350),    // 이득 쪽
  foe(4.4, 20, 440, 80, 8),
  mine(5.05, 350),                                                       // 안전한 쪽(왼쪽)의 반대편 — 이 판은 A·B 구조가 같아 자리도 같다
  gate(5.7, { x: 20, w: 200, p: 10 }, { x: 240, w: 220, p: -8 }, 350),   // ← 손해 쪽: 자동 조종의 첫 오판
  foe(7.0, 260, 180, 60, 5),
  gate(8.3, { x: 20, w: 210, p: 10 }, { x: 250, w: 210, p: -8 }, 355),   // ← 손해 쪽
  mine(9.0, 125),                                                        // 안전한 쪽(오른쪽 355)의 반대편 — A 와 좌우가 다르다
  gate(9.6, { x: 20, w: 210, p: -8 }, { x: 250, w: 210, p: 10 }, 355),   // 이득 쪽 (계속 틀리지는 않는다)
  foe(10.9, 20, 200, 60, 4),
  gate(12.2, { x: 20, w: 220, p: -8 }, { x: 260, w: 200, p: 10 }, 130),  // ← 손해 쪽
  mine(13.0, 355),                                                       // 안전한 쪽(왼쪽 120)의 반대편 — A 와 좌우가 다르다
  gate(13.5, { x: 20, w: 200, p: 10 }, { x: 240, w: 220, p: -8 }, 120),  // 이득 쪽
  foe(14.8, 20, 440, 70, 6),
  gate(16.1, { x: 20, w: 230, p: 10 }, { x: 270, w: 190, p: -8 }, 135),  // 이득 쪽
  mine(16.75, 120),                                                      // 안전한 쪽(오른쪽)의 반대편 — 이 판은 A·B 구조가 같아 자리도 같다
  gate(17.4, { x: 20, w: 190, p: -8 }, { x: 230, w: 230, p: 10 }, 115),  // ← 손해 쪽: 큰 적 직전에 파워가 모자라진다
  foe(18.2, 20, 440, 100, 24),                                           // ← 실패 지점: 파워가 모자란다
  /* 여기부터는 개입 조건에서만 실제로 지나가는 구간이다 */
  gate(20.0, { x: 20, w: 200, p: -8 }, { x: 240, w: 220, p: 10 }),
  foe(21.3, 20, 440, 80, 14),
  gate(22.6, { x: 20, w: 220, p: 11 }, { x: 260, w: 200, p: -8 }),
  foe(23.9, 220, 200, 70, 10),
  gate(25.2, { x: 20, w: 210, p: -8 }, { x: 250, w: 210, p: 11 }),
  foe(26.5, 20, 440, 90, 14),
  gate(27.8, { x: 20, w: 230, p: 12 }, { x: 270, w: 190, p: -8 }),
  foe(29.1, 20, 440, 90, 16)
];

const TIMELINES = { A: MAIN_TIMELINE_A, B: MAIN_TIMELINE_B };

/* 평행성 검사(test/parallel.cjs)가 두 버전을 뜯어볼 수 있도록 내보낸다.
 * 자극 동작에는 쓰이지 않는다 — 세탁 자극이 window.AD_ART 를 노출하는 것과 같은 목적이다. */
if (typeof window !== 'undefined') window.AD_TIMELINES = TIMELINES;

/* ----------------------------------------------------------
 * 심해 — 그림에만 쓰이는 값들.
 *
 * 여기 있는 것은 **전부 겉모습**이다. 타임라인·파워 계산·판정은 위쪽에 있고 이 아래로는
 * 내려오지 않는다. 세계관을 또 바꾸더라도 이 블록과 renderGame 만 손대면 되고,
 * 노출 시간(31.2초/55.4초)·난이도·A/B 평행성은 영향을 받지 않는다.
 *
 * 왜 심해인가
 *   세탁 광고는 사람이 나오는 이야기인데 게임 쪽이 숫자 상자 사이를 지나는 계산 화면이면,
 *   광고 태도 점수 차이가 '형식' 때문인지 '완성도' 때문인지 갈리지 않는다.
 *   무리가 몰려오는 압박감은 필요하되, 벌레는 혐오·밀집공포 개인차가 커서 그쪽이
 *   광고 태도에 직접 얹힌다 — 그래서 물속 무리로 잡았다.
 * ---------------------------------------------------------- */
const SEA = {
  // 물 — 위가 밝고 아래로 갈수록 어둡다(빛은 수면에서만 들어온다)
  waterTop: '#0b3a56',
  waterBottom: '#02101c',
  ray: 'rgba(150, 225, 255, 0.05)',      // 물속 광선
  snow: '#cfeaff',                        // 바다눈(부유물)
  // 잠수정
  hull: '#e6eef6', hullLo: '#8fa8bd', glass: '#7fe9ff',
  lamp: 'rgba(150, 240, 255, 0.22)',
  wash: '#9fe8ff',                        // 추진기 물살
  dead: '#5b6b7d',
  // 두 갈래 물길
  /* safe·risk 는 이제 숫자 글자색과 통과 입자에만 쓴다 — 물길에는 아무것도 안 칠한다 */
  safe: '#3fe0c8', risk: '#ff5c7a',
  // 물고기 떼 · 앞장선 포식자
  swarm: '#8a5cf0', swarmHi: '#c9a6ff', predator: '#592fb6',
  school: '#2f6f92', schoolHi: '#8fcde8',   // 배경 떼 — 판정과 무관해서 색이 다르다
  mine: '#ffb347', mineHi: '#fff0d0',      // 기뢰 — 떼(보라)·배경(파랑) 어느 쪽도 아닌 색
  ink: '#eaf6ff', plate: 'rgba(3, 16, 28, 0.72)'
};

/** 결정적 난수 — 참가자마다 무리 배치가 달라지면 안 되므로 Math.random 을 쓰지 않는다.
 *  같은 seed 로 부르면 늘 같은 수열이 나오고, 프레임마다 다시 seed 해서 배치를 고정한다. */
const rnd = (seed) => {
  let s = (Math.abs(seed | 0) * 1103515245 + 12345) & 0x7fffffff;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
};

/**
 * 물고기 한 마리 — 아래(잠수정 쪽)를 향한다. 꼬리가 위상에 따라 흔들려
 * 무리 전체가 "떠내려온다"가 아니라 "헤엄쳐 내려온다"로 읽힌다.
 * 한 화면에 수백 마리가 그려지므로 path 는 두세 개로 묶는다.
 */
const drawFish = (ctx, x, y, s, phase, t, body, hi) => {
  const flap = Math.sin(t * 0.22 + phase) * 2.4 * s;
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(x, y + 8 * s);                                   // 주둥이
  ctx.quadraticCurveTo(x + 4.6 * s, y + 1 * s, x, y - 6 * s);
  ctx.quadraticCurveTo(x - 4.6 * s, y + 1 * s, x, y + 8 * s);
  ctx.moveTo(x, y - 3.5 * s);                                 // 꼬리
  ctx.lineTo(x - 3.8 * s + flap, y - 11 * s);
  ctx.lineTo(x + 3.8 * s + flap, y - 11 * s);
  ctx.closePath();
  ctx.fill();
  if (s > 0.85) {                                             // 큰 개체만 눈을 그린다(비용)
    ctx.fillStyle = hi;
    ctx.beginPath(); ctx.arc(x - 1.5 * s, y + 3.4 * s, 1.1 * s, 0, Math.PI * 2); ctx.fill();
  }
};

/**
 * 앞장선 포식자 — 큰 적(HP 가 높은 무리) 맨 앞에만 몇 마리 세운다.
 * 마지막 실패 지점에 "얼굴"을 주려는 것이다. 겁주려는 게 아니라 클라이맥스를 만드는 용도라
 * 사실적인 묘사는 피하고 각진 실루엣 + 빛나는 눈까지만 간다
 * (세탁 광고에는 없는 공포·각성이 게임 쪽에만 얹히면 그것도 자극 간 변량이 된다).
 */
const drawPredator = (ctx, x, y, s, phase, t) => {
  const flap = Math.sin(t * 0.16 + phase) * 3.5 * s;
  ctx.fillStyle = SEA.predator;
  ctx.beginPath();
  ctx.moveTo(x, y + 24 * s);                                            // 주둥이
  ctx.quadraticCurveTo(x + 7.5 * s, y + 11 * s, x + 8 * s, y - 1 * s);
  ctx.lineTo(x + 16 * s, y - 1 * s);                                    // 가슴지느러미
  ctx.lineTo(x + 7 * s, y - 7 * s);
  ctx.quadraticCurveTo(x + 5.5 * s, y - 14 * s, x + 3 * s, y - 19 * s); // 꼬리자루
  ctx.lineTo(x + 9 * s + flap, y - 29 * s);                             // 초승달 꼬리
  ctx.lineTo(x + 1 * s + flap, y - 23 * s);
  ctx.lineTo(x - 1 * s + flap, y - 23 * s);
  ctx.lineTo(x - 9 * s + flap, y - 29 * s);
  ctx.lineTo(x - 3 * s, y - 19 * s);
  ctx.quadraticCurveTo(x - 5.5 * s, y - 14 * s, x - 7 * s, y - 7 * s);
  ctx.lineTo(x - 16 * s, y - 1 * s);
  ctx.lineTo(x - 8 * s, y - 1 * s);
  ctx.quadraticCurveTo(x - 7.5 * s, y + 11 * s, x, y + 24 * s);
  ctx.closePath();
  ctx.fill();
  // 벌린 입 — 잠수정을 마주보는 쪽이다
  ctx.strokeStyle = SEA.ink; ctx.lineWidth = Math.max(1, 1.3 * s);
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.moveTo(x - 4.5 * s, y + 13 * s);
  ctx.quadraticCurveTo(x, y + 17 * s, x + 4.5 * s, y + 13 * s);
  ctx.stroke();
  ctx.globalAlpha = 1.0;
  // 붉은 눈 — "사악하게" 는 여기까지만. 사실적인 묘사로 가지 않는다
  ctx.fillStyle = SEA.risk;
  ctx.beginPath();
  ctx.arc(x - 4 * s, y + 6 * s, 1.9 * s, 0, Math.PI * 2);
  ctx.arc(x + 4 * s, y + 6 * s, 1.9 * s, 0, Math.PI * 2);
  ctx.fill();
};

/**
 * 사각 영역을 무리로 채운다.
 * @param {number} seed  사건마다 고정된 값 — 프레임마다 같은 배치가 나오게 한다
 * @param {number} t     흔들림 위상(게임 시간). 배치는 고정이고 이 값만 움직인다
 * @param {number} dens  단위 넓이당 마릿수 계수(작을수록 빽빽)
 */
const drawSwarm = (ctx, x, y, w, h, seed, t, body, hi, dens, lead, soft) => {
  const n = Math.max(5, Math.min(110, Math.round((w * h) / (dens || 900))));
  const r = rnd(seed);
  for (let i = 0; i < n; i++) {
    const bx = x + r() * w;
    const by = y + r() * h;
    const ph = r() * Math.PI * 2;
    const s = 0.55 + r() * 0.65;
    /* 위아래 가장자리를 흐리게 한다(soft). 딱딱한 사각 경계가 곧 "박스가 내려온다"이고,
     * 가장자리가 풀리면 지나가는 떼로 읽힌다. 가운데 60% 는 그대로라 **진한 부분이 판정
     * 구간**이라는 관계는 유지된다. 좌우는 안 흐린다 — 어느 쪽이 손해인지가 흐려지면 안 된다. */
    if (soft) {
      const d = Math.abs((by - y) / h - 0.5);          // 0 = 한가운데, 0.5 = 끝
      ctx.globalAlpha = 1 - Math.min(1, Math.max(0, (d - 0.3) / 0.2)) * 0.85;
    }
    /* 개체마다 다른 위상으로 흔들린다 — 같은 위상이면 격자가 통째로 흔들려
     * 살아 있는 무리가 아니라 무늬가 움직이는 것으로 보인다. */
    drawFish(ctx, bx + Math.sin(t * 0.06 + ph) * 5, by + Math.cos(t * 0.045 + ph) * 3.5,
      s, ph, t, body, hi);
  }
  if (soft) ctx.globalAlpha = 1;
  // 앞장선 포식자 — 무리 아래쪽 가장자리(잠수정을 마주보는 면)에 세운다
  for (let i = 0; i < (lead || 0); i++) {
    const bx = x + (w * (i + 0.5)) / (lead || 1) + Math.sin(t * 0.05 + i) * 6;
    drawPredator(ctx, bx, y + h - 14, 1.3, i * 2.1, t);
  }
};

/**
 * 게이트·적의 숫자 — 판 없이 글자만 띄운다.
 *
 * 판(둥근 사각형)을 깔면 상자를 다 지운 화면에서 그것만 남아 도로 "박스"가 된다.
 * 대신 글자 뒤에 짙은 그림자를 두 겹 줘서 떼 위에서도 읽히게 했다.
 *
 * 숫자 자체는 남긴다. 어느 쪽이 손해인지는 떼가 있느냐 없느냐로 이미 보이지만,
 * 얼마나 손해인지는 숫자로만 알 수 있고 그건 자극의 정보량이라 임의로 못 줄인다.
 */
const drawLabel = (ctx, cx, cy, text, color) => {
  ctx.font = 'bold 17px monospace';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0, 8, 18, 1)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = color;
  ctx.fillText(text, cx, cy + 6);
  ctx.fillText(text, cx, cy + 6);   // 두 번 얹어 그림자를 진하게 — 떼 위에서도 읽힌다
  ctx.shadowBlur = 0;
};

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
    ship: { x: 220, y: 550, w: 40, h: 40, power: START_POWER, isDead: false, vx: 0, vy: 0, ang: 0, av: 0 },
    gates: [], enemies: [], stars: [], mines: [], particles: [], rings: [], speed: 5, time: 0, eventIdx: 0, history: [], rescueGoal: 0,
    flash: 0, slowFactor: 1, timeline: MAIN_TIMELINE_A,
    shake: 0, resultAnim: { type: '', t: 0 }, vignette: 0, failReason: '', isEnding: false
  });
  const input = useRef({ left: false, right: false, mouseX: null });

  /* 로그용 시각 — 렌더 사이에 값이 상하지 않도록 state 가 아니라 ref 에 둔다 */
  const marks = useRef({ interveneStart: 0, firstDrag: 0, rewindShownAt: 0 });
  const rewindStarted = useRef(false);

  const initGame = () => {
    gameState.current = {
      ship: { x: 220, y: 550, w: 40, h: 40, power: START_POWER, isDead: false, vx: 0, vy: 0, ang: 0, av: 0 },
      gates: [], enemies: [], stars: Array.from({ length: 30 }, () => ({ x: Math.random() * CANVAS_W, y: Math.random() * CANVAS_H, s: 1 + Math.random() * 3 })),
      /* 배경 물고기 떼 — 화면을 채우는 주인공이다. 게이트의 벽은 폭이 20px 밖에 안 되는
       * 얇은 띠라 거기에만 물고기를 두면 화면에 물고기가 거의 안 보인다.
       *
       * 판정과는 아무 상관이 없다(부딪혀도 아무 일도 안 일어난다). 그래서 색을 게이트·적의
       * 무리(보라)와 뚜렷이 다르게 뒀다 — 같은 색이면 "저 떼가 손해인가"를 매번 판단해야 해서
       * 판정에 쓰이는 색 신호가 흐려진다.
       *
       * 배치는 seed 로 고정한다. 참가자마다 다른 화면이 나오면 안 되기 때문이다
       * (같은 이유로 drawSwarm 도 Math.random 을 안 쓴다). */
      school: (() => {
        const r = rnd(20250819);
        return Array.from({ length: 78 }, () => ({
          x: r() * CANVAS_W, y: r() * CANVAS_H,
          s: 0.45 + r() * 1.7,       // 클수록 앞에 있고 빨리 지나간다(원근)
          ph: r() * Math.PI * 2,
          vx: 0                      // 빔에 밀린 옆속도. 연출 전용이다
        }));
      })(),
      mines: [], particles: [], rings: [], speed: 5, time: 0, eventIdx: 0, history: [], rescueGoal: 0,
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
    SFX.play('start');        // 세탁 자극의 Engine.start() 와 같은 자리다
    SFX.startBed();           // 배경음 — 잠금이 늦게 풀려도 알아서 켜진다
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
      SFX.play('success');    // 세탁 자극의 장면 8(개선 결과)과 같은 자리다
      state.vignette = -2.5; state.flash = 1.0; state.shake = 12;
      state.ship.vy = -18; state.ship.vx = 0;
      spawnParticles(state.ship.x + state.ship.w / 2, state.ship.y + state.ship.h / 2, 100, SEA.glass, 18, 6);
      for (let i = 0; i < 4; i++) {
        setTimeout(() => {
          state.rings.push({ x: state.ship.x + state.ship.w / 2, y: state.ship.y + state.ship.h / 2, r: 10, life: 1.0, speed: 12 + i * 4, color: i % 2 === 0 ? '#ffffff' : SEA.glass });
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
      /* 결과 연출이 끝나면 제품 카드로 넘어간다 — 세탁 자극의 장면 10 자리다.
       * 튜토리얼은 광고가 아니라 조작 연습이므로 카드 없이 바로 끝낸다. */
      if (IS_TUTORIAL) {
        finish();             // postMessage + localStorage — 러너가 다음 블록으로 넘긴다
        setStage(STAGES.ENDED);
        return;
      }
      setGamePhase('product_card');
    }, delay);
  }, []);

  /* 제품 카드를 닫고 자극을 마감한다.
   * @param {number} [endAt] 종료로 칠 시각(ms). CTA 클릭은 "누른 시점"을 넘겨
   *                         DWELL_TOTAL 이 카드 잔여 시간까지 세지 않게 한다(세탁과 동일). */
  const cardClosed = useRef(false);
  const closeCard = useCallback((endAt) => {
    if (cardClosed.current) return;
    cardClosed.current = true;
    finish(endAt ? { endAt } : undefined);
    setStage(STAGES.ENDED);
  }, []);

  /* 8초 자동 종료. CTA·[×] 를 누르면 아래 onCta·onClose 가 먼저 닫는다. */
  const cardShownAt = useRef(0);
  useEffect(() => {
    if (gamePhase !== 'product_card') return undefined;
    cardShownAt.current = Date.now();
    SFX.play('card');   // 세탁 자극의 장면 10 진입과 같은 자리다
    const id = setTimeout(() => closeCard(), PRODUCT_CARD_SEC * 1000);
    return () => clearTimeout(id);
  }, [gamePhase, closeCard]);

  /** [되돌리기] — 참가자가 수정을 시작하는 자리. 세탁 자극의 같은 버튼과 짝이다. */
  const onRewind = useCallback(() => {
    if (rewindStarted.current) return;      // 두 번 눌러도 한 번만 먹는다
    rewindStarted.current = true;
    LOG.T_REWIND = secondsSince(marks.current.rewindShownAt);
    setGamePhase('rewind_back');
    SFX.play('rewind');   // 세탁 자극의 장면 5(되감기)와 같은 자리다
  }, []);

  /** [지금 다운로드] — 모의 광고라 외부 이동은 없다. 클릭 여부만 남기고 끝낸다. */
  const onCta = useCallback(() => {
    if (cardClosed.current) return;
    LOG.CTA_CLICK = 1;
    LOG.T_CARD = secondsSince(cardShownAt.current);
    /* 종료(=로그 마감) 전에 울려야 SFX_COUNT 에 이 클릭이 포함된다.
     * 이 클릭음은 세탁 자극과 음색까지 같다 — sfx.js 의 CTA_VOICE. */
    SFX.play('cta');
    closeCard(Date.now());
  }, [closeCard]);

  /** 카드 오른쪽 위 [×] — 세탁 자극의 같은 버튼과 짝이다(INTEGRATION.md §5-13).
   *
   *  나가는 길이 [지금 다운로드] 하나뿐이면 그 클릭이 "받고 싶다"가 아니라
   *  "나가려면 이것밖에 없다"가 된다. CTA_CLICK 이 종속변인이라 이건 측정 문제고,
   *  실제 광고에는 늘 있는 것이라 없으면 오히려 광고답지 않다.
   *
   *  닫기는 가장 작은 신호(beat)로 받는다. 소리를 안 내면 CTA 만 청각 보상을
   *  갖게 되어 그 자체가 CTA 쪽으로 미는 힘이 된다 — 세탁 쪽과 같은 규칙이다. */
  const onClose = useCallback(() => {
    if (cardClosed.current) return;
    LOG.CLOSE_CLICK = 1;
    LOG.T_CARD = secondsSince(cardShownAt.current);
    SFX.play('beat');
    closeCard(Date.now());
  }, [closeCard]);

  const checkCollisions = (state, onFail) => {
    const s = state.ship;
    state.gates.forEach(g => {
      if (!g.passed && g.y + 40 > s.y && g.y < s.y + s.h) {
        /* 게이트를 지날 때의 소리 — 이득이면 beat, 손해면 bad.
         * 세탁 자극에서 장면이 좋아질 때 beat, 나빠질 때(염료 번짐) bad 를 내는 것과 같은 뜻이다.
         * 길이·세기는 두 자극이 같고 음색만 다르다(sfx.js). */
        if (s.x + s.w / 2 > g.x1 && s.x + s.w / 2 < g.x1 + g.w1) {
          state.ship.power += g.p1; g.passed = true; LOG.GATES_PASSED++;
          spawnParticles(s.x + s.w / 2, g.y + 20, 15, g.p1 > 0 ? SEA.safe : SEA.risk, 4);
          SFX.play(g.p1 > 0 ? 'beat' : 'bad');
        }
        else if (s.x + s.w / 2 > g.x2 && s.x + s.w / 2 < g.x2 + g.w2) {
          state.ship.power += g.p2; g.passed = true; LOG.GATES_PASSED++;
          spawnParticles(s.x + s.w / 2, g.y + 20, 15, g.p2 > 0 ? SEA.safe : SEA.risk, 4);
          SFX.play(g.p2 > 0 ? 'beat' : 'bad');
        }
        if (state.ship.power <= 0) onFail('POWER DEPLETED');
      }
    });
    state.enemies.forEach(e => {
      if (!e.dead && s.x < e.x + e.w && s.x + s.w > e.x && s.y < e.y + e.h && s.y + s.h > e.y) {
        if (state.ship.power >= e.hp) {
          state.ship.power -= e.hp; e.dead = true; state.shake = 12; state.flash = 0.35;
          spawnParticles(e.x + e.w / 2, e.y + e.h / 2, 20, SEA.swarmHi, 7);
          SFX.play('beat');     // 파워로 뚫고 지나갔다 — 화면 흔들림에 붙는 짧은 표시음
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
      /* seed 는 그림 전용이다 — 무리 배치를 프레임마다 같게, 참가자마다 같게 고정한다.
       * 되감기로 상태를 복원해도 사본에 그대로 실려 오므로 같은 무리가 다시 나온다. */
      if (ev.type === 'gate') state.gates.push({ ...ev, y: -120, passed: false, seed: state.eventIdx + 1 });
      else if (ev.type === 'enemy') state.enemies.push({ ...ev, y: -120, dead: false, seed: state.eventIdx + 1 });
      else if (ev.type === 'mine') state.mines.push({ ...ev, y: -60, dead: false, missed: false, seed: state.eventIdx + 1 });
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

    /* 배경 떼 — 크기에 따라 속도가 달라 앞뒤 층이 생긴다.
     * 감아 돌릴 때 y 만 되돌린다. x 를 새로 뽑으면 참가자마다 배치가 갈라진다.
     *
     * **빔이 지나는 자리의 물고기는 옆으로 밀려난다.** 잠수정이 알아서 쏘는 빔이 실제로
     * 무언가를 하는 것처럼 보이게 하는 연출이다 — 판정에는 한 글자도 안 들어간다.
     * 밀리는 대상은 **배경 떼(푸른색)뿐**이다. 게이트·적의 무리(보라)를 밀면 "쏴서 없앴다"로
     * 읽혀 실패의 원인이 조작 능력으로 옮겨 간다 — 이 자극의 전제가 무너진다. */
    const beamX = state.ship.x + state.ship.w / 2;
    state.school.forEach(f => {
      f.y += currentSpeed * (0.25 + f.s * 0.55);
      if (f.y > height + 24) f.y = -24;
      if (!state.ship.isDead && f.y < state.ship.y && f.y > state.ship.y - 340) {
        const d = f.x - beamX;
        if (Math.abs(d) < 30) f.vx += (d >= 0 ? 1 : -1) * (0.75 - Math.abs(d) / 60);
      }
      f.vx *= 0.9;
      f.x += f.vx;
      if (f.x < -24) f.x += width + 48; else if (f.x > width + 24) f.x -= width + 48;
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
          state.history.push({ ship: { ...state.ship }, gates: state.gates.map(g => ({ ...g })), enemies: state.enemies.map(e => ({ ...e })), mines: state.mines.map(m => ({ ...m })), time: state.time, eventIdx: state.eventIdx });
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
      const onFail = (reason) => {
        state.ship.isDead = true; state.ship.vx = (Math.random() - 0.5) * 15; state.ship.vy = (Math.random() * 5 + 5); state.ship.av = (Math.random() - 0.5) * 0.4;
        state.flash = 0.8; state.shake = 35; state.vignette = 1.0; state.failReason = reason;
        LOG.FAIL_REASON = reason;   // 마지막 실패 사유 — watch 는 각본된 실패, intervene 은 구출 실패
        SFX.play('fail');           // 세탁 자극의 장면 4(실패 결과)와 같은 자리다
        spawnParticles(state.ship.x + state.ship.w / 2, state.ship.y + state.ship.h / 2, 35, SEA.wash, 12, 4);
        spawnParticles(state.ship.x + state.ship.w / 2, state.ship.y + state.ship.h / 2, 25, SEA.swarm, 8, 6);

        if (IS_TUTORIAL) { endStimulus('tutorial_fail'); return; }
        if (gamePhase === 'rewind_rescue') { endStimulus('rescue_fail'); return; }
        if (!IS_INTERVENE) {
          // watch: 실패가 곧 결말이다. 되감기·구출은 재생하지 않는다.
          LOG.COLLISION_T = secondsSince(LOG.t_start);
          endStimulus('scripted_fail');
          return;
        }
        /* intervene: 실패를 보여 준 뒤 **참가자가 [되돌리기]를 누를 때까지 기다린다.**
         *
         * 예전에는 1초 뒤 저절로 되감겼다. 그러면 되돌리는 주체가 광고이고 참가자는
         * 구경꾼이다. 실패-수정형 광고에서 재려는 것이 "내가 고쳤다"는 경험이므로,
         * 고치기로 하는 첫 결정도 참가자가 내려야 한다.
         *
         * rewind_watch 가 그 대기 상태다(예전에는 1초짜리 정지 화면이었다). 이 구간은
         * 시간이 안 정해져 있어 개입 조건의 재생 길이가 참가자마다 달라진다 —
         * 대기 시간은 T_REWIND 로 따로 기록한다(INTEGRATION.md §11). */
        LOG.COLLISION_T = secondsSince(LOG.t_start);
        setTimeout(() => {
          if (gamePhase !== 'ended') {
            marks.current.rewindShownAt = Date.now();
            setGamePhase('rewind_watch');
          }
        }, 800);
      };

      /* 기뢰 — 빔에 맞으면 사라지고, 못 맞히고 지나치면 파워가 깎인다.
       *
       * 시청 조건(autoplay_fail_watch)에서는 **위치와 무관하게** 맞는다. 광고 속 자동
       * 조종의 실패는 '선택' 때문이어야지 '겨냥을 놓쳐서'가 아니다 — 그래서 시청 조건의
       * 수치는 기뢰를 넣기 전과 같다. 겨냥이 실제로 필요한 것은 참가자가 모는 구간뿐이다. */
      const autoAim = gamePhase === 'autoplay_fail_watch';
      const bx = state.ship.x + state.ship.w / 2;
      state.mines.forEach(m => {
        if (m.dead || m.missed) return;
        m.y += currentSpeed * 1.15;                       // 게이트보다 조금 빠르다
        m.sx = m.x + Math.sin((m.y + m.seed * 40) * 0.018) * 12;
        const inBeam = !state.ship.isDead &&
          m.y > state.ship.y - BEAM_REACH && m.y < state.ship.y &&
          (autoAim || Math.abs(m.sx - bx) < BEAM_HALF);
        if (inBeam) {
          m.dead = true;
          state.flash = Math.max(state.flash, 0.16);
          spawnParticles(m.sx, m.y, 14, SEA.mineHi, 6, 3);
          SFX.play('beat');       // 게이트를 이득 쪽으로 지날 때와 같은 신호다
          return;
        }
        if (m.y > state.ship.y + state.ship.h) {
          m.missed = true;
          state.ship.power -= MINE_COST;
          state.shake = Math.max(state.shake, 16);
          spawnParticles(m.sx, state.ship.y, 18, SEA.mine, 7, 3);
          SFX.play('bad');        // 손해 물길을 지날 때와 같은 신호다
          if (state.ship.power <= 0 && !state.ship.isDead) onFail('POWER DEPLETED');
        }
      });

      checkCollisions(state, onFail);
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
    /* 물 — 수면 쪽이 밝고 아래로 갈수록 어둡다. 깊이 방향이 한눈에 읽혀야
       "내려가고 있다"가 성립한다. */
    const water = ctx.createLinearGradient(0, 0, 0, height);
    water.addColorStop(0, SEA.waterTop);
    water.addColorStop(1, SEA.waterBottom);
    ctx.fillStyle = water; ctx.fillRect(0, 0, width, height);

    /* 수면에서 들어오는 광선 — 고정. 위쪽이 밝은 이유를 설명해 준다 */
    ctx.fillStyle = SEA.ray;
    [[-40, 150], [140, 110], [300, 170], [420, 90]].forEach(([rx, rw]) => {
      ctx.beginPath();
      ctx.moveTo(rx, 0); ctx.lineTo(rx + rw, 0);
      ctx.lineTo(rx + rw * 2.6, height); ctx.lineTo(rx + rw * 1.1, height);
      ctx.closePath(); ctx.fill();
    });

    /* 흘러가는 수심선 — 예전 격자 자리다. 전진하는 느낌만 남기고 밀도를 낮췄다 */
    const lineAlpha = state.shake > 10 ? 0.3 : (gameResult === 'success' && gamePhase === 'ended' ? 0.22 : 0.1);
    ctx.strokeStyle = `rgba(120, 200, 235, ${lineAlpha})`;
    ctx.lineWidth = 1; ctx.beginPath();
    const lineY = ((state.time * (state.ship.isDead ? 0.5 : 2.8)) % 80);
    for (let i = lineY; i < height; i += 80) { ctx.moveTo(0, i); ctx.lineTo(width, i); }
    ctx.stroke();

    /* 바다눈 — 예전 별 자리. 같은 배열을 쓰고 모양만 바꿨다 */
    ctx.fillStyle = SEA.snow;
    state.stars.forEach(s => {
      ctx.globalAlpha = s.s / 6;
      const sway = Math.sin((s.y + s.x) * 0.02) * 2;
      ctx.beginPath(); ctx.arc(s.x + sway, s.y, s.s * 0.7, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1.0;

    /* 배경 떼 — 게이트보다 먼저 그린다. 게이트·적이 위에 얹혀야 판정 신호를 안 가린다. */
    state.school.forEach(f => {
      ctx.globalAlpha = Math.min(1, 0.3 + f.s * 0.35);   // 작을수록 멀리 있다
      drawFish(ctx, f.x + Math.sin(state.time * 0.03 + f.ph) * 7, f.y,
        f.s, f.ph, state.time, SEA.school, SEA.schoolHi);
    });
    ctx.globalAlpha = 1.0;

    /* 게이트 — 무리가 갈라져 생긴 **두 갈래 물길**.
     * 판정 상자(높이 40)와 그림이 정확히 겹쳐야 한다. 보이는 것과 맞는 것이 어긋나면
     * 참가자가 "제대로 지났는데 손해를 봤다"고 느낀다. GATE_H 를 바꾸려면
     * checkCollisions 의 40 도 같이 바꿔야 한다. */
    const GATE_H = 40;
    /* 벽(무리)이 판정 구간보다 위아래로 넉넉히 넘친다.
     * 화면의 주인공은 물고기 떼여야 한다 — 벽이 판정 구간에 딱 맞으면 무리가 아니라
     * 띠로 보이고, 그 띠가 곧 "내려오는 박스"가 된다. 넘치는 것은 벽뿐이고, 벽은 판정에
     * 안 쓰인다(판정은 물길의 좌우 범위와 g.y~g.y+40 뿐이다 — checkCollisions 참고). */
    /* 벽을 판정 구간보다 훨씬 길게 뺀다. 가장자리가 흐려지므로(soft) 띠가 아니라
     * 위에서부터 계속 흘러내리는 줄기로 보인다. 벽은 판정에 안 쓰인다. */
    const WALL_OVER = 74;
    state.gates.forEach(g => {
      if (g.passed) return;
      // 물길 사이·바깥의 벽 — 여기에 무리가 서 있어 "틈으로 지나간다"로 읽힌다
      [[0, g.x1], [g.x1 + g.w1, g.x2 - (g.x1 + g.w1)], [g.x2 + g.w2, width - (g.x2 + g.w2)]]
        .forEach(([px, pw], i) => {
          if (pw <= 4) return;
          drawSwarm(ctx, px, g.y - WALL_OVER, pw, GATE_H + WALL_OVER * 2,
            g.seed * 7 + i, state.time, SEA.swarm, SEA.swarmHi, 150, 0, true);
        });

      /* 물길 — **아무것도 그리지 않는다.** 물빛 띠도 없앴다.
       *
       * 게이트 하나에는 늘 이득 쪽 하나와 손해 쪽 하나가 있다(두 타임라인 전부 그렇다).
       * 그래서 **손해 쪽만 떼가 메우고 이득 쪽은 빈 물**로 두면, 화면은 "떼가 반쪽을 막고
       * 내려온다 → 빈 쪽으로 피한다"가 된다. 색 띠로 알려 주는 것보다 이쪽이 게임이다.
       *
       * 판정 구간은 그대로다(g.y ~ g.y+GATE_H). 떼가 그 구간을 정확히 채우므로 보이는
       * 자리와 맞는 자리가 같다. 이득 쪽에 그림이 없다고 판정이 흐려지지는 않는다 —
       * 참가자가 하는 일은 좌우를 고르는 것뿐이고, 세로 위치는 조작에 안 들어간다. */
      const drawChannel = (x, w, power) => {
        const isPos = power > 0;
        if (!isPos) {
          /* 위아래로 22px 씩 넘치되 그 부분은 흐리다 — 진한 가운데가 판정 구간이다.
           * 좌우는 정확히 물길 폭이다(어느 쪽이 손해인지는 흐려지면 안 된다). */
          drawSwarm(ctx, x + 2, g.y - 22, w - 4, GATE_H + 44,
            g.seed * 13 + w, state.time, SEA.swarm, SEA.swarmHi, 130, 0, true);
        }
        drawLabel(ctx, x + w / 2, g.y + GATE_H / 2, isPos ? `+${power}` : String(power),
          isPos ? SEA.safe : SEA.risk);
      };
      drawChannel(g.x1, g.w1, g.p1);
      drawChannel(g.x2, g.w2, g.p2);
    });

    /* 적 — 빽빽하게 몰려오는 무리. HP 가 높을수록 촘촘하다(밀도가 곧 위협이다). */
    state.enemies.forEach(e => {
      if (e.dead) return;
      /* 적의 몸은 **무리 자체**다. 예전에는 보라색 둥근 사각형을 깔고 그 안에 물고기를
       * 넣었는데, 그러면 눈에 먼저 들어오는 것이 상자라 "박스가 내려온다"가 된다.
       * 상자를 지우고, 가장자리로 사라지는 그림자만 뒤에 깔아 무게를 준다. */
      const ecx = e.x + e.w / 2, ecy = e.y + e.h / 2;
      const rad = Math.max(e.w, e.h) * 0.62;
      const shade = ctx.createRadialGradient(ecx, ecy, rad * 0.2, ecx, ecy, rad);
      shade.addColorStop(0, 'rgba(58, 20, 92, 0.40)');
      shade.addColorStop(1, 'rgba(58, 20, 92, 0)');
      ctx.fillStyle = shade;
      ctx.fillRect(e.x - rad, e.y - rad, e.w + rad * 2, e.h + rad * 2);
      /* 큰 무리일수록 앞장선 포식자를 더 세운다. 마지막 실패 지점(HP 24)이
       * 가장 무겁게 보여야 "저건 못 뚫는다"가 미리 읽힌다. */
      const lead = e.hp >= 20 ? 3 : (e.hp >= 13 ? 2 : (e.hp >= 8 ? 1 : 0));
      /* 무리가 판정 상자를 **정확히** 채운다(넘치지도 모자라지도 않게).
       * 적은 몸에 닿으면 판정이므로, 보이는 몸과 맞는 몸이 어긋나면 안 된다. */
      drawSwarm(ctx, e.x, e.y, e.w, e.h, e.seed * 31, state.time,
        SEA.swarm, SEA.swarmHi, Math.max(150, 820 - e.hp * 26), lead);
      drawLabel(ctx, e.x + e.w / 2, e.y + e.h / 2, `HP ${e.hp}`, SEA.risk);
    });

    /* 기뢰 — 가시 달린 공. 떼(보라)도 배경 떼(파랑)도 아닌 색이라 "저건 다른 것"이 바로 읽힌다.
     * 빔 사정거리 안에 들어오면 테두리가 밝아진다 — "지금 맞힐 수 있다"는 신호다. */
    state.mines.forEach(m => {
      if (m.dead || m.missed) return;
      const mx = m.sx == null ? m.x : m.sx;
      const armed = m.y > state.ship.y - BEAM_REACH && m.y < state.ship.y;
      const pulse = 1 + Math.sin(state.time * 0.25 + m.seed) * 0.08;
      ctx.save();
      ctx.translate(mx, m.y);
      ctx.strokeStyle = SEA.mine; ctx.lineWidth = 3; ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI * 2 * i) / 8 + state.time * 0.008;
        ctx.moveTo(Math.cos(a) * MINE_R * 0.72, Math.sin(a) * MINE_R * 0.72);
        ctx.lineTo(Math.cos(a) * MINE_R * 1.35 * pulse, Math.sin(a) * MINE_R * 1.35 * pulse);
      }
      ctx.stroke();
      const body = ctx.createRadialGradient(-4, -4, 2, 0, 0, MINE_R);
      body.addColorStop(0, SEA.mineHi); body.addColorStop(1, SEA.mine);
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.arc(0, 0, MINE_R * 0.78, 0, Math.PI * 2); ctx.fill();
      if (armed) {
        ctx.strokeStyle = SEA.mineHi; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, MINE_R * 1.15, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    });

    /* 처음 나오는 기뢰에만 한 줄 붙인다. 배우지 않은 규칙 때문에 실패하면 그 실패는
     * '선택'이 아니라 '몰라서'가 되고, 그러면 개입 조건이 재려는 것을 못 잰다.
     * **조작할 수 없는 시청 조건에는 안 띄운다** — 세탁 자극이 드롭존 안내를 intervene
     * 에만 띄우는 것과 같은 규칙이다(SPEC 4장). */
    const firstMine = state.mines[0];
    if (firstMine && !firstMine.dead && !firstMine.missed &&
        (gamePhase === 'rewind_rescue' || gamePhase === 'tutorial_play')) {
      ctx.font = `bold 15px ${KO_FONT}`;
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0, 8, 18, 1)'; ctx.shadowBlur = 6;
      ctx.fillStyle = SEA.mineHi;
      ctx.fillText('기뢰 — 빔 앞으로 옮겨 맞히세요', firstMine.sx == null ? firstMine.x : firstMine.sx,
        firstMine.y + MINE_R + 26);
      ctx.shadowBlur = 0;
    }

    state.particles.forEach(p => { ctx.globalAlpha = p.life; ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size); });
    ctx.globalAlpha = 1.0;

    /* 잠수정 — 위쪽이 앞이다(게이트·무리가 위에서 내려온다).
     * 크기는 예전 삼각형과 같은 ±22 안에 둔다. 판정 상자는 40×40 그대로다. */
    ctx.save(); ctx.translate(state.ship.x + state.ship.w / 2, state.ship.y + state.ship.h / 2); ctx.rotate(state.ship.ang);
    const isVictory = gameResult === 'success' && gamePhase === 'ended';
    if (!state.ship.isDead) {
      /* 소나 빔 — 잠수정이 **알아서** 쏜다. 참가자는 좌우만 고른다.
       *
       * 조준·발사를 참가자에게 맡기면 실패가 '선택'이 아니라 '반사신경'의 결과가 되고,
       * 개입 조건의 성공/실패가 조작 능력으로 갈린다. 이 자극의 전제(실패는 자동 조종의
       * 선택 때문이다)가 통째로 무너지므로 발사는 자동이어야 한다. 여기서 하는 일은
       * "쏘고 있다"로 보이게 만드는 것뿐이고 판정에는 개입하지 않는다.
       *
       * 못 이길 무리가 다가오면(slowFactor 가 떨어지면) 빔이 붉어진다 —
       * 이미 있던 슬로모션과 같은 정보를 색으로 한 번 더 알려, 참가자가
       * "왜 실패했는지"를 놓치지 않게 한다. */
      const threat = state.slowFactor < 0.95;
      ctx.fillStyle = threat ? 'rgba(255, 92, 122, 0.20)' : SEA.lamp;
      ctx.beginPath();
      ctx.moveTo(-7, -18); ctx.lineTo(7, -18);
      ctx.lineTo(52, -172); ctx.lineTo(-52, -172);
      ctx.closePath(); ctx.fill();
      // 빔을 타고 올라가는 파동 — 이게 '발사'로 읽히는 부분이다
      ctx.strokeStyle = threat ? SEA.risk : SEA.glass;
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        const p = (((state.time * 0.9 + i * 50) % 150) + 150) % 150 / 150;
        ctx.globalAlpha = (1 - p) * (threat ? 0.45 : 0.7);
        const yy = -18 - p * 154, hw = 7 + p * 45;
        ctx.beginPath(); ctx.moveTo(-hw, yy); ctx.lineTo(hw, yy); ctx.stroke();
      }
      ctx.globalAlpha = 1.0;
      // 추진기 물살 — 예전 엔진 불꽃 자리다
      ctx.fillStyle = isVictory ? '#ffffff' : SEA.wash;
      ctx.globalAlpha = isVictory ? 0.9 : (0.45 + Math.random() * 0.45);
      const wLen = isVictory ? 78 : 32;
      ctx.beginPath(); ctx.moveTo(-10, 18); ctx.lineTo(10, 18); ctx.lineTo(0, wLen); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1.0;
      if (isVictory) { ctx.shadowColor = SEA.glass; ctx.shadowBlur = 36; }
    }
    /* 좌우 안정판 — 동체보다 먼저 그려 뒤에 깔리게 한다.
     * 로켓처럼 보이지 않도록 아래로 뻗는 삼각날개가 아니라 옆으로 붙은 판으로 둔다. */
    ctx.fillStyle = state.ship.isDead ? SEA.dead : SEA.hullLo;
    ctx.beginPath();
    ctx.moveTo(-12, 2); ctx.lineTo(-25, 10); ctx.lineTo(-25, 16); ctx.lineTo(-11, 14); ctx.closePath();
    ctx.moveTo(12, 2); ctx.lineTo(25, 10); ctx.lineTo(25, 16); ctx.lineTo(11, 14); ctx.closePath();
    ctx.fill();
    // 동체 — 둥근 캡슐(뾰족한 코를 없앤다)
    ctx.fillStyle = state.ship.isDead ? SEA.dead : (isVictory ? '#ffffff' : SEA.hull);
    ctx.beginPath();
    ctx.moveTo(0, -21);
    ctx.bezierCurveTo(11, -21, 15, -11, 15, 2);
    ctx.bezierCurveTo(15, 15, 8, 21, 0, 21);
    ctx.bezierCurveTo(-8, 21, -15, 15, -15, 2);
    ctx.bezierCurveTo(-15, -11, -11, -21, 0, -21);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    if (!state.ship.isDead) {
      // 조종실 유리 + 선체 띠 — 잠수정으로 읽히게 하는 두 요소다
      ctx.fillStyle = SEA.glass;
      ctx.beginPath(); ctx.arc(0, -8, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = SEA.hullLo;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-15, 4, 30, 4, 2); else ctx.rect(-15, 4, 30, 4);
      ctx.fill();
    }
    ctx.restore();

    if (!state.ship.isDead) {
      ctx.fillStyle = isVictory ? SEA.glass : SEA.ink; ctx.font = 'bold 22px monospace'; ctx.textAlign = 'center';
      if (isVictory) { ctx.shadowColor = SEA.glass; ctx.shadowBlur = 15; }
      ctx.fillText(state.ship.power, state.ship.x + state.ship.w / 2, state.ship.y + state.ship.h + 28);
      ctx.shadowBlur = 0;
    }

    state.rings.forEach(r => { ctx.globalAlpha = r.life; ctx.strokeStyle = r.color || '#ffffff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke(); });
    ctx.globalAlpha = 1.0; ctx.restore();

    if (state.flash > 0) { const flashColor = gameResult === 'success' ? '200, 255, 255' : '255, 255, 255'; ctx.fillStyle = `rgba(${flashColor}, ${state.flash})`; ctx.fillRect(0, 0, width, height); }
    if (state.vignette !== 0) {
      const grad = ctx.createRadialGradient(width / 2, height / 2, width * 0.05, width / 2, height / 2, width * 0.95);
      // 위험은 무리의 색(자주)으로, 회복은 맑은 물빛(청록)으로 조인다
      if (state.vignette > 0) { grad.addColorStop(0, 'rgba(0, 0, 0, 0)'); grad.addColorStop(1, `rgba(74, 12, 92, ${state.vignette * 0.85})`); }
      else { grad.addColorStop(0, `rgba(63, 224, 200, ${Math.abs(state.vignette) * 0.3})`); grad.addColorStop(1, 'rgba(0, 0, 0, 0)'); }
      ctx.fillStyle = grad; ctx.fillRect(0, 0, width, height);
    }

    if (state.resultAnim.type) {
      /* 결과 문구 뒤에 어두운 판을 깐다. 무리가 그려진 위에 글씨만 얹으면
       * "HP 24 > POWER 7"·"더 나은 선택이 가능했습니다"가 촉수에 묻혀 안 읽힌다 —
       * 참가자가 실패 이유를 못 읽으면 조작 점검(왜 실패했는지)이 성립하지 않는다. */
      ctx.fillStyle = 'rgba(2, 10, 20, 0.55)';          // 화면 전체를 한 번 죽이고
      ctx.fillRect(0, 0, width, height);
      const bandTop = height / 2 - 230, bandH = 430;    // 글씨가 놓이는 띠는 한 번 더 죽인다
      const plate = ctx.createLinearGradient(0, bandTop, 0, bandTop + bandH);
      plate.addColorStop(0, 'rgba(2, 10, 20, 0)');
      plate.addColorStop(0.2, 'rgba(2, 10, 20, 0.8)');
      plate.addColorStop(0.85, 'rgba(2, 10, 20, 0.8)');
      plate.addColorStop(1, 'rgba(2, 10, 20, 0)');
      ctx.fillStyle = plate; ctx.fillRect(0, bandTop, width, bandH);

      const s = state.resultAnim; const progress = Math.min(1, (1 - s.t) * 5); const isSuccess = s.type !== 'FAILURE';
      const bounce = isSuccess ? Math.sin(progress * Math.PI) * 0.2 : 0; const scale = (0.4 + progress * 0.6) + bounce;
      const alpha = Math.min(1, progress * 3);
      ctx.save(); ctx.translate(width / 2, height / 2 - 80); ctx.scale(scale, scale); ctx.globalAlpha = alpha;
      ctx.fillStyle = isSuccess ? SEA.safe : SEA.risk; ctx.shadowColor = isSuccess ? 'rgba(63, 224, 200, 1.0)' : 'rgba(255, 92, 122, 0.8)'; ctx.shadowBlur = isSuccess ? 70 : 35; ctx.font = 'bold 98px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(s.type, 0, 0);
      if (state.failReason) {
        ctx.fillStyle = SEA.ink; ctx.font = 'bold 30px ' + KO_FONT; ctx.shadowBlur = 0; ctx.fillText(state.failReason, 0, 100);
        if (isSuccess) { ctx.font = 'bold 22px ' + KO_FONT; ctx.fillStyle = SEA.safe; ctx.fillText('▶ 결과를 성공적으로 바꿨습니다', 0, 145); }
        else { ctx.font = 'bold 20px ' + KO_FONT; ctx.fillStyle = 'rgba(234, 246, 255, 0.82)'; ctx.fillText('더 나은 선택이 가능했습니다', 0, 145); }
      }
      ctx.restore();
    }

    if (gamePhase === 'rewind_watch' || gamePhase === 'rewind_back') {
      ctx.fillStyle = SEA.ink; ctx.font = 'bold 40px monospace'; ctx.textAlign = 'center'; ctx.shadowColor = 'rgba(255, 92, 122, 0.8)'; ctx.shadowBlur = 20;
      ctx.fillText(gamePhase === 'rewind_watch' ? 'COLLISION!' : '◀◀ REWIND', width / 2, height / 2 + 80);
      ctx.shadowBlur = 0;
    }
    if (gamePhase === 'ended') { ctx.fillStyle = gameResult === 'success' ? 'rgba(4, 42, 54, 0.15)' : 'rgba(0, 6, 14, 0.45)'; ctx.fillRect(0, 0, width, height); }
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
        SFX.play('grab');   // 첫 조작 — 세탁 자극의 시트 첫 드래그와 같은 자리다
      }
    };
    window.addEventListener('mousemove', move); window.addEventListener('touchmove', move);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('touchmove', move); };
  }, [stage, gamePhase]);

  return (
    <div className="microgate-app">
      {stage === STAGES.PLAY && (
        <div className="game-container">
          {/* 캔버스와 제품 카드가 정확히 같은 사각형을 차지하도록 둘을 한 스테이지에 넣는다.
              세탁 자극의 #stage 와 같은 구조라, 카드 안의 cq 단위가 두 자극에서 같은 뜻이 된다. */}
          <div className="stage">
            {CFG.debug && (
              <p className="dbg-line dbg-overlay">
                sid={CFG.sid} · mode={CFG.mode} · ver={CFG.ver} · block={String(CFG.block)} · {gamePhase}
                {LOG.VER_FALLBACK ? ' · ⚠ 해당 ver 타임라인 없음 → A 재생' : ''}
              </p>
            )}
            {IS_TUTORIAL && (
              <div className="tutorial-overlay" style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.7)', padding: '10px 20px', borderRadius: '20px', zIndex: 10, pointerEvents: 'none', width: 'auto', textAlign: 'center', color: '#3fe0c8', border: '1px solid #3fe0c8' }}>마우스/드래그로 좌우로 이동하여 파워를 높이세요!</div>
            )}
            <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="game-canvas"></canvas>

            {/* [되돌리기] — 실패를 본 참가자가 수정을 시작하는 자리.
                개입 조건에만 나온다(시청 조건에는 되감기 자체가 없다). */}
            {gamePhase === 'rewind_watch' && (
              <div className="rewind-prompt">
                <p className="rw-msg">지금 이 선택을 되돌린다면?</p>
                <button type="button" className="rewind-btn" onClick={onRewind}>되돌리기</button>
              </div>
            )}

            {/* 제품 메시지 + CTA — 세탁 장면 10 에 대응한다 */}
            {gamePhase === 'product_card' && (
              <div className="product-card">
                <div className="pc-icon" aria-hidden="true">
                  {/* 잠수정 옆모습 — 자극 화면의 잠수정과 같은 물건으로 읽혀야 한다 */}
                  <svg viewBox="0 0 120 120" role="presentation">
                    <defs>
                      <linearGradient id="pc-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="#0b3a56" />
                        <stop offset="1" stopColor="#02101c" />
                      </linearGradient>
                    </defs>
                    <rect x="2" y="2" width="116" height="116" rx="28"
                      fill="url(#pc-grad)" stroke="#3fe0c8" strokeWidth="3" />
                    <path d="M34,60 q0,-16 26,-16 h10 q22,0 26,16 q-4,16 -26,16 h-10 q-26,0 -26,-16 Z"
                      fill="#e6eef6" />
                    <path d="M58,44 q6,-12 14,-12 q-2,8 -4,12 Z" fill="#8fa8bd" />
                    <circle cx="76" cy="58" r="7" fill="#7fe9ff" />
                    <path d="M30,52 q-10,8 0,16" fill="none" stroke="#9fe8ff" strokeWidth="4"
                      strokeLinecap="round" opacity="0.8" />
                    <path d="M92,54 q10,6 16,2 M92,66 q10,-6 16,-2" fill="none" stroke="#3fe0c8"
                      strokeWidth="3" strokeLinecap="round" opacity="0.55" />
                  </svg>
                </div>
                <p className="pc-name">{APP.name}</p>
                <div className="pc-rule" />
                <p className="pc-genre">{APP.genre}</p>
                <p className="pc-msg">{APP.message}</p>
                <button type="button" className="ad-close" aria-label="광고 닫기" onClick={onClose}>
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M7 7 L17 17 M17 7 L7 17" />
                  </svg>
                </button>
                <button type="button" className="cta" onClick={onCta}>{APP.cta}</button>
                <p className="pc-note">{APP.note}</p>
              </div>
            )}
          </div>
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
