/* 클린가드 자극 효과음 — Web Audio 합성. 오디오 파일이 없다(오프라인 실행 유지).
 *
 * 이 파일은 게임 자극의 game/src/sfx.js 와 **핵심부가 글자 그대로 같다.**
 * 신호의 길이·세기·CTA 클릭음·재생 절차를 한쪽에서만 고치면 두 자극의 소리가
 * 어긋나고, 그 차이가 광고 형식의 효과로 잘못 읽힌다. laundry-ad/test/sfx.test.js
 * 가 두 파일의 SFX-CORE 구간을 직접 비교해 그것을 막는다.
 *
 * 이 파일이 정하는 것: 음색(VOICES) — 세탁 광고는 생활음에 가깝게 잡는다.
 * 이 파일이 못 정하는 것: 길이·세기·CTA 음·마스터 음량 — 전부 코어에 있다.
 */
(function () {
  'use strict';

  /* === SFX-CORE-BEGIN =======================================
   * 여기부터 아래 끝 표시까지는 두 자극이 **완전히 같은 내용**이어야 한다.
   * =========================================================== */

  /* 신호 목록 — 길이(초)와 세기(0~1)를 여기서만 정한다.
   * 음색(파형·주파수)은 자극마다 다르지만 이 두 값은 같다. 세탁 쪽이 게임보다
   * 크거나 길게 울리면 "소리 때문에" 생긴 차이를 광고 형식의 차이로 읽게 된다. */
  var CUES = {
    start: { dur: 0.45, gain: 0.30 },     // 자극 시작
    beat: { dur: 0.12, gain: 0.16 },      // 진행 중 작은 표시(장면 전환 · 게이트 통과)
    bad: { dur: 0.30, gain: 0.30 },       // 나빠지는 중(염료 번짐 · 손해 상자)
    fail: { dur: 0.90, gain: 0.50 },      // 실패 확정
    rewind: { dur: 0.70, gain: 0.38 },    // 되감기
    grab: { dur: 0.12, gain: 0.24 },      // 참가자의 첫 조작
    miss: { dur: 0.22, gain: 0.24 },      // 조작이 목표에 닿지 못함
    success: { dur: 1.00, gain: 0.50 },   // 결과가 달라짐
    card: { dur: 0.55, gain: 0.34 },      // 제품 카드 등장
    cta: { dur: 0.18, gain: 0.40 }        // CTA 클릭
  };

  /* CTA 클릭음은 음색까지 두 자극이 같다.
   * 이 클릭이 곧 종속변인(CTA_CLICK)이라, 누르는 순간의 청각 보상이 다르면
   * 그 차이가 그대로 클릭률 차이로 들어온다. VOICES 로 덮어쓸 수 없다. */
  var CTA_VOICE = [
    { wave: 'sine', f0: 880, f1: 1320, dur: 0.10, gain: 1.00 },
    { wave: 'sine', f0: 1760, dur: 0.16, gain: 0.35, at: 0.03 }
  ];

  /* 배경음(BGM) — 자극마다 음색이 다르다(각 파일 아래쪽의 BED_VOICE).
   * 여기서 정하는 것: 음량 천장 · 페이드 길이 · 켜고 끄는 절차 · 잠금 처리.
   * 자극별 파일이 정하는 것: 음색뿐이다. 큐(VOICES)와 같은 규칙이다.
   *
   * gain 은 가장 작은 큐(beat 0.16)보다 확실히 낮아야 한다 — 배경음이 큐를 가리면
   * 길이·세기를 글자 단위로 맞춰 둔 의미가 없어진다. */
  var BED = {
    gain: 0.075,     // 마스터 대비 배경음 천장 — 두 자극 공통.
                     // 천장은 가장 작은 큐(beat 0.16)의 절반, 즉 0.08 미만이어야 한다
                     // (laundry-ad/test/sfx.test.js 가 지킨다). 0.055 로는 휴대폰
                     // 스피커에서 배경음이 사실상 안 들렸다 — 참가자 대부분이
                     // 휴대폰으로 보므로, 그 기기에서 안 들리면 없는 것과 같다.
    fadeIn: 1.2,     // 켜질 때 (초). 자극 시작음(start)과 겹쳐 들어온다.
                     // 1.6 은 첫 장면이 절반쯤 지나서야 다 올라와, 자극이 시작하는
                     // 순간에는 여전히 조용했다.
    fadeOut: 0.9,    // 꺼질 때 (초). 종료 로그는 이 시간을 기다리지 않는다
    lookahead: 0.35  // 반복 악절을 미리 예약해 두는 시간 (초)
  };

  var MASTER = 0.32;        // 최종 음량 — 두 자극 공통.
                            // 한도는 리미터 문턱(-10dB ≈ 0.316)이다. 가장 센 큐
                            // (fail·success 0.50)가 0.50 × 0.32 = 0.16 이라 아직 그 아래다.
                            // 더 올려 리미터에 상시로 걸리면, 큐가 겹칠 때 눌리는 정도가
                            // 자극마다 달라져서 글자 단위로 맞춰 둔 세기 비율이 무너진다.
  var ATTACK_MAX = 0.012;   // 상승 시간 상한(초). 이보다 짧은 신호는 길이의 1/4 을 쓴다

  /**
   * 소리 재생기 하나를 만든다.
   * @param {Object} VOICES  신호 이름 → 레이어 배열. 레이어는
   *   {wave,f0,f1,dur,gain,at} (오실레이터) 또는 {noise:true,f0,q,filter,dur,gain,at}.
   *   dur 은 CUES 의 길이를 넘지 못하고, gain 은 CUES 의 세기에 곱해진다.
   * @param {{muted?: boolean, bed?: Array}} [options]
   *   bed 는 배경음 음색(BED_VOICE). 음량 천장·페이드는 코어의 BED 가 정한다.
   */
  function createSfx(VOICES, options) {
    var opt = options || {};
    var muted = !!opt.muted;
    var bedVoice = opt.bed || null;   // 배경음 음색 — 자극별 파일이 넘긴다
    var ac = null;
    var master = null;
    var noiseCache = null;
    var fired = 0;      // 신호를 낸 횟수 — 실제로 들렸는지와 무관하게 센다
    var bed = null;         // 지금 울리고 있는 배경음 노드들 (null = 꺼져 있음)
    var bedWanted = false;  // 켜 달라고 했는지 — 잠금이 늦게 풀리면 그때 켠다
    var played = 0;     // 그중 실제로 소리가 난 횟수

    /* 오디오 장치를 처음 쓸 때 만든다.
     * AudioContext 가 없는 환경(jsdom 테스트·구형 브라우저)에서는 null 을 돌려주고,
     * 이후 모든 호출이 조용히 넘어간다 — 소리 때문에 자극이 멈추면 안 된다. */
    function ready() {
      if (muted) return null;
      if (ac) return ac;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ac = new AC(); } catch (e) { return null; }
      master = ac.createGain();
      master.gain.value = MASTER;
      /* 리미터 — 신호가 겹쳐도 최대 음량이 두 자극에서 같은 천장에 걸리게 한다 */
      var lim = ac.createDynamicsCompressor();
      lim.threshold.value = -10;
      lim.knee.value = 0;
      lim.ratio.value = 20;
      lim.attack.value = 0.003;
      lim.release.value = 0.12;
      master.connect(lim);
      lim.connect(ac.destination);
      return ac;
    }

    /* 브라우저 자동재생 정책 — 사용자 제스처 없이는 소리가 나지 않는다.
     * 제스처가 있을 만한 모든 지점에서 이 함수를 부르고, 성공 여부는 state() 로 읽는다. */
    function unlock() {
      var c = ready();
      if (!c) return false;
      if (c.state === 'running') { resumeBed(); return true; }
      try {
        var p = c.resume();
        /* 제스처가 늦게 들어오면 여기서 배경음을 켠다 — 시청 조건 참가자는 자극 안에서
         * 화면을 한 번도 안 건드릴 수 있어, 러너가 대신 풀어 주는 이 경로가 유일한 기회다. */
        if (p && p.then) p.then(function () { resumeBed(); }, function () { /* 아직 제스처가 없다 */ });
      } catch (e) { /* 구형 구현 — 다음 제스처에서 다시 시도한다 */ }
      resumeBed();
      return c.state === 'running';
    }

    function noiseBuffer() {
      if (noiseCache) return noiseCache;
      var n = Math.floor(ac.sampleRate * 1.2);
      var buf = ac.createBuffer(1, n, ac.sampleRate);
      var d = buf.getChannelData(0);
      /* 결정적 잡음 — Math.random 을 쓰면 참가자마다 다른 소리가 난다 */
      var seed = 22695477;
      for (var i = 0; i < n; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        d[i] = (seed / 0x3fffffff) - 1;
      }
      noiseCache = buf;
      return buf;
    }

    /**
     * 반복 악절의 음 하나를 t 시각에 예약한다.
     *
     * 지속음(패드·드론)만으로는 음정을 어떻게 바꿔도 '웅웅거림'으로 들린다.
     * 광고 음악처럼 들리려면 시간에 따라 음이 바뀌어야 하고, 그 일을 이 함수가 한다.
     *
     * @param {Object} spec  {root, seq, step, wave, dur, gain}
     *   root  기준 음의 주파수(Hz). seq 의 숫자는 여기서부터의 반음 수다
     *   seq   반음 배열. null 은 쉼표. 끝나면 처음으로 돌아간다
     *   step  한 칸의 길이(초) — 이 값이 곧 빠르기다
     *   dur   한 음의 길이(초). 생략하면 step 의 90%
     */
    function seqNote(spec, out, f, t) {
      var peak = Math.max(0.0002, spec.gain === undefined ? 1 : spec.gain);
      var dur = spec.dur === undefined ? spec.step * 0.9 : spec.dur;
      var g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      g.connect(out);

      var o = ac.createOscillator();
      o.type = spec.wave || 'square';
      o.frequency.value = f;
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.02);
    }

    /**
     * 배경음을 실제로 만든다. 잠금이 풀려 있을 때만 불린다.
     * @param {Array} voice  레이어 배열. 레이어는
     *   {wave,f,detune,gain}                지속 오실레이터
     *   {noise:true,filter,ff,q,gain}       지속 잡음(방 공기 · 물소리)
     *   {root,seq,step,wave,dur,gain}       반복 악절 — 아래 seqNote 참고
     *   lfo:{rate,depth}                    음량을 천천히 흔든다(초당 rate 회). 지속음 전용
     *   sweep:{rate,depth}                  필터 주파수를 천천히 오르내리게 한다(잡음 전용)
     */
    function buildBed(voice) {
      var out = ac.createGain();
      var t = ac.currentTime;
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(BED.gain, t + BED.fadeIn);
      out.connect(master);

      var srcs = [];
      var seqs = [];   // 반복 악절 — 아래 스케줄러가 칸마다 음을 예약한다
      for (var i = 0; i < voice.length; i++) {
        var spec = voice[i];
        if (spec.seq) { seqs.push({ spec: spec, i: 0, next: 0 }); continue; }
        var base = Math.max(0.0002, spec.gain === undefined ? 1 : spec.gain);
        var g = ac.createGain();
        g.gain.value = base;
        g.connect(out);

        var src;
        if (spec.noise) {
          src = ac.createBufferSource();
          src.buffer = noiseBuffer();
          src.loop = true;
        } else {
          src = ac.createOscillator();
          src.type = spec.wave || 'sine';
          src.frequency.value = spec.f;
          if (spec.detune) src.detune.value = spec.detune;
        }

        var tail = src;
        if (spec.filter) {
          var flt = ac.createBiquadFilter();
          flt.type = spec.filter;
          flt.frequency.value = spec.ff;
          flt.Q.value = spec.q === undefined ? 1 : spec.q;
          tail.connect(flt);
          tail = flt;
          if (spec.sweep) {
            var sw = ac.createOscillator();
            sw.type = 'sine';
            sw.frequency.value = spec.sweep.rate;
            var swg = ac.createGain();
            swg.gain.value = spec.sweep.depth;
            sw.connect(swg);
            swg.connect(flt.frequency);
            sw.start();
            srcs.push(sw);
          }
        }
        tail.connect(g);

        if (spec.lfo) {
          var lfo = ac.createOscillator();
          lfo.type = 'sine';
          lfo.frequency.value = spec.lfo.rate;
          var lg = ac.createGain();
          lg.gain.value = base * spec.lfo.depth;
          lfo.connect(lg);
          lg.connect(g.gain);
          lfo.start();
          srcs.push(lfo);
        }

        src.start();
        srcs.push(src);
      }

      /* 악절 스케줄러 — 25ms 마다 깨어나 lookahead 안에 들어오는 칸을 미리 예약한다.
       * setTimeout 으로 음 하나하나를 그때그때 내면 박자가 흔들린다(참가자마다 다른 소리가
       * 난다는 뜻이다). 오디오 시계에 미리 걸어 두어야 어느 기기에서나 같은 박으로 돈다. */
      var timer = null;
      if (seqs.length) {
        var t0 = t + 0.12;   // 모든 악절이 같은 시각에 출발한다 — 서로 어긋나면 안 된다
        for (var k = 0; k < seqs.length; k++) seqs[k].next = t0;
        var pump = function () {
          var now = ac.currentTime;
          for (var j = 0; j < seqs.length; j++) {
            var L = seqs[j];
            while (L.next < now + BED.lookahead) {
              var n = L.spec.seq[L.i % L.spec.seq.length];
              if (n !== null && n !== undefined) {
                seqNote(L.spec, out, L.spec.root * Math.pow(2, n / 12), L.next);
              }
              L.i++;
              L.next += L.spec.step;
            }
          }
        };
        pump();
        timer = window.setInterval(pump, 25);
      }
      return { out: out, srcs: srcs, timer: timer };
    }

    /** 켜 달라고 해 뒀는데 아직 안 켜진 배경음을 켠다(잠금이 풀린 직후에 불린다) */
    function resumeBed() {
      if (!bedWanted || bed || muted) return;
      if (!bedVoice || !bedVoice.length) return;
      if (!ac || ac.state !== 'running') return;
      bed = buildBed(bedVoice);
    }

    /**
     * 배경음을 켠다 — 자극이 시작될 때 한 번 부른다.
     * 잠금이 아직 안 풀렸으면 풀리는 순간 켜진다(호출부가 다시 부를 필요는 없다).
     */
    function startBed() {
      bedWanted = true;
      if (muted) return false;
      var c = ready();
      if (!c) return false;
      if (c.state !== 'running') unlock();
      resumeBed();
      return !!bed;
    }

    /** 배경음을 끈다 — 자극이 끝날 때 한 번 부른다. fadeOut 만큼 잦아든 뒤 멈춘다. */
    function stopBed() {
      bedWanted = false;
      if (!bed || !ac) return;
      var b = bed;
      bed = null;
      if (b.timer) window.clearInterval(b.timer);   // 새 음을 더 예약하지 않는다
      var t = ac.currentTime;
      try {
        b.out.gain.cancelScheduledValues(t);
        b.out.gain.setValueAtTime(Math.max(0.0002, b.out.gain.value), t);
        b.out.gain.exponentialRampToValueAtTime(0.0001, t + BED.fadeOut);
      } catch (e) { /* 구형 구현 — 아래에서 어차피 멈춘다 */ }
      for (var i = 0; i < b.srcs.length; i++) {
        try { b.srcs[i].stop(t + BED.fadeOut + 0.05); } catch (e) { /* 이미 멈췄다 */ }
      }
    }

    /** 레이어 하나를 t0 시각에 울린다 */
    function layer(spec, cue, t0) {
      var dur = Math.min(spec.dur === undefined ? cue.dur : spec.dur, cue.dur);
      if (!(dur > 0)) return;
      var peak = Math.max(0.0002, (spec.gain === undefined ? 1 : spec.gain) * cue.gain);
      var atk = Math.min(ATTACK_MAX, dur * 0.25);
      var at = t0 + (spec.at || 0);

      var g = ac.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(peak, at + atk);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      g.connect(master);

      var src;
      if (spec.noise) {
        src = ac.createBufferSource();
        src.buffer = noiseBuffer();
        if (spec.f0) {
          var f = ac.createBiquadFilter();
          f.type = spec.filter || 'bandpass';
          f.frequency.setValueAtTime(spec.f0, at);
          if (spec.f1) f.frequency.exponentialRampToValueAtTime(spec.f1, at + dur);
          f.Q.value = spec.q === undefined ? 1 : spec.q;
          src.connect(f);
          f.connect(g);
        } else {
          src.connect(g);
        }
      } else {
        src = ac.createOscillator();
        src.type = spec.wave || 'sine';
        src.frequency.setValueAtTime(spec.f0, at);
        if (spec.f1 && spec.f1 !== spec.f0) {
          src.frequency.exponentialRampToValueAtTime(spec.f1, at + dur);
        }
        src.connect(g);
      }
      src.start(at);
      src.stop(at + dur + 0.03);
    }

    /**
     * 신호 하나를 낸다. 소리가 안 나는 환경에서도 호출부는 그대로 둔다 —
     * 몇 번 울렸어야 하는지(fired)가 로그에 남아야 조건 간 비교가 된다.
     * @returns {boolean} 실제로 소리가 났는지
     */
    function play(name) {
      var cue = CUES[name];
      if (!cue) return false;
      fired++;
      var c = ready();
      if (!c) return false;
      if (c.state !== 'running') { unlock(); }
      if (c.state !== 'running') return false;
      var voice = name === 'cta' ? CTA_VOICE : VOICES[name];
      if (!voice || !voice.length) return false;
      var t0 = c.currentTime + 0.001;
      for (var i = 0; i < voice.length; i++) layer(voice[i], cue, t0);
      played++;
      return true;
    }

    /**
     * 소리가 실제로 났는지 — 로그의 AUDIO_OK 가 이 값을 쓴다.
     *   'on'      정상 재생 중
     *   'blocked' 장치는 있는데 자동재생 정책에 막혀 있다
     *   'none'    AudioContext 자체가 없다(테스트 환경·구형 브라우저)
     *   'off'     sound=0 으로 껐다
     */
    function state() {
      if (muted) return 'off';
      if (!ac) return (window.AudioContext || window.webkitAudioContext) ? 'blocked' : 'none';
      return ac.state === 'running' ? 'on' : 'blocked';
    }

    /** AUDIO_OK 로 쓸 값 — 1 들림 / 0 막힘 / null 해당 없음(끔·장치 없음) */
    function audioOk() {
      var s = state();
      if (s === 'on') return 1;
      if (s === 'blocked') return 0;
      return null;
    }

    return {
      unlock: unlock,
      play: play,
      startBed: startBed,
      stopBed: stopBed,
      get bedOn() { return !!bed; },
      state: state,
      audioOk: audioOk,
      get fired() { return fired; },
      get played() { return played; },
      cues: CUES
    };
  }

  /* === SFX-CORE-END ========================================= */

  /* 음색 — 세탁 광고. 생활 소음에 가깝게 둥근 파형과 낮은 배음을 쓴다.
   * 게임 쪽(game/src/sfx.js)의 같은 이름 신호와 길이·세기는 같고 음색만 다르다.
   * 광고하는 물건이 다르니 소리도 다르다 — 대신 다른 것은 음색뿐이다. */
  var VOICES = {
    start: [
      { wave: 'sine', f0: 523, f1: 784, dur: 0.40, gain: 0.85 },
      { wave: 'sine', f0: 1046, dur: 0.30, gain: 0.25, at: 0.06 }
    ],
    beat: [
      { wave: 'triangle', f0: 660, dur: 0.10, gain: 0.80 }
    ],
    bad: [
      { wave: 'sine', f0: 320, f1: 170, dur: 0.30, gain: 0.90 },
      { noise: true, f0: 700, f1: 260, q: 0.9, dur: 0.28, gain: 0.30 }
    ],
    /* 실패 확정 — 광고에서 가장 큰 신호다.
     *
     * 예전엔 순수 sine 190 → 72Hz 였다. sine 은 배음이 없어 기본음이 잘리면 남는 것이
     * 없고, 작은 스피커일수록 그 아래가 통째로 사라진다. OfflineAudioContext 로
     * 같은 그래프를 태워 재 봤다(고역통과 2단, RMS, bad 대비 dB):
     *
     *        컷 없음   200Hz    300Hz    400Hz
     *   옛 음색  +9.5dB   +5.2dB   -6.0dB   -8.1dB     ← 300Hz 부터 뒤집힌다
     *   새 음색  +7.7dB   +7.7dB   +2.7dB   +2.0dB
     *
     * 이 파일이 가정하는 150~200Hz 컷에서는 뒤집히지는 않고 여유가 9.5 → 5.2dB 로
     * 줄어드는 정도다. 다만 실제 휴대폰 스피커는 300~400Hz 까지 힘이 빠지는 경우가
     * 흔하고, 거기서는 **실패가 그 앞의 경고음(bad)보다 작게 들린다** — CUES 가 정해 둔
     * beat < bad < fail 순서가 기기에서 뒤집힌다.
     * (게임 자극은 sawtooth 라 배음으로 살아남는다. 이건 세탁 쪽만의 문제였다.)
     *
     * triangle 로 바꾸고 시작 음을 올렸다. 3배음이 살아 있어 작은 스피커에서도 떨어지는
     * 것이 들리고(300Hz 컷에서 옛 음색보다 8.7dB 크다), sawtooth 처럼 날카롭지 않아
     * "생활음에 가깝게"라는 이 자극의 음색 원칙은 그대로다.
     *
     * 레이어 세기 합은 1.35 로 전과 같고, 컷 없이 들으면 오히려 1.8dB 작다 —
     * 키운 것이 아니라 들리는 대역으로 옮긴 것이다. */
    fail: [
      { wave: 'triangle', f0: 260, f1: 96, dur: 0.85, gain: 1.00 },
      { noise: true, f0: 420, f1: 130, filter: 'lowpass', q: 0.7, dur: 0.55, gain: 0.35 }
    ],
    rewind: [
      { wave: 'triangle', f0: 950, f1: 210, dur: 0.65, gain: 0.75 },
      { noise: true, f0: 1600, f1: 380, q: 1.4, dur: 0.65, gain: 0.30 }
    ],
    grab: [
      { wave: 'triangle', f0: 740, dur: 0.09, gain: 0.85 }
    ],
    miss: [
      { wave: 'sine', f0: 330, f1: 240, dur: 0.20, gain: 0.85 }
    ],
    success: [
      { wave: 'sine', f0: 523, dur: 0.30, gain: 0.80 },
      { wave: 'sine', f0: 659, dur: 0.34, gain: 0.75, at: 0.14 },
      { wave: 'sine', f0: 784, dur: 0.60, gain: 0.70, at: 0.28 }
    ],
    card: [
      { wave: 'sine', f0: 659, f1: 988, dur: 0.45, gain: 0.85 },
      { wave: 'sine', f0: 1318, dur: 0.34, gain: 0.20, at: 0.10 }
    ]
  };


  /* 배경음 음색 — 세탁 광고. 방 공기 + 다장조 루프(베이스 · 분산화음 · 선율) 100bpm.
   * 게임 쪽과 다른 것은 이 표뿐이다. 음량 천장·페이드는 코어의 BED 가 정한다.
   *
   * 자극별로 배경음을 다르게 두기로 한 결정과 그 대가(광고 태도 차이가 형식 때문인지
   * 음악 때문인지 갈리지 않는다)는 INTEGRATION.md §3 에 적어 두었다. */
  /* ── 옛 배경음 (v1) — 쓰이지 않는다. 되돌릴 때를 위해 남겨 둔다 ────────────
   * 아래 BED_VOICE(v2) 대신 이것을 쓰려면 이름을 맞바꾸면 된다.
   * v1 은 "게임 음악"에 가까웠다 — 세탁이라는 자리(아침·집안일)와 안 맞아 갈아 끼웠다.
   * 판정이 끝나 v2 로 굳으면 이 덩어리는 지워도 된다.
   * ───────────────────────────────────────────────────────────────── */
  var BED_VOICE_V1 = [
    /* 화음 진행은 C → Am → F → G 를 반복한다. 게임 배경음(Am → F → C → G)과 **같은 네 화음**
     * 이고 시작 자리만 다르다 — 다장조로 들리느냐 가단조로 들리느냐만 갈린다. 화음 재료까지
     * 다르게 하면 두 배경음의 차이가 어디서 오는지 더 벌어진다.
     *
     * **빠르기(100bpm)와 한 바퀴 길이(9.6초)는 게임과 똑같다.** 빠르기는 각성에 바로 얹히는
     * 값이라 여기서 갈리면 안 된다. 다른 것은 조성과 음표의 성김이다 — 게임은 8분음표
     * 아르페지오로 몰아치고, 여기는 4분·2분음표로 성기게 간다. 광고 성격의 차이다.
     *
     * 9.6초는 장면 경계(watch 기준 4.0·6.6·12.6·20.0초)와 겹치지 않는다 — 한 바퀴 안으로
     * 접으면 4.0·6.6·3.0·0.8 이고 가장 가까운 마디(2.4·4.8·7.2·9.6)와도 0.6초 떨어져 있다.
     * 겹치면 곡의 마디가 장면 전환을 예고한다. 길이를 고칠 때 이걸 먼저 확인할 것.
     *
     * **화성은 층이 아니라 성부로 움직인다.** 예전에는 패드가 C3·G3·C4 에 고정돼 있었다.
     * 화음이 F·G 로 가도 C 가 계속 울리니 G 위에서 sus4 로 매달린 채 풀리지 않았고 —
     * 진행이 있는데도 한 덩어리로 웅웅거렸다. 지금은 패드도 마디마다 음을 바꾼다.
     * **지속음(f: 고정 오실레이터)을 다시 넣지 말 것** — 넣는 순간 같은 문제가 돌아온다. */

    /* 방 공기 — 세탁기가 도는 저역. 소리라기보다 '조용하지 않음'에 가깝게 깐다.
     * 베이스와 같은 대역이라 세게 깔면 화음이 묻힌다. 음 사이를 이어 주는 것도 이 층이다. */
    { noise: true, filter: 'lowpass', ff: 200, q: 0.7, gain: 0.16,
      lfo: { rate: 0.07, depth: 0.35 } },

    // 베이스 — 2분음표(1.2초). 마디마다 근음 → 5도. 게임의 4분음표보다 한 단계 성기다
    { root: 130.81, step: 1.20, wave: 'sine', dur: 1.10, gain: 0.34,
      seq: [0, 7,  -3, 4,  -7, 0,  -5, 2] },

    /* 화음 — 온음표(2.4초)로 마디마다 하나씩. dur 이 step 보다 길어 앞 화음의 꼬리가
     * 다음 화음에 겹친다(마디가 바뀌는 자리에서 소리가 끊기지 않게 하는 유일한 장치다).
     * 두 성부는 가까운 음으로만 옮겨 다닌다 — 도약하면 배경이 아니라 반주로 들린다.
     *   윗성부  E4 → E4 → F4 → D4      아랫성부  G4 → A4 → A4 → G4 */
    { root: 261.63, step: 2.40, wave: 'triangle', dur: 2.60, gain: 0.15,
      seq: [4, 4, 5, 2] },
    { root: 261.63, step: 2.40, wave: 'sine', dur: 2.60, gain: 0.11,
      seq: [7, 9, 9, 7] },

    /* 분산화음 — 4분음표(0.6초). 게임 쪽 아르페지오의 절반 속도이고 파형도 부드럽다.
     * 세 마디째부터 위로 열어 두는 이유는 네 마디가 같은 모양이면 루프가 드러나서다. */
    { root: 261.63, step: 0.60, wave: 'triangle', dur: 0.52, gain: 0.20,
      seq: [0, 4, 7, 4,  -3, 0, 4, 0,  -7, -3, 0, 5,  -5, -1, 2, 7] },

    /* 선율 — 2분음표(1.2초). C5 D5 | A4 | F4 G4 | G4 로 올라갔다 제자리로 돌아온다.
     * 한 마디에 한 음만 두면 가락이 아니라 신호음으로 들린다 — 두 음씩 묶은 마디를
     * 섞어 노래처럼 만들되, 빈 칸(null)을 남겨 배경에 머물게 한다. */
    { root: 261.63, step: 1.20, wave: 'sine', dur: 1.00, gain: 0.16,
      seq: [12, 14,  9, null,  5, 7,  7, null] },

    /* 물기 — 화음 위에 얹히는 높은 음 하나(G5 · E5 · F5 · D5). 세탁이라는 자리를
     * 남기는 정도로만 둔다. 이 층이 커지면 선율과 다투고 배경음이 앞으로 나온다. */
    { root: 523.25, step: 2.40, wave: 'sine', dur: 1.40, gain: 0.06,
      seq: [7, 4, 5, 2] }
  ];

  /* 배경음 — 밝은 아침, 집안일을 가볍게 시작하는 자리.
   *
   * **빠르기·한 바퀴 길이는 v1 과 같다.** 100bpm · 한 마디 2.4초 · 네 마디 9.6초.
   * 빠르기는 각성에 바로 얹히는 값이고, 한 바퀴 길이는 장면 경계(5·10·16·23·31초)와
   * 겹치지 않게 고른 값이다 — 겹치면 곡의 마디가 장면 전환을 예고한다. 둘 다 건드리지 말 것.
   * 게임 배경음도 같은 100bpm · 9.6초다. 여기가 갈리면 각성 차이가 광고 형식의 효과로 읽힌다.
   *
   * 화음 진행은 C → Am → F → G. v1 과 같고 게임(Am → F → C → G)과도 **같은 네 화음**이다.
   * 시작 자리만 달라 다장조로 들린다 — 재료까지 다르게 하면 두 배경음의 차이가 더 벌어진다.
   *
   * v1 과 무엇이 다른가: 음색과 리듬의 성격이다.
   *   · 마림바 성격의 나무 소리(triangle, 짧은 감쇠)를 중심에 두고 4분음표로 규칙적으로
   *     돌린다 — 세탁조가 천천히 도는 결이다. v1 의 분산화음은 음이 오르내리기만 해서
   *     "무엇을 하는 중"이라는 느낌이 없었다.
   *   · 베이스는 뮤트 플럭으로 짧게 끊는다(dur < step). 남는 틈은 패드가 메운다.
   *   · 벨은 sine 으로 부드럽게 울리고 쉼표를 많이 둔다. 짧고 날카로우면 알림음으로
   *     들리고, 그러면 참가자가 광고가 아니라 기기를 본다.
   *
   * **화성은 층이 아니라 성부로 움직인다.** 지속음(f: 고정 오실레이터)을 넣지 말 것 —
   * 화음이 바뀌어도 한 음이 계속 울려 sus 로 매달리고, 진행이 있는데도 웅웅거린다.
   * v1 이전에 실제로 그랬다.
   *
   * 세기 배분(200Hz 이상 레이어의 합)은 v1 과 같은 0.68 로 맞췄다 — 게임(0.55)과의
   * 밝기 배수가 1.24 로 그대로다. 여기를 바꾸면 두 자극 중 한쪽만 앞으로 나온다. */
  var BED_VOICE = [

    /* 아침 공기 — 방이 조용하지 않다는 정도. 저역이라 작은 스피커에서는 거의 안 들리고,
     * 이어폰에서 음 사이의 틈을 메운다. 여기를 키우면 세탁기 소음처럼 들리기 시작한다. */
    { noise: true, filter: 'lowpass', ff: 200, q: 0.7, gain: 0.12,
      lfo: { rate: 0.06, depth: 0.30 } },

    /* 베이스 — 뮤트 플럭. 2분음표(1.2초)로 성기게 가고 dur 을 step 보다 짧게 끊어
     * 여운을 남기지 않는다. 마디마다 근음 → 화음의 다른 음.
     *   C3 G3 | A2 E3 | F2 A2 | G2 D3 */
    { root: 130.81, step: 1.20, wave: 'triangle', dur: 0.85, gain: 0.30,
      seq: [0, 7,  -3, 4,  -7, -3,  -5, 2] },

    /* 마림바 — 이 곡의 중심. 4분음표(0.6초)로 마디마다 같은 모양을 돈다.
     * 근음 → 5도 → 3도 → 5도. 위아래로 흔들리는 이 왕복이 세탁조가 도는 결이다.
     * 짧은 감쇠(0.36초)라 음이 겹치지 않고 또박또박 떨어진다.
     * 게임 쪽 아르페지오는 8분음표다 — 여기가 더 성긴 것은 의도한 성격 차이다. */
    { root: 261.63, step: 0.60, wave: 'triangle', dur: 0.36, gain: 0.24,
      seq: [0, 7, 4, 7,
            -3, 4, 0, 4,
            -7, 0, -3, 0,
            -5, 2, -1, 2] },

    /* 따뜻한 화음 — 온음표(2.4초)로 마디마다 하나씩. dur 이 step 보다 길어 앞 화음의
     * 꼬리가 다음 화음에 겹친다. 마디가 바뀌는 자리에서 소리가 끊기지 않게 하는 유일한
     * 장치이고, 한 바퀴가 끝나 처음으로 돌아가는 자리도 이 겹침이 이어 준다.
     * 두 성부는 가까운 음으로만 옮겨 다닌다 — 도약하면 배경이 아니라 반주로 들린다.
     *   윗성부  G4 → E4 → F4 → D4      아랫성부  E4 → C4 → A3 → B3 */
    { root: 261.63, step: 2.40, wave: 'triangle', dur: 2.60, gain: 0.15,
      seq: [7, 4, 5, 2] },
    { root: 261.63, step: 2.40, wave: 'sine', dur: 2.60, gain: 0.11,
      seq: [4, 0, -3, -1] },

    /* 벨 선율 — 2분음표 자리에 다섯 음만 둔다. C5 | A4 | G4 A4 | D5 로 내려갔다 열린다.
     * 마지막 D5 가 처음의 C5 로 자연스럽게 돌아와 루프 이음매가 안 드러난다.
     * 쉼표(null)를 많이 두는 이유는 가락이 앞에 나오면 화면 동작과 효과음을 가리기 때문이다.
     * sine 에 1초 감쇠 — 짧고 날카롭게 만들면 알림음으로 들린다. */
    { root: 523.25, step: 1.20, wave: 'sine', dur: 1.00, gain: 0.12,
      seq: [0, null,  -3, null,  -5, -3,  2, null] },

    /* 반짝임 — 두 마디에 한 번, 화음 꼭대기에 얹는 벨 하나(G5 · D5).
     * 이 층이 커지거나 잦아지면 선율과 다투고 배경음이 앞으로 나온다. */
    { root: 783.99, step: 2.40, wave: 'sine', dur: 1.30, gain: 0.06,
      seq: [0, null,  -5, null] }
  ];

  /* sound=0 이면 처음부터 끝까지 무음이다(파일럿·심사용).
   * 기본값은 켜짐 — 두 자극 모두 같은 기본값을 쓴다. */
  var muted = new URLSearchParams(location.search).get('sound') === '0';

  window.AD_SFX = createSfx(VOICES, { muted: muted, bed: BED_VOICE });

  /* 제스처가 생길 만한 모든 지점에서 잠금 해제를 시도한다.
   * 시청 조건 참가자는 자극 안에서 한 번도 화면을 건드리지 않을 수 있어,
   * 러너가 '시작'을 누른 순간 부모 문서가 대신 풀어 주는 경로(AD_UNLOCK)가 핵심이다. */
  ['pointerdown', 'touchstart', 'keydown'].forEach(function (t) {
    window.addEventListener(t, function () { window.AD_SFX.unlock(); }, { passive: true });
  });
  window.addEventListener('message', function (e) {
    if (e && e.data && e.data.type === 'AD_UNLOCK') window.AD_SFX.unlock();
  });
  window.AD_SFX.unlock();

  /* 러너에게 "이제 잠금을 풀어 달라"고 알린다 — 부모가 사용자 제스처를 들고 있을 때
   * contentWindow.AD_SFX.unlock() 을 직접 부를 수 있게 하는 신호다. */
  try { window.parent.postMessage({ type: 'AD_READY' }, '*'); } catch (e) { /* 단독 실행 */ }
})();
