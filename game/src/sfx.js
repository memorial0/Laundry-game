/* 딥드리프트 자극 효과음 — Web Audio 합성. 오디오 파일이 없다(번들 자체 완결).
 *
 * 이 파일은 세탁 자극의 laundry-ad/sfx.js 와 **핵심부가 글자 그대로 같다.**
 * 신호의 길이·세기·CTA 클릭음·재생 절차를 한쪽에서만 고치면 두 자극의 소리가
 * 어긋나고, 그 차이가 광고 형식의 효과로 잘못 읽힌다. laundry-ad/test/sfx.test.js
 * 가 두 파일의 SFX-CORE 구간을 직접 비교해 그것을 막는다.
 *
 * 이 파일이 정하는 것: 음색(VOICES) — 게임 광고는 전자음에 가깝게 잡는다.
 * 이 파일이 못 정하는 것: 길이·세기·CTA 음·마스터 음량 — 전부 코어에 있다.
 *
 * 코어를 IIFE 로 감싸 두는 이유는 세탁 쪽 파일과 들여쓰기까지 같게 유지하기 위해서다.
 */
const SFX = (function () {
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
    gain: 0.055,     // 마스터 대비 배경음 천장 — 두 자극 공통
    fadeIn: 1.6,     // 켜질 때 (초). 자극 시작음(start)과 겹쳐 들어온다
    fadeOut: 0.9,    // 꺼질 때 (초). 종료 로그는 이 시간을 기다리지 않는다
    lookahead: 0.35  // 반복 악절을 미리 예약해 두는 시간 (초)
  };

  var MASTER = 0.22;        // 최종 음량 — 두 자극 공통
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

  /* 음색 — 게임 광고. 모바일 게임답게 각진 파형과 높은 배음을 쓴다.
   * (화면은 심해로 바꿨지만 소리는 그대로 뒀다 — 게임다운 피드백음이 세계관보다
   *  '게임 광고'라는 형식을 더 분명히 알린다. 물속 느낌으로 바꾸고 싶으면 여기만 고친다.)
   * 세탁 쪽(laundry-ad/sfx.js)의 같은 이름 신호와 길이·세기는 같고 음색만 다르다.
   * 광고하는 물건이 다르니 소리도 다르다 — 대신 다른 것은 음색뿐이다. */
  var VOICES = {
    start: [
      { wave: 'square', f0: 330, f1: 660, dur: 0.40, gain: 0.55 },
      { wave: 'triangle', f0: 990, dur: 0.30, gain: 0.30, at: 0.06 }
    ],
    beat: [
      { wave: 'square', f0: 880, dur: 0.10, gain: 0.50 }
    ],
    bad: [
      { wave: 'sawtooth', f0: 260, f1: 130, dur: 0.30, gain: 0.60 },
      { noise: true, f0: 800, f1: 300, q: 0.9, dur: 0.28, gain: 0.30 }
    ],
    fail: [
      { wave: 'sawtooth', f0: 170, f1: 55, dur: 0.85, gain: 0.70 },
      { noise: true, f0: 500, f1: 140, filter: 'lowpass', q: 0.7, dur: 0.55, gain: 0.40 }
    ],
    rewind: [
      { wave: 'sawtooth', f0: 1200, f1: 180, dur: 0.65, gain: 0.50 },
      { noise: true, f0: 1800, f1: 400, q: 1.4, dur: 0.65, gain: 0.30 }
    ],
    grab: [
      { wave: 'square', f0: 990, dur: 0.09, gain: 0.55 }
    ],
    miss: [
      { wave: 'square', f0: 300, f1: 210, dur: 0.20, gain: 0.55 }
    ],
    success: [
      { wave: 'square', f0: 440, dur: 0.30, gain: 0.50 },
      { wave: 'square', f0: 660, dur: 0.34, gain: 0.48, at: 0.14 },
      { wave: 'square', f0: 880, dur: 0.60, gain: 0.45, at: 0.28 }
    ],
    card: [
      { wave: 'triangle', f0: 587, f1: 880, dur: 0.45, gain: 0.85 },
      { wave: 'triangle', f0: 1174, dur: 0.34, gain: 0.25, at: 0.10 }
    ]
  };


  /* 배경음 음색 — 게임 광고. 가단조 루프(베이스 · 아르페지오 · 선율) 100bpm.
   * 세탁 쪽과 다른 것은 이 표뿐이다. 음량 천장·페이드는 코어의 BED 가 정한다.
   *
   * 자극별로 배경음을 다르게 두기로 한 결정과 그 대가(광고 태도 차이가 형식 때문인지
   * 음악 때문인지 갈리지 않는다)는 INTEGRATION.md §3 에 적어 두었다. */
  var BED_VOICE = [
    /* 화음 진행은 Am → F → C → G 를 반복한다. 게임 음악에서 가장 흔한 진행이고,
     * 그래서 "게임 광고 음악"으로 바로 읽힌다 — 여기서 개성을 부릴 자리가 아니다.
     * 한 마디 2.4초(100bpm) · 네 마디 9.6초가 한 바퀴다. 세 층이 같은 길이로 돌아
     * 어긋나지 않는다. 자극 길이(31.2초 · 55.4초)와는 일부러 안 맞물린다 —
     * 맞물리면 곡이 끝나는 자리가 장면 전환을 예고한다. */

    // 베이스 — 4분음표(0.6초). 마디마다 근음 → 근음 → 5도
    { root: 110.00, step: 0.60, wave: 'triangle', dur: 0.50, gain: 0.46,
      seq: [0, null, 0, 7,  -4, null, -4, 3,  3, null, 3, 10,  -2, null, -2, 5] },

    // 아르페지오 — 8분음표(0.3초). 각 마디의 화음을 훑어 올라갔다 내려온다
    { root: 220.00, step: 0.30, wave: 'square', dur: 0.24, gain: 0.30,
      seq: [0, 3, 7, 12, 7, 3, 0, 3,
            -4, 0, 3, 8, 3, 0, -4, 0,
            3, 7, 10, 15, 10, 7, 3, 7,
            -2, 2, 5, 10, 5, 2, -2, 2] },

    // 선율 — 2분음표(1.2초). 드문드문 나와야 배경에 머문다
    { root: 440.00, step: 1.20, wave: 'triangle', dur: 0.90, gain: 0.20,
      seq: [0, null, 7, 3,  5, null, 3, 2] },

    // 패드 — 위 세 층을 이어 붙이는 지속음. 음이 바뀌는 사이가 비지 않게 한다
    { wave: 'sine', f: 110.00, gain: 0.18, lfo: { rate: 0.05, depth: 0.25 } },
    { wave: 'sine', f: 164.81, gain: 0.12, lfo: { rate: 0.041, depth: 0.30 } },

    // 물 — 심해라는 자리만 남기는 흔적. 이 층이 커지면 다시 환경음이 된다
    { noise: true, filter: 'bandpass', ff: 900, q: 1.8, gain: 0.05,
      lfo: { rate: 0.09, depth: 0.50 } }
  ];

  /* sound=0 이면 처음부터 끝까지 무음이다(파일럿·심사용).
   * 기본값은 켜짐 — 두 자극 모두 같은 기본값을 쓴다. */
  var muted = new URLSearchParams(window.location.search).get('sound') === '0';

  var api = createSfx(VOICES, { muted: muted, bed: BED_VOICE });
  window.AD_SFX = api;

  /* 제스처가 생길 만한 모든 지점에서 잠금 해제를 시도한다.
   * 시청 조건 참가자는 자극 안에서 한 번도 화면을 건드리지 않을 수 있어,
   * 러너가 '시작'을 누른 순간 부모 문서가 대신 풀어 주는 경로(AD_UNLOCK)가 핵심이다. */
  ['pointerdown', 'touchstart', 'keydown', 'mousedown'].forEach(function (t) {
    window.addEventListener(t, function () { api.unlock(); }, { passive: true });
  });
  window.addEventListener('message', function (e) {
    if (e && e.data && e.data.type === 'AD_UNLOCK') api.unlock();
  });
  api.unlock();

  /* 러너에게 "이제 잠금을 풀어 달라"고 알린다 — 부모가 사용자 제스처를 들고 있을 때
   * contentWindow.AD_SFX.unlock() 을 직접 부를 수 있게 하는 신호다. */
  try { window.parent.postMessage({ type: 'AD_READY' }, '*'); } catch (e) { /* 단독 실행 */ }

  return api;
})();

export default SFX;
