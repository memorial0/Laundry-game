/* ==========================================================
 * practice.js — 조작 연습 (자극이 아니라 러너의 화면이다)
 *
 * 왜 광고 밖에 있나
 *   4블록 순서를 참가자마다 섞는 설계라, 연습이 특정 광고에 붙어 있으면
 *     - 연습 위치가 참가자마다 달라져 순서효과와 뒤엉키고
 *     - "연습 다음은 그 광고"라는 단서가 생기고
 *     - 연습이 붙은 자극만 사전 노출을 더 받는다.
 *   그래서 사전 문항 직후 한 번, 모든 참가자에게 같은 자리에 둔다.
 *
 * 왜 도형인가
 *   게임 화면으로 연습시키면 게임 세계를 광고보다 먼저 보게 되고, 세탁 시트로 연습시키면
 *   "제품을 안 써서 실패한다"는 광고의 전제가 미리 새어 나간다. 두 광고 중 어느 쪽도
 *   드러내지 않으면서 조작만 익히려면 중립 도형이어야 한다.
 *
 * 두 조작은 각각 어느 자극에 대응한다 — 드래그는 세탁(시트 투입), 좌우 이동은 게임(구출).
 * 어느 것이 어느 광고용인지는 말하지 않는다.
 *
 * 지켜야 할 것
 *   - 비난 문구 없음. 못 해도 그냥 다시 놓인다(계획서 8항 좌절 방지).
 *   - 성과 피드백 없음. 점수·정답·등급을 매기지 않는다.
 *   - 8초 무조작이면 안내가 뜬다. 안내는 대신 해 주지 않는다(세탁 자극과 같은 규칙).
 *   - 시간은 경과 시간으로 센다. 프레임 수로 세면 120Hz 화면에서 2배 빨라진다.
 *
 * 쓰는 법
 *   PRACTICE.mount(컨테이너, function (log) { ... });   // 두 단계를 다 끝내면 부른다
 * ========================================================== */
