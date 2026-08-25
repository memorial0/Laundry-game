/* 나래이션 — 장면 자막을 목소리로 읽는다.
 *
 * sfx.js 와 왜 따로 두나
 *   sfx.js 의 SFX-CORE 구간은 게임 자극(game/src/sfx.js)과 글자 하나까지 같아야 하고
 *   test/sfx.test.js 가 그것을 검사한다. 나래이션은 세탁 자극에만 있으므로 코어에
 *   넣으면 그 검사가 깨진다. 그래서 재생 경로를 통째로 분리했다 —
 *   AudioContext 도 따로 만든다. sfx 와 섞이는 지점은 없다.
 *
 * 자극 간 비대칭인 것을 알고 넣었다
 *   게임 자극에는 목소리가 없다. 목소리는 배경음보다 센 변수라, 블록 C·D
 *   (광고 태도·제품 평가)의 자극 간 차이를 광고 형식의 효과로 읽을 수 없게 된다.
 *   INTEGRATION.md §5-12 에 감수한 교란으로 적어 두었다.
 *
 * 읽는 문장은 자막 그대로다
 *   새 문구를 지어내면 정보량이 자막과 어긋나고 SPEC 2장의 효과 표현 제한을
 *   넘을 위험이 생긴다. test/voice.test.js 가 클립 문장과 자막을 대조한다.
 *
 * 소리가 안 나는 환경
 *   AudioContext 가 없거나(테스트·구형 브라우저) 자동재생 정책에 막히면 조용히
 *   넘어가고 자극은 그대로 재생된다. 자막이 같은 정보를 이미 들고 있으므로
 *   목소리가 빠져도 참가자가 잃는 정보는 없다.
 */
(function () {
  'use strict';

  var CLIPS = window.AD_VOICE_CLIPS || { text: {}, sec: {}, mp3: {} };

  /* sound=0 이면 효과음·배경음과 함께 꺼진다 — 끄는 방법이 하나여야 한다 */
  var muted = new URLSearchParams(location.search).get('sound') === '0';

  /* 배경음 천장(0.075)보다 충분히 위, 큐를 덮지 않는 자리.
   * 클립은 전부 -18 LUFS 로 맞춰 구워져 있어(tools/build-voice.py) 문장마다
   * 크기가 갈리지 않는다. 여기서는 한 값만 곱한다. */
  var GAIN = 0.6;

  /* 장면이 바뀌면 앞 문장을 끊는다. 이 시간에 걸쳐 줄여야 딸깍 소리가 안 난다. */
  var CUT_FADE = 0.12;

  var ac = null;              // 나래이션 전용 AudioContext
  var out = null;             // 마스터 게인
  var buffers = {};           // key → AudioBuffer (해독은 한 번만)
  var playing = null;         // 지금 울리고 있는 { src, gain }
  var spoken = 0;             // 재생을 요청한 문장 수 (들렸는지와 무관)
  var heard = 0;              // 실제로 소리가 난 문장 수

  function ctx() {
    if (muted || ac) return ac;
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    try { ac = new C(); } catch (e) { return null; }
    out = ac.createGain();
    out.gain.value = GAIN;
    out.connect(ac.destination);
    return ac;
  }

  /** 자동재생 잠금 풀기. 제스처가 있을 만한 지점에서 부른다 — sfx 와 같은 규칙이다. */
  function unlock() {
    var c = ctx();
    if (!c) return false;
    if (c.state === 'running') return true;
    try { c.resume(); } catch (e) { /* 정책에 막힘 */ }
    return c.state === 'running';
  }

  function toBuffer(key, cb) {
    if (buffers[key]) return cb(buffers[key]);
    var b64 = CLIPS.mp3 && CLIPS.mp3[key];
    if (!b64 || !ac) return cb(null);
    var bin, bytes, i;
    try { bin = atob(b64); } catch (e) { return cb(null); }
    bytes = new Uint8Array(bin.length);
    for (i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // Safari 구판은 Promise 를 안 돌려주므로 콜백 형태도 함께 넘긴다
    try {
      var p = ac.decodeAudioData(bytes.buffer, function (buf) {
        buffers[key] = buf; cb(buf);
      }, function () { cb(null); });
      if (p && typeof p.then === 'function') {
        p.then(function (buf) { buffers[key] = buf; cb(buf); }, function () { cb(null); });
      }
    } catch (e) { cb(null); }
  }

  /** 울리고 있는 문장을 짧게 줄여 끊는다 */
  function stop() {
    if (!playing || !ac) { playing = null; return; }
    var p = playing;
    playing = null;
    try {
      p.gain.gain.cancelScheduledValues(ac.currentTime);
      p.gain.gain.setValueAtTime(p.gain.gain.value, ac.currentTime);
      p.gain.gain.linearRampToValueAtTime(0.0001, ac.currentTime + CUT_FADE);
      p.src.stop(ac.currentTime + CUT_FADE + 0.02);
    } catch (e) { /* 이미 끝난 소스 */ }
  }

  /**
   * 문장 하나를 읽는다. 앞 문장이 울리고 있으면 끊는다 — 장면이 바뀌었다는 뜻이라
   * 두 문장이 겹쳐 들리면 안 된다.
   * @param {string} key CLIPS 의 키 (s1A · s4B · s6i …)
   */
  function say(key) {
    if (muted || !key) return false;
    spoken++;
    var c = ctx();
    if (!c) return false;
    if (c.state !== 'running') unlock();
    if (c.state !== 'running') return false;   // 막혀 있다 — 자막이 대신 전한다
    stop();
    toBuffer(key, function (buf) {
      if (!buf || !ac || ac.state !== 'running') return;
      var g = ac.createGain();
      g.gain.value = 1;
      g.connect(out);
      var src = ac.createBufferSource();
      src.buffer = buf;
      src.connect(g);
      var mine = { src: src, gain: g };
      src.onended = function () { if (playing === mine) playing = null; };
      playing = mine;
      heard++;
      try { src.start(); } catch (e) { playing = null; }
    });
    return true;
  }

  /** 'on' 들린다 / 'blocked' 막혀 있다 / 'none' 장치 없음 / 'off' sound=0 */
  function state() {
    if (muted) return 'off';
    if (!ac) return (window.AudioContext || window.webkitAudioContext) ? 'blocked' : 'none';
    return ac.state === 'running' ? 'on' : 'blocked';
  }

  /** VOICE_OK 로 쓸 값 — 1 들림 / 0 막힘 / null 해당 없음(끔·장치 없음) */
  function voiceOk() {
    var s = state();
    if (s === 'on') return 1;
    if (s === 'blocked') return 0;
    return null;
  }

  window.AD_VOICE = {
    say: say,
    stop: stop,
    unlock: unlock,
    state: state,
    voiceOk: voiceOk,
    get spoken() { return spoken; },
    get heard() { return heard; },
    text: CLIPS.text || {},
    sec: CLIPS.sec || {}
  };

  /* 잠금 해제 경로는 sfx 와 같다 — 러너가 제스처를 들고 AD_UNLOCK 을 보낸다
   * (preview.html 의 unlockFrameAudio). 시청 조건 참가자는 자극 안에서 화면을
   * 한 번도 안 건드릴 수 있어 이 경로가 핵심이다. */
  ['pointerdown', 'touchstart', 'keydown'].forEach(function (t) {
    window.addEventListener(t, function () { unlock(); }, { passive: true });
  });
  window.addEventListener('message', function (e) {
    if (e && e.data && e.data.type === 'AD_UNLOCK') unlock();
  });
})();
