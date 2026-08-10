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

// --- 사운드 매니저 (Web Audio API) ---
const createSoundManager = () => {
  let ctx = null;

  const init = () => {
    if (!CFG.sound) return;
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
  };

  const playOsc = (freq, type, duration, volume, decay = 0.1) => {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  };

  return {
    init,
    playGate: (isPositive) => {
      init();
      if (isPositive) {
        playOsc(660, 'sine', 0.1, 0.15);
        setTimeout(() => playOsc(880, 'sine', 0.1, 0.1), 50);
      } else {
        playOsc(220, 'sine', 0.15, 0.2);
      }
    },
    playCollision: () => {
      init();
      // Noise-like sound using square wave and quick decay
      playOsc(110, 'square', 0.3, 0.2);
      playOsc(55, 'sawtooth', 0.4, 0.2);
    },
    playSuccess: () => {
      init();
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      notes.forEach((freq, i) => {
        setTimeout(() => playOsc(freq, 'sine', 0.4, 0.15 - i * 0.02), i * 100);
      });
    },
    playClick: () => {
      init();
      playOsc(1200, 'sine', 0.05, 0.1);
    },
    playRewind: () => {
      init();
      if (!ctx) return;
      // Series of rising chirps
      for (let i = 0; i < 5; i++) {
        setTimeout(() => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.frequency.setValueAtTime(100 + i * 200, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(1000 + i * 200, ctx.currentTime + 0.1);
          gain.gain.setValueAtTime(0.1, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.1);
          osc.connect(gain); gain.connect(ctx.destination);
          osc.start(); osc.stop(ctx.currentTime + 0.1);
        }, i * 60);
      }
    },
    playIntervention: () => {
      init();
      playOsc(440, 'sine', 0.2, 0.2);
      setTimeout(() => playOsc(880, 'sine', 0.4, 0.15), 100);
    }
  };
};

const soundManager = createSoundManager();

/** 자극 하나의 진행 단계 — 러너가 붙기 전의 STAGES(인트로·설문·완료)는 전부 없앴다 */
const STAGES = {
  READY: 'ready',   // 시작 버튼. Web Audio 는 이 iframe 안의 클릭이 있어야 소리를 낸다
  PLAY: 'play',
  ENDED: 'ended'    // 종료 통지 후 러너가 화면을 걷어갈 때까지의 대기 화면
};

// --- 타임라인 데이터 ---
const TUTORIAL_TIMELINE = [
  { type: 'gate', t: 40, x1: 20, w1: 180, p1: 10, x2: 280, w2: 180, p2: 5 },
  { type: 'enemy', t: 120, x: 140, w: 200, h: 60, hp: 3 },
  { type: 'gate', t: 200, x1: 20, w1: 180, p1: 5, x2: 280, w2: 180, p2: 15 },
  { type: 'enemy', t: 300, x: 80, w: 320, h: 80, hp: 8 }
];

const MAIN_TIMELINE = [
  { type: 'gate', t: 40, x1: 20, w1: 100, p1: 12, x2: 130, w2: 330, p2: 5, autoTarget: 295 },
  { type: 'enemy', t: 110, x: 300, w: 100, h: 50, hp: 3 },
  { type: 'enemy', t: 170, x: 140, w: 200, h: 80, hp: 7 },
  { type: 'gate', t: 240, x1: 300, w1: 150, p1: 3, x2: 20, w2: 270, p2: 1, autoTarget: 155 },
  { type: 'gate', t: 310, x1: 20, w1: 330, p1: 6, x2: 360, w2: 100, p2: 15, autoTarget: 185 },
  { type: 'enemy', t: 380, x: 40, w: 120, h: 50, hp: 4 },
  { type: 'enemy', t: 450, x: 100, w: 280, h: 80, hp: 6 },
  { type: 'gate', t: 520, x1: 200, w1: 260, p1: 10, x2: 20, w2: 170, p2: 2, autoTarget: 105 },
  { type: 'gate', t: 600, x1: 20, w1: 150, p1: 15, x2: 180, w2: 280, p2: 5, autoTarget: 320 },
  { type: 'enemy', t: 680, x: 50, w: 150, h: 60, hp: 8 },
  { type: 'enemy', t: 760, x: 90, w: 300, h: 100, hp: 15 },
  { type: 'gate', t: 850, x1: 20, w1: 210, p1: 20, x2: 250, w2: 210, p2: 10 },
  { type: 'enemy', t: 940, x: 140, w: 200, h: 70, hp: 12 },
  { type: 'gate', t: 1020, x1: 20, w1: 100, p1: 25, x2: 130, w2: 330, p2: 5 },
  { type: 'enemy', t: 1120, x: 40, w: 400, h: 100, hp: 20 }
];