(function () {
  'use strict';

  var IDLE_MS = 8000;      // 무조작 안내가 뜨기까지 (세탁 자극 ART.S6.IDLE_MS 와 같은 값)
  var GAP_W = 130;         // 2단계 빈 곳의 너비
  var BAR_SPEED = 95;      // px/초 — 3초 안쪽에 내려온다
  var PASSES_NEEDED = 2;   // 좌·우 한 번씩

  var STEP1_TEXT = '동그라미를 상자 안으로 끌어다 놓아 주세요.';
  var STEP2_TEXT = '좌우로 움직여 빈 곳을 지나가 주세요.';
  var STEP1_HINT = '동그라미를 손가락(또는 마우스)으로 누른 채 상자까지 옮겨 주세요.';
  var STEP2_HINT = '화면 위에서 손가락(또는 마우스)을 좌우로 움직여 보세요.';
  var LEAD = '광고를 보기 전에, 이 연구에서 사용하는 조작을 잠깐 익혀 보겠습니다.';

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function mount(host, onDone) {
    var log = {
      PRACTICE_DRAG_ATTEMPTS: 0,   // 상자 밖에 놓은 횟수
      PRACTICE_MOVE_ATTEMPTS: 0,   // 빈 곳을 못 지난 횟수
      PRACTICE_HINTS: 0,           // 안내가 뜬 횟수
      PRACTICE_SEC: null
    };
    var t0 = Date.now();
    var finished = false;

    host.innerHTML = '';
    var card = el('div', 'card');
    var lead = el('p', 'lead', LEAD);
    var stage = el('div', 'pr-stage');
    var say = el('p', 'pr-say');
    var hint = el('p', 'pr-hint');
    card.appendChild(lead);
    card.appendChild(say);
    card.appendChild(stage);
    card.appendChild(hint);
    host.appendChild(card);

    /* 무조작 안내 — 두 단계가 같은 타이머를 쓴다 */
    var idleTimer = null;
    function armIdle(text) {
      clearTimeout(idleTimer);
      hint.textContent = '';
      idleTimer = setTimeout(function () {
        hint.textContent = text;
        log.PRACTICE_HINTS++;
      }, IDLE_MS);
    }
    function touched(text) { armIdle(text); }

    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(idleTimer);
      log.PRACTICE_SEC = Math.round((Date.now() - t0) / 100) / 10;
      onDone(log);
    }

    /* ---------- 1단계 · 드래그 ---------- */
    function step1() {
      say.textContent = STEP1_TEXT;
      stage.innerHTML = '';
      stage.className = 'pr-stage pr-drag';

      var target = el('div', 'pr-target');
      var dot = el('div', 'pr-dot');
      stage.appendChild(target);
      stage.appendChild(dot);

      var dragging = false, dx = 0, dy = 0, home = null;

      function place() {
        var sb = stage.getBoundingClientRect();
        home = { x: sb.width / 2 - 34, y: sb.height - 92 };
        dot.style.left = home.x + 'px';
        dot.style.top = home.y + 'px';
      }
      place();
      armIdle(STEP1_HINT);

      dot.addEventListener('pointerdown', function (e) {
        dragging = true;
        dot.setPointerCapture(e.pointerId);
        dot.classList.add('is-held');
        var r = dot.getBoundingClientRect();
        dx = e.clientX - r.left;
        dy = e.clientY - r.top;
        touched(STEP1_HINT);
        e.preventDefault();
      });

      dot.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        var sb = stage.getBoundingClientRect();
        dot.style.left = (e.clientX - sb.left - dx) + 'px';
        dot.style.top = (e.clientY - sb.top - dy) + 'px';
      });

      dot.addEventListener('pointerup', function (e) {
        if (!dragging) return;
        dragging = false;
        dot.classList.remove('is-held');
        var d = dot.getBoundingClientRect(), t = target.getBoundingClientRect();
        var cx = d.left + d.width / 2, cy = d.top + d.height / 2;
        var inside = cx > t.left && cx < t.right && cy > t.top && cy < t.bottom;

        if (inside) {
          clearTimeout(idleTimer);
          hint.textContent = '';
          dot.classList.add('is-in');
          target.classList.add('is-in');
          setTimeout(step2, 700);
        } else {
          /* 목표 밖 — 비난하지 않고 제자리로 돌려놓기만 한다 */
          log.PRACTICE_DRAG_ATTEMPTS++;
          dot.classList.add('is-back');
          dot.style.left = home.x + 'px';
          dot.style.top = home.y + 'px';
          setTimeout(function () { dot.classList.remove('is-back'); }, 260);
          armIdle(STEP1_HINT);
        }
      });
    }

    /* ---------- 2단계 · 좌우 이동 ---------- */
    function step2() {
      say.textContent = STEP2_TEXT;
      stage.innerHTML = '';
      stage.className = 'pr-stage pr-move';

      var bar = el('div', 'pr-bar');
      var gapL = el('i');            // 빈 곳 왼쪽 막대
      var gapR = el('i');            // 빈 곳 오른쪽 막대
      bar.appendChild(gapL);
      bar.appendChild(gapR);
      var me = el('div', 'pr-me');
      stage.appendChild(bar);
      stage.appendChild(me);

      /* 화면 크기는 매 프레임 다시 잰다. 한 번만 재 두면 화면을 돌렸을 때(세로↔가로)
       * 빈 곳이 화면 밖으로 나가 아무리 움직여도 못 지나가는 상태가 된다. */
      var meW = 46;
      var W = 0, H = 0, meY = 0, gapW = GAP_W;
      var meX = 0, aimX = null;
      var pass = 0, barY = -22, running = true, moved = false;

      me.style.width = meW + 'px';

      function measure() {
        W = stage.clientWidth || stage.getBoundingClientRect().width;
        H = stage.clientHeight || stage.getBoundingClientRect().height;
        /* 좁은 화면에서는 빈 곳도 같이 좁아져야 한다. 고정 130px 이면 폭이 작은 기기에서
         * 빈 곳이 화면을 넘어가 통과 자체가 불가능해진다. */
        gapW = Math.max(meW + 24, Math.min(GAP_W, W * 0.42));
        meY = H - 62;
        me.style.top = meY + 'px';
        if (aimX === null) { meX = W / 2 - meW / 2; aimX = meX; }
      }

      function layoutBar() {
        /* 빈 곳 위치는 참가자마다 같아야 한다 — 무작위로 두면 연습 난이도가 사람마다 달라진다.
         * 화면 폭에 대한 비율로 잡아 기기가 달라도 같은 자리에 온다. */
        var gx = W * (pass % 2 === 0 ? 0.24 : 0.72) - gapW / 2;
        gx = Math.max(6, Math.min(Math.max(6, W - gapW - 6), gx));
        gapL.style.left = '0px';
        gapL.style.width = gx + 'px';
        gapR.style.left = (gx + gapW) + 'px';
        gapR.style.width = Math.max(0, W - gx - gapW) + 'px';
        bar._gx = gx;
      }
      measure();
      layoutBar();
      armIdle(STEP2_HINT);

      function onMove(e) {
        var sb = stage.getBoundingClientRect();
        aimX = e.clientX - sb.left - meW / 2;
        if (!moved) { moved = true; touched(STEP2_HINT); }
      }
      stage.addEventListener('pointermove', onMove);
      stage.addEventListener('pointerdown', onMove);

      var prev = null;
      function tick(ts) {
        if (!running) return;
        if (prev === null) prev = ts;
        var dt = Math.min(0.05, (ts - prev) / 1000);   // 탭 전환으로 크게 벌어진 간격은 자른다
        prev = ts;

        var prevW = W;
        measure();
        if (W < meW + 40) { requestAnimationFrame(tick); return; }   // 아직 그려지기 전
        if (W !== prevW) layoutBar();                                // 화면이 바뀌면 다시 놓는다

        meX += (aimX - meX) * Math.min(1, dt * 12);
        meX = Math.max(0, Math.min(W - meW, meX));
        me.style.left = meX + 'px';

        barY += BAR_SPEED * dt;
        bar.style.top = barY + 'px';

        /* 막대가 내 줄을 지나는 순간에만 판정한다 */
        if (barY + 14 >= meY && barY <= meY + 46) {
          var inGap = meX > bar._gx && meX + meW < bar._gx + gapW;
          if (!inGap) {
            log.PRACTICE_MOVE_ATTEMPTS++;
            barY = -22; layoutBar();
            me.classList.add('is-bump');
            setTimeout(function () { me.classList.remove('is-bump'); }, 240);
            armIdle(STEP2_HINT);
            requestAnimationFrame(tick);
            return;
          }
        }

        if (barY > H) {
          pass++;
          if (pass >= PASSES_NEEDED) {
            running = false;
            clearTimeout(idleTimer);
            hint.textContent = '';
            me.classList.add('is-in');
            setTimeout(finish, 600);
            return;
          }
          barY = -22; layoutBar();
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }

    step1();
    return { log: log };
  }

  var api = { mount: mount, IDLE_MS: IDLE_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PRACTICE = api;
})();
