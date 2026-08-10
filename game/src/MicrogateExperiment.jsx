import React, { useState, useEffect, useRef, useCallback } from 'react';

// --- 사운드 매니저 (Web Audio API) ---
const createSoundManager = () => {
  let ctx = null;

  const init = () => {
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

const STAGES = {
  INTRO: 'intro',
  COMMON_INFO: 'common_info',
  TUTORIAL_PLAY: 'tutorial_play',
  SESSION_INTRO: 'session_intro',
  SESSION_PLAY: 'session_play',
  SESSION_SURVEY: 'session_survey',
  FINAL_SURVEY: 'final_survey',
  COMPLETION: 'completion'
};

const CONDITION_ORDER = ['rewind', 'fail'];
const EMPTY_SURVEY = { interesting: 0, agency: 0, betterThanFail: 0, wantToPlay: 0, schadenfreude: 0 };

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

const MicrogateExperiment = () => {
  const [stage, setStage] = useState(STAGES.INTRO);
  const [log, setLog] = useState({ participantId: '', startedAt: '', sessions: [], finalSurvey: {}, completed: false });
  const [pidInput, setPidInput] = useState('');
  const [currentSessionIndex, setCurrentSessionIndex] = useState(0);
  const [sessionStartTime, setSessionStartTime] = useState(0);
  const [sessionSurvey, setSessionSurvey] = useState(EMPTY_SURVEY);
  const [finalSurvey, setFinalSurvey] = useState({ mostAttractive: '', mostWantToInstall: '', reason: '' });
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
  const condition = CONDITION_ORDER[currentSessionIndex];

  const handleStartIntro = () => {
    soundManager.init();
    soundManager.playClick();
    const id = pidInput.trim() || 'anonymous';
    setLog(prev => ({ ...prev, participantId: id, startedAt: new Date().toISOString() }));
    setStage(STAGES.COMMON_INFO);
  };

  const initGame = (isTutorial = false) => {
    gameState.current = {
      ship: { x: 220, y: 550, w: 40, h: 40, power: 10, isDead: false, vx: 0, vy: 0, ang: 0, av: 0 },
      gates: [], enemies: [], stars: Array.from({length: 30}, () => ({x: Math.random()*480, y: Math.random()*720, s: 1+Math.random()*3})),
      particles: [], rings: [], speed: 5, time: 0, eventIdx: 0, history: [],
      flash: 0, slowFactor: 1,
      timeline: isTutorial ? TUTORIAL_TIMELINE : MAIN_TIMELINE,
      shake: 0, resultAnim: { type: '', t: 0 }, vignette: 0, failReason: '', isEnding: false
    };
    setIsSlowMo(false);
    setGamePhase(isTutorial ? 'tutorial_play' : 'autoplay_fail_watch');
    input.current = { left: false, right: false, mouseX: null };
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

  const endSession = useCallback((result, score, rescue, rewind) => {
    // Synchronous guard to prevent double calls during stage transition
    if (gameState.current.isEnding) return;
    gameState.current.isEnding = true;
    
    const state = gameState.current;
    const currentStage = stage; // Capture stage at call time

    if (result === 'success') {
      soundManager.playSuccess();
      state.resultAnim = { type: rescue && rewind ? '개입 성공' : '구출 성공', t: 1.0 };
      state.vignette = -2.5; state.flash = 1.0; state.shake = 12;
      state.ship.vy = -18; state.ship.vx = 0;
      const particleColor = '#00ffff';
      spawnParticles(state.ship.x + state.ship.w/2, state.ship.y + state.ship.h/2, 100, particleColor, 18, 6);
      for(let i=0; i<4; i++) {
        setTimeout(() => {
          state.rings.push({ x: state.ship.x + state.ship.w/2, y: state.ship.y + state.ship.h/2, r: 10, life: 1.0, speed: 12 + i*4, color: i % 2 === 0 ? '#ffffff' : '#00ffff' });
        }, i * 100);
      }
      if (rescue && rewind) {
        state.failReason = "직접 개입해 결과를 바꿨습니다!";
        setTimeout(() => { spawnParticles(state.ship.x + state.ship.w/2, state.ship.y + state.ship.h/2, 150, '#ffffff', 25, 4); state.flash = 1.0; state.shake = 25; state.vignette = -3.0; }, 300);
      } else { state.failReason = "위험 구간을 돌파했습니다!"; }
      setGameResult(result); setGamePhase('ended');
    } else {
      state.resultAnim = { type: 'FAILURE', t: 1.0 }; state.vignette = 1.0; setGameResult(result);
      setTimeout(() => { setGamePhase('ended'); }, 800);
    }

    // Stage transition logic
    if (currentStage === STAGES.TUTORIAL_PLAY) {
      setTimeout(() => {
        setStage(STAGES.SESSION_INTRO);
      }, 2500);
      return;
    }

    const duration = Date.now() - sessionStartTime;
    setLog(prev => {
      const newSessions = [...prev.sessions];
      newSessions[currentSessionIndex] = { sessionIndex: currentSessionIndex+1, condition, result, score, durationMs: duration, rescueSuccess: rescue, rewindOccurred: rewind, survey: {} };
      return { ...prev, sessions: newSessions };
    });
    
    const delay = result === 'success' ? 3500 : 2500;
    setTimeout(() => {
      setStage(STAGES.SESSION_SURVEY);
    }, delay);
  }, [sessionStartTime, currentSessionIndex, condition, stage]);

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
          state.ship.x += (currentGate.autoTarget - (state.ship.x + state.ship.w/2)) * 0.04;
          state.ship.x += Math.sin(state.time * 0.1) * 0.5;
        }
        if (condition === 'rewind') {
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
          state.ship.x += (input.current.mouseX - state.ship.w/2 - state.ship.x) * 0.2;
          if (state.ship.x < 0) state.ship.x = 0; if (state.ship.x > width - state.ship.w) state.ship.x = width - state.ship.w;
        }
      }
      state.gates.forEach(g => g.y += currentSpeed);
      state.enemies.forEach(e => e.y += currentSpeed);
      checkCollisions(state, (reason) => {
        state.ship.isDead = true; state.ship.vx = (Math.random() - 0.5) * 15; state.ship.vy = (Math.random() * 5 + 5); state.ship.av = (Math.random() - 0.5) * 0.4;
        state.flash = 0.8; state.shake = 35; state.vignette = 1.0; state.failReason = reason;
        spawnParticles(state.ship.x + state.ship.w/2, state.ship.y + state.ship.h/2, 35, '#ffcc33', 12, 4);
        spawnParticles(state.ship.x + state.ship.w/2, state.ship.y + state.ship.h/2, 25, '#ff3366', 8, 6);
        soundManager.playCollision();

        if (condition === 'fail' || gamePhase === 'rewind_rescue' || stage === STAGES.TUTORIAL_PLAY) { endSession('fail', 0, gamePhase === 'rewind_rescue', condition === 'rewind'); }
        else { setTimeout(() => { if (gamePhase !== 'ended') { setGamePhase('rewind_watch'); setTimeout(() => { setGamePhase('rewind_back'); soundManager.playRewind(); }, 1000); } }, 800); }
      });
      if (state.time > 450 && stage === STAGES.TUTORIAL_PLAY) endSession('success', 100, true, false);
      if (state.time > 1250 && gamePhase === 'rewind_rescue') endSession('success', 500, true, true);
    } else if (gamePhase === 'rewind_back') {
      if (state.history.length > 0 && state.time > 480) {
        for(let i=0; i<15; i++) { if (state.history.length > 0) { const p = state.history.pop(); Object.assign(state, p); } }
      } else { 
        setGamePhase('rewind_rescue'); 
        soundManager.playIntervention();
      }
    }

    // --- Rendering ---
    ctx.save();
    if (state.shake > 0) { ctx.translate((Math.random()-0.5)*state.shake, (Math.random()-0.5)*state.shake); state.shake *= 0.85; }
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
        ctx.fillStyle = '#fff'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center'; ctx.fillText(isPos ? `+${power}` : power, x + w/2, g.y + 26);
      };
      drawBox(g.x1, g.w1, g.p1); drawBox(g.x2, g.w2, g.p2);
    });

    state.enemies.forEach(e => {
      if (e.dead) return;
      ctx.fillStyle = '#ff3366'; ctx.fillRect(e.x, e.y, e.w, e.h); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(e.x, e.y, e.w, e.h);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center'; ctx.fillText(`HP ${e.hp}`, e.x + e.w/2, e.y + e.h/2 + 8);
    });

    state.particles.forEach(p => { ctx.globalAlpha = p.life; ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size); });
    ctx.globalAlpha = 1.0;

    ctx.save(); ctx.translate(state.ship.x + state.ship.w/2, state.ship.y + state.ship.h/2); ctx.rotate(state.ship.ang);
    if (!state.ship.isDead) {
      const isVictory = gameResult === 'success' && gamePhase === 'ended';
      ctx.fillStyle = isVictory ? '#ffffff' : '#00ffff'; ctx.globalAlpha = isVictory ? 0.9 : (0.5 + Math.random()*0.5);
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
      ctx.fillText(state.ship.power, state.ship.x + state.ship.w/2, state.ship.y + state.ship.h + 28);
      ctx.shadowBlur = 0;
    }

    state.rings.forEach(r => { ctx.globalAlpha = r.life; ctx.strokeStyle = r.color || '#ffffff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI*2); ctx.stroke(); });
    ctx.globalAlpha = 1.0; ctx.restore();

    if (state.flash > 0) { const flashColor = gameResult === 'success' ? '200, 255, 255' : '255, 255, 255'; ctx.fillStyle = `rgba(${flashColor}, ${state.flash})`; ctx.fillRect(0, 0, width, height); state.flash -= 0.04; }
    if (state.vignette !== 0) {
      const grad = ctx.createRadialGradient(width/2, height/2, width*0.05, width/2, height/2, width*0.95);
      if (state.vignette > 0) { grad.addColorStop(0, 'rgba(0, 0, 0, 0)'); grad.addColorStop(1, `rgba(100, 0, 10, ${state.vignette * 0.85})`); }
      else { grad.addColorStop(0, `rgba(0, 255, 255, ${Math.abs(state.vignette) * 0.3})`); grad.addColorStop(1, 'rgba(0, 0, 0, 0)'); }
      ctx.fillStyle = grad; ctx.fillRect(0, 0, width, height);
      if (gamePhase !== 'ended' || gameResult === 'success') { state.vignette *= 0.97; if (Math.abs(state.vignette) < 0.01) state.vignette = 0; }
    }

    if (state.resultAnim.type) {
      const s = state.resultAnim; const progress = Math.min(1, (1 - s.t) * 5); const isSuccess = s.type !== 'FAILURE';
      const bounce = isSuccess ? Math.sin(progress * Math.PI) * 0.2 : 0; const scale = (0.4 + progress * 0.6) + bounce;
      const alpha = Math.min(1, progress * 3);
      ctx.save(); ctx.translate(width/2, height/2 - 80); ctx.scale(scale, scale); ctx.globalAlpha = alpha;
      ctx.fillStyle = isSuccess ? '#00ffff' : '#ff3366'; ctx.shadowColor = isSuccess ? 'rgba(0, 255, 255, 1.0)' : 'rgba(255, 0, 50, 0.8)'; ctx.shadowBlur = isSuccess ? 70 : 35; ctx.font = 'bold 98px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(s.type, 0, 0);
      if (state.failReason) {
        ctx.fillStyle = '#fff'; ctx.font = 'bold 32px monospace'; ctx.shadowBlur = 0; ctx.fillText(state.failReason, 0, 100);
        if (isSuccess) { ctx.font = 'bold 22px monospace'; ctx.fillStyle = '#00ffff'; ctx.fillText("▶ 결과를 성공적으로 바꿨습니다", 0, 145); }
        else { ctx.font = '18px monospace'; ctx.fillStyle = '#94a3b8'; ctx.fillText("더 나은 선택이 가능했습니다", 0, 145); }
      }
      ctx.restore(); if (s.t > 0) s.t -= isSuccess ? 0.004 : 0.01; 
    }

    if (gamePhase === 'rewind_watch' || gamePhase === 'rewind_back') {
      ctx.fillStyle = '#fff'; ctx.font = 'bold 40px monospace'; ctx.textAlign = 'center'; ctx.shadowColor = 'rgba(255, 50, 80, 0.8)'; ctx.shadowBlur = 20;
      ctx.fillText(gamePhase === 'rewind_watch' ? 'COLLISION!' : '◀◀ REWIND', width/2, height/2 + 80);
      ctx.shadowBlur = 0;
    } 
    if (gamePhase === 'ended') { ctx.fillStyle = gameResult === 'success' ? 'rgba(0, 40, 30, 0.15)' : 'rgba(0, 0, 0, 0.45)'; ctx.fillRect(0, 0, width, height); }
  }, [gamePhase, condition, gameResult, stage]); // endSession is now managed without being a dependency

  const checkCollisions = (state, onFail) => {
    const s = state.ship;
    state.gates.forEach(g => {
      if (!g.passed && g.y + 40 > s.y && g.y < s.y + s.h) {
        if (s.x + s.w/2 > g.x1 && s.x + s.w/2 < g.x1 + g.w1) { 
          state.ship.power += g.p1; g.passed = true; 
          spawnParticles(s.x + s.w/2, g.y + 20, 15, g.p1 > 0 ? '#00ffcc' : '#ff3366', 4);
          soundManager.playGate(g.p1 > 0);
        }
        else if (s.x + s.w/2 > g.x2 && s.x + s.w/2 < g.x2 + g.w2) { 
          state.ship.power += g.p2; g.passed = true; 
          spawnParticles(s.x + s.w/2, g.y + 20, 15, g.p2 > 0 ? '#00ffcc' : '#ff3366', 4);
          soundManager.playGate(g.p2 > 0);
        }
        if (state.ship.power <= 0) onFail("POWER DEPLETED");
      }
    });
    state.enemies.forEach(e => {
      if (!e.dead && s.x < e.x + e.w && s.x + s.w > e.x && s.y < e.y + e.h && s.y + s.h > e.y) {
        if (state.ship.power >= e.hp) { 
          state.ship.power -= e.hp; e.dead = true; state.shake = 12; state.flash = 0.35; 
          spawnParticles(e.x + e.w/2, e.y + e.h/2, 20, '#ff3366', 7);
          soundManager.playGate(false); // Thud sound
        }
        else onFail(`HP ${e.hp} > POWER ${state.ship.power}`);
      }
    });
  };

  useEffect(() => {
    if (stage === STAGES.SESSION_PLAY || stage === STAGES.TUTORIAL_PLAY) {
      const loop = () => { if (gamePhase !== 'ended' || gameResult === 'success') updateGame(); reqRef.current = requestAnimationFrame(loop); };
      reqRef.current = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(reqRef.current);
    }
  }, [stage, gamePhase, updateGame, gameResult]);

  useEffect(() => {
    if ((stage !== STAGES.SESSION_PLAY && stage !== STAGES.TUTORIAL_PLAY) || gamePhase === 'autoplay_fail_watch' || gamePhase === 'ended') return;
    const move = (e) => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.touches ? e.touches[0].clientX : e.clientX;
      input.current.mouseX = (x - rect.left) * (canvasRef.current.width / rect.width);
    };
    window.addEventListener('mousemove', move); window.addEventListener('touchmove', move);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('touchmove', move); };
  }, [stage, gamePhase]);

  const renderLikert = (key, question) => (
    <div className="survey-q">
      <p>{question}</p>
      <div className="likert-group">
        {[1, 2, 3, 4, 5, 6, 7].map(v => (
          <label key={v} className="likert-label">
            <input type="radio" checked={sessionSurvey[key] === v} onChange={() => setSessionSurvey(p => ({ ...p, [key]: v }))} />
            <span className="likert-circle">{v}</span>
          </label>
        ))}
      </div>
      <div className="likert-text"><span>1 전혀 아니다</span><span>4 보통이다</span><span>7 매우 그렇다</span></div>
    </div>
  );

  const exportCSV = () => {
    const rawId = log.participantId;
    const formattedId = /^\d+$/.test(rawId) ? `P${rawId.padStart(3, '0')}` : rawId;
    const headers = ["participantId", "session", "condition", "result", "durationMs", "q1_interesting", "q2_agency", "q3_betterThanFail", "q4_wantToPlay", "q5_schadenfreude", "final_attractive", "final_install", "final_reason"];
    let rows = log.sessions.map(s => {
      let detailedResult = s.result;
      if (s.condition === 'fail') detailedResult = 'scripted_fail';
      else if (s.condition === 'rewind') detailedResult = s.result === 'success' ? 'rescue_success' : 'rescue_fail';
      return [formattedId, s.sessionIndex, s.condition, detailedResult, s.durationMs, s.survey.interesting, s.survey.agency, s.survey.betterThanFail, s.survey.wantToPlay, s.survey.schadenfreude, log.finalSurvey.mostAttractive || "", log.finalSurvey.mostWantToInstall || "", `"${(log.finalSurvey.reason || "").replace(/"/g, '""')}"`];
    });
    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${formattedId}_full_data.csv`; a.click();
  };

  return (
    <div className="microgate-app">
      {stage === STAGES.INTRO && (
        <div className="card intro-card">
          <h1 className="logo">MICROGATE</h1>
          <p className="subtitle">광고 형식 비교 연구</p>
          <div className="intro-description">
            <p>본 프로토타입은 모바일 게임의 2가지 인터랙티브 광고 형식을 비교합니다.</p>
            <p>총 2개의 세션을 체험하며, 각 세션 종료 후 설문에 응답하게 됩니다.</p>
          </div>
          <div className="input-group"><label>참가자 ID</label><input type="text" placeholder="P001" value={pidInput} onChange={e => setPidInput(e.target.value)} /></div>
          <button className="btn primary" onClick={handleStartIntro}>연구 시작</button>
        </div>
      )}

      {stage === STAGES.COMMON_INFO && (
        <div className="card guide-card">
          <h2>실험 안내</h2>
          <div className="guide-content">
            <p>이번 연구에서 참가자는 2가지 광고 형식을 체험하게 됩니다.</p>
            <div className="guide-item"><strong>형식 1: 개입형 실패 광고</strong><p>실패 장면을 본 뒤, 되감기 후 직접 개입하는 형식입니다.</p></div>
            <div className="guide-item"><strong>형식 2: 실패 광고</strong><p>실패하는 장면을 보기만 하는 형식입니다.</p></div>
            <p>본 실험에 앞서 조작법을 익히기 위한 튜토리얼을 진행합니다.</p>
          </div>
          <button className="btn primary" onClick={() => { soundManager.playClick(); initGame(true); setStage(STAGES.TUTORIAL_PLAY); }}>튜토리얼 시작</button>
        </div>
      )}

      {stage === STAGES.TUTORIAL_PLAY && (
        <div className="game-container">
          <div className="tutorial-overlay" style={{position:'absolute', top:'20px', left:'50%', transform:'translateX(-50%)', background:'rgba(0,0,0,0.7)', padding:'10px 20px', borderRadius:'20px', zIndex:10, pointerEvents:'none', width:'auto', textAlign:'center', color:'#00ffcc', border:'1px solid #00ffcc'}}>마우스/드래그로 좌우로 이동하여 파워를 높이세요!</div>
          <canvas ref={canvasRef} width="480" height="720" className="game-canvas"></canvas>
        </div>
      )}

      {stage === STAGES.SESSION_INTRO && (
        <div className="card intro-card">
          <h2>세션 {currentSessionIndex + 1} / {CONDITION_ORDER.length}</h2>
          <div className="cond-display">
            {condition === 'rewind' ? (
              <><h3>[ 형식 1: 개입형 실패 광고 ]</h3><p>실패 장면 후 되감기 시점부터 <strong>직접 개입해 결과를 바꾸십시오.</strong></p></>
            ) : (
              <><h3>[ 형식 2: 실패 광고 ]</h3><p>이번 조건은 조작 없이 <strong>보기만</strong> 하시면 됩니다.</p></>
            )}
          </div>
          <button className="btn primary" onClick={() => { soundManager.playClick(); initGame(false); setSessionStartTime(Date.now()); setSessionSurvey(EMPTY_SURVEY); setStage(STAGES.SESSION_PLAY); }}>시작</button>
        </div>
      )}

      {(stage === STAGES.SESSION_PLAY) && (
        <div className="game-container"><canvas ref={canvasRef} width="480" height="720" className="game-canvas"></canvas></div>
      )}

      {stage === STAGES.SESSION_SURVEY && (
        <div className="card survey-card" key={`survey-session-${currentSessionIndex}`}>
          <h2>세션 설문 ({currentSessionIndex + 1}/{CONDITION_ORDER.length})</h2>
          <div className="survey-list">
            {renderLikert('interesting', '1. 이 광고 형식은 흥미로웠다.')}
            {renderLikert('agency', '2. 결과에 내가 영향을 줄 수 있다고 느꼈다.')}
            {renderLikert('betterThanFail', '3. 실패한 플레이보다 내가 더 잘할 수 있다고 느꼈다.')}
            {renderLikert('wantToPlay', '4. 이 게임을 직접 해보거나 설치하고 싶다.')}
            {renderLikert('schadenfreude', '5. 실패 장면을 보는 것이 재미있거나 통쾌했다.')}
          </div>
          <button className="btn primary" onClick={() => {
            soundManager.playClick();
            if (Object.values(sessionSurvey).some(v => v === 0)) return alert("모든 문항에 응답해 주세요.");
            setLog(prev => { const ns = [...prev.sessions]; ns[currentSessionIndex].survey = { ...sessionSurvey }; return { ...prev, sessions: ns }; });
            if (currentSessionIndex + 1 < CONDITION_ORDER.length) { setCurrentSessionIndex(prev => prev + 1); setSessionSurvey(EMPTY_SURVEY); setStage(STAGES.SESSION_INTRO); }
            else setStage(STAGES.FINAL_SURVEY);
          }}>제출</button>
        </div>
      )}

      {stage === STAGES.FINAL_SURVEY && (
        <div className="card survey-card">
          <h2>최종 비교 설문</h2>
          <div className="survey-list">
            <div className="survey-q"><p>1. 어느 형식이 가장 매력적이었나요?</p><select value={finalSurvey.mostAttractive} onChange={e => setFinalSurvey(p => ({ ...p, mostAttractive: e.target.value }))}><option value="">선택</option><option value="rewind">개입형 실패 광고</option><option value="fail">실패 광고</option></select></div>
            <div className="survey-q"><p>2. 어느 형식이 게임 설치 의향을 가장 높였나요?</p><select value={finalSurvey.mostWantToInstall} onChange={e => setFinalSurvey(p => ({ ...p, mostWantToInstall: e.target.value }))}><option value="">선택</option><option value="rewind">개입형 실패 광고</option><option value="fail">실패 광고</option></select></div>
            <div className="survey-q"><p>3. 이유가 있다면? (선택사항)</p><textarea placeholder="자유롭게 입력해 주세요." value={finalSurvey.reason} onChange={e => setFinalSurvey(p => ({ ...p, reason: e.target.value }))} style={{height:'100px'}}></textarea></div>
          </div>
          <button className="btn primary" onClick={() => {
            soundManager.playClick();
            if (!finalSurvey.mostAttractive || !finalSurvey.mostWantToInstall) return alert("필수 항목을 선택해 주세요.");
            setLog(prev => ({ ...prev, finalSurvey, completed: true })); setStage(STAGES.COMPLETION);
          }}>완료</button>
        </div>
      )}

      {stage === STAGES.COMPLETION && (
        <div className="card completion-card">
          <h2>실험 완료</h2>
          <p style={{textAlign:'center', marginBottom:'20px'}}>참여해주셔서 감사합니다.</p>
          <div className="btn-group">
            <button className="btn outline" onClick={() => { soundManager.playClick(); const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${log.participantId}_data.json`; a.click(); }}>JSON 저장</button>
            <button className="btn primary" onClick={() => { soundManager.playClick(); exportCSV(); }}>CSV 저장</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MicrogateExperiment;