/* 평행 자극(ver) — 같은 참가자가 시청·개입을 모두 겪으므로 두 번째 노출은 다른 스테이지여야 한다.
 * B 는 아직 없다. 요청되면 A 로 재생하고 LOG.VER_FALLBACK 에 1 을 남겨 데이터에서 드러나게 한다.
 * 조용히 A 를 두 번 보여 주는 것이 제일 나쁘다. */
const TIMELINES = { A: MAIN_TIMELINE, B: null };

const resolveTimeline = () => {
  if (IS_TUTORIAL) return TUTORIAL_TIMELINE;
  const wanted = TIMELINES[CFG.ver];
  if (!wanted) {
    LOG.VER_FALLBACK = 1;
    return MAIN_TIMELINE;
  }
  return wanted;
};

const MicrogateExperiment = () => {
  const [stage, setStage] = useState(STAGES.READY);
  const [gamePhase, setGamePhase] = useState('none');
  const [gameResult, setGameResult] = useState('');
  const [isSlowMo, setIsSlowMo] = useState(false);

  const canvasRef = useRef(null);
  const reqRef = useRef(null);
  const gameState = useRef({
    ship: { x: 220, y: 550, w: 40, h: 40, power: 10, isDead: false, vx: 0, vy: 0, ang: 0, av: 0 },
    gates: [], enemies: [], stars: [], particles: [], rings: [], speed: 5, time: 0, eventIdx: 0, history: [],
    flash: 0, slowFactor: 1, timeline: MAIN_TIMELINE,
    shake: 0, resultAnim: { type: '', t: 0 }, vignette: 0, failReason: '', isEnding: false
  });
  const input = useRef({ left: false, right: false, mouseX: null });

  /* 로그용 시각 — 렌더 사이에 값이 상하지 않도록 state 가 아니라 ref 에 둔다 */
  const marks = useRef({ interveneStart: 0, firstDrag: 0 });

  const initGame = () => {
    gameState.current = {
      ship: { x: 220, y: 550, w: 40, h: 40, power: 10, isDead: false, vx: 0, vy: 0, ang: 0, av: 0 },
      gates: [], enemies: [], stars: Array.from({ length: 30 }, () => ({ x: Math.random() * 480, y: Math.random() * 720, s: 1 + Math.random() * 3 })),
      particles: [], rings: [], speed: 5, time: 0, eventIdx: 0, history: [],
      flash: 0, slowFactor: 1,
      timeline: resolveTimeline(),
      shake: 0, resultAnim: { type: '', t: 0 }, vignette: 0, failReason: '', isEnding: false
    };
    setIsSlowMo(false);
    // 튜토리얼은 처음부터 참가자가 조작한다. 본 자극은 두 조건 모두 자동 재생 실패로 시작한다.
    setGamePhase(IS_TUTORIAL ? 'tutorial_play' : 'autoplay_fail_watch');
    input.current = { left: false, right: false, mouseX: null };
  };

  const startStimulus = () => {
    soundManager.init();   // 이 클릭이 Web Audio 를 깨우는 유일한 제스처다
    soundManager.playClick();
    initGame();
    LOG.t_start = Date.now();
    marks.current = { interveneStart: 0, firstDrag: 0 };
    setStage(STAGES.PLAY);
  };

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
      soundManager.playSuccess();
      state.resultAnim = { type: result === 'rescue_success' ? '개입 성공' : '연습 완료', t: 1.0 };
      state.vignette = -2.5; state.flash = 1.0; state.shake = 12;
      state.ship.vy = -18; state.ship.vx = 0;
      spawnParticles(state.ship.x + state.ship.w / 2, state.ship.y + state.ship.h / 2, 100, '#00ffff', 18, 6);
      for (let i = 0; i < 4; i++) {
        setTimeout(() => {
          state.rings.push({ x: state.ship.x + state.ship.w / 2, y: state.ship.y + state.ship.h / 2, r: 10, life: 1.0, speed: 12 + i * 4, color: i % 2 === 0 ? '#ffffff' : '#00ffff' });
        }, i * 100);
      }
      if (result === 'rescue_success') {
        state.failReason = '직접 개입해 결과를 바꿨습니다!';
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
          soundManager.playGate(g.p1 > 0);
        }
        else if (s.x + s.w / 2 > g.x2 && s.x + s.w / 2 < g.x2 + g.w2) {
          state.ship.power += g.p2; g.passed = true; LOG.GATES_PASSED++;
          spawnParticles(s.x + s.w / 2, g.y + 20, 15, g.p2 > 0 ? '#00ffcc' : '#ff3366', 4);
          soundManager.playGate(g.p2 > 0);
        }
        if (state.ship.power <= 0) onFail('POWER DEPLETED');
      }
    });
    state.enemies.forEach(e => {
      if (!e.dead && s.x < e.x + e.w && s.x + s.w > e.x && s.y < e.y + e.h && s.y + s.h > e.y) {
        if (state.ship.power >= e.hp) {
          state.ship.power -= e.hp; e.dead = true; state.shake = 12; state.flash = 0.35;
          spawnParticles(e.x + e.w / 2, e.y + e.h / 2, 20, '#ff3366', 7);
          soundManager.playGate(false); // Thud sound
        }
        else onFail(`HP ${e.hp} > POWER ${state.ship.power}`);
      }
    });
  };

  const updateGame = useCallback(() => {
    const state = gameState.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;

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
          if (state.history.length > 800) state.history.shift();
        }
        const imminentEnemy = state.enemies.find(e => !e.dead && e.y + e.h > state.ship.y - 80 && e.y < state.ship.y + state.ship.h);
        if (imminentEnemy && state.ship.power < imminentEnemy.hp) {
          state.slowFactor = Math.max(0.1, state.slowFactor - 0.04); setIsSlowMo(true);
        } else { state.slowFactor = Math.min(1.0, state.slowFactor + 0.1); setIsSlowMo(false); }
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
        spawnParticles(state.ship.x + state.ship.w / 2, state.ship.y + state.ship.h / 2, 35, '#ffcc33', 12, 4);
        spawnParticles(state.ship.x + state.ship.w / 2, state.ship.y + state.ship.h / 2, 25, '#ff3366', 8, 6);
        soundManager.playCollision();

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
            setTimeout(() => { setGamePhase('rewind_back'); soundManager.playRewind(); }, 1000);
          }
        }, 800);
      });
      if (state.time > 450 && IS_TUTORIAL) endStimulus('tutorial_done');
      if (state.time > 1250 && gamePhase === 'rewind_rescue') endStimulus('rescue_success');
    } else if (gamePhase === 'rewind_back') {
      if (state.history.length > 0 && state.time > 480) {
        for (let i = 0; i < 15; i++) { if (state.history.length > 0) { const p = state.history.pop(); Object.assign(state, p); } }
      } else if (!marks.current.interveneStart) {
        /* setGamePhase 는 비동기라 다음 렌더까지 이 분기가 몇 프레임 더 돌 수 있다.
         * 기준 시각을 덮어쓰거나 효과음을 겹쳐 내지 않도록 진입을 한 번으로 막는다. */
        marks.current.interveneStart = Date.now();   // 개입 구간 진입 — DWELL_INT 의 기준점
        setGamePhase('rewind_rescue');
        soundManager.playIntervention();
      }
    }

    // --- Rendering ---
    ctx.save();
    if (state.shake > 0) { ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake); state.shake *= 0.85; }
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

    if (state.flash > 0) { const flashColor = gameResult === 'success' ? '200, 255, 255' : '255, 255, 255'; ctx.fillStyle = `rgba(${flashColor}, ${state.flash})`; ctx.fillRect(0, 0, width, height); state.flash -= 0.04; }
    if (state.vignette !== 0) {
      const grad = ctx.createRadialGradient(width / 2, height / 2, width * 0.05, width / 2, height / 2, width * 0.95);
      if (state.vignette > 0) { grad.addColorStop(0, 'rgba(0, 0, 0, 0)'); grad.addColorStop(1, `rgba(100, 0, 10, ${state.vignette * 0.85})`); }
      else { grad.addColorStop(0, `rgba(0, 255, 255, ${Math.abs(state.vignette) * 0.3})`); grad.addColorStop(1, 'rgba(0, 0, 0, 0)'); }
      ctx.fillStyle = grad; ctx.fillRect(0, 0, width, height);
      if (gamePhase !== 'ended' || gameResult === 'success') { state.vignette *= 0.97; if (Math.abs(state.vignette) < 0.01) state.vignette = 0; }
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
      ctx.restore(); if (s.t > 0) s.t -= isSuccess ? 0.004 : 0.01;
    }

    if (gamePhase === 'rewind_watch' || gamePhase === 'rewind_back') {
      ctx.fillStyle = '#fff'; ctx.font = 'bold 40px monospace'; ctx.textAlign = 'center'; ctx.shadowColor = 'rgba(255, 50, 80, 0.8)'; ctx.shadowBlur = 20;
      ctx.fillText(gamePhase === 'rewind_watch' ? 'COLLISION!' : '◀◀ REWIND', width / 2, height / 2 + 80);
      ctx.shadowBlur = 0;
    }
    if (gamePhase === 'ended') { ctx.fillStyle = gameResult === 'success' ? 'rgba(0, 40, 30, 0.15)' : 'rgba(0, 0, 0, 0.45)'; ctx.fillRect(0, 0, width, height); }
  }, [gamePhase, gameResult, endStimulus]);

  useEffect(() => {
    if (stage === STAGES.PLAY) {
      const loop = () => { if (gamePhase !== 'ended' || gameResult === 'success') updateGame(); reqRef.current = requestAnimationFrame(loop); };
      reqRef.current = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(reqRef.current);
    }
  }, [stage, gamePhase, updateGame, gameResult]);

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
      {stage === STAGES.READY && (
        <div className="card intro-card">
          <h1 className="logo">MICROGATE</h1>
          <div className="cond-display">
            {IS_TUTORIAL ? (
              <><h3>[ 조작 연습 ]</h3><p>마우스나 손가락을 좌우로 움직여 기체를 옮기고, <strong>파워를 높이는 게이트</strong>를 지나가세요.</p></>
            ) : IS_INTERVENE ? (
              <><h3>[ 개입형 ]</h3><p>실패 장면이 지나간 뒤 되감기 시점부터 <strong>직접 조작해 결과를 바꾸십시오.</strong></p></>
            ) : (
              <><h3>[ 시청형 ]</h3><p>조작 없이 <strong>보기만</strong> 하시면 됩니다.</p></>
            )}
          </div>
          <button className="btn primary" onClick={startStimulus}>시작</button>
          {CFG.debug && (
            <p className="dbg-line">
              sid={CFG.sid} · mode={CFG.mode} · ver={CFG.ver} · block={String(CFG.block)}
              {LOG.VER_FALLBACK ? ' · ⚠ ver=B 없음 → A 재생' : ''}
            </p>
          )}
        </div>
      )}

      {stage === STAGES.PLAY && (
        <div className="game-container">
          {IS_TUTORIAL && (
            <div className="tutorial-overlay" style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.7)', padding: '10px 20px', borderRadius: '20px', zIndex: 10, pointerEvents: 'none', width: 'auto', textAlign: 'center', color: '#00ffcc', border: '1px solid #00ffcc' }}>마우스/드래그로 좌우로 이동하여 파워를 높이세요!</div>
          )}
          <canvas ref={canvasRef} width="480" height="720" className="game-canvas"></canvas>
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
