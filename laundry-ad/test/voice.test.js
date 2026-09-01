/* 나래이션 (voice.js · voice-clips.js)
 *
 * 왜 이 검사가 필요한가
 *   목소리로 읽는 문장은 voice-clips.js 안에 **구워진 소리**로 들어 있다. 자막을
 *   고치면 화면은 바로 바뀌지만 소리는 다시 굽기 전까지 옛 문장을 읽는다. 그러면
 *   참가자는 자막과 다른 말을 듣게 되고, 그 차이는 화면만 봐서는 안 드러난다.
 *   여기서 클립 문장과 실제 자막을 글자 단위로 대조해 그 어긋남을 막는다.
 *
 *   길이도 본다. 클립이 장면보다 길면 말이 끊긴 채 다음 장면으로 넘어간다.
 *
 * 자극 간 비대칭인 것을 알고 넣었다 — 게임 자극에는 목소리가 없다.
 * INTEGRATION.md §5-12 에 감수한 교란으로 적어 두었다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { bootPage, wait, suite, APP_DIR } = require('./lib/harness');

/* scenes.js 의 voiceKey() 를 테스트에서 다시 적는다 — 같은 함수를 불러다 쓰면
 * 그 함수가 틀렸을 때 같이 틀린다. 규칙을 독립적으로 진술해 둔다.
 *   1·4 는 소재(ver)에 따라, 6 은 수행 주체(mode)에 따라 자막이 갈린다. */
function keyFor(no, mode, ver) {
  if (no === 1 || no === 4) return 's' + no + ver;
  if (no === 6) return 's6' + (mode === 'intervene' ? 'i' : 'w');
  return 's' + no;
}

module.exports = async function () {
  const t = suite('나래이션 · 자막과 같은 말');

  const clips = fs.readFileSync(path.join(APP_DIR, 'voice-clips.js'), 'utf8');
  const voice = fs.readFileSync(path.join(APP_DIR, 'voice.js'), 'utf8');

  /* ---- 문장이 자막과 같다 ---- */
  const used = new Set();
  for (const mode of ['watch', 'intervene']) {
    for (const ver of ['A', 'B']) {
      /* ?still 로 장면을 하나씩 세워 자막을 읽는다. 재생으로 걸으면 watch 는
       * 1·2·3·4·10 만 지나 장면 5~9 의 자막을 확인할 수 없다. */
      t.section(mode + ' · ver ' + ver);
      let mismatch = null;
      for (let no = 1; no <= 10; no++) {
        const w = bootPage(`?mode=${mode}&ver=${ver}&still=${no}&sid=v-${mode}${ver}${no}`);
        await wait(80);
        const sub = w.document.getElementById('subtitle-text').textContent;
        const key = keyFor(no, mode, ver);
        used.add(key);
        const said = w.AD_VOICE_CLIPS.text[key];
        if (said !== sub) mismatch = { no, key, sub, said };
      }
      t.ok(!mismatch, '열 장면 모두 자막을 그대로 읽는다',
        mismatch && `장면 ${mismatch.no}(${mismatch.key}) 자막 "${mismatch.sub}" ≠ 클립 "${mismatch.said}"`);
    }
  }

  /* ---- 남거나 빠진 클립이 없다 ---- */
  const w0 = bootPage('?mode=intervene&ver=A&sid=v-keys');
  await wait(120);
  const table = w0.AD_VOICE_CLIPS;
  const have = Object.keys(table.text).sort();
  t.section('클립 목록');
  t.ok(have.join(',') === [...used].sort().join(','),
    '쓰이는 클립과 들어 있는 클립이 같다 (남는 것·빠진 것 없음)', have.join(','));
  t.ok(have.every(k => typeof table.mp3[k] === 'string' && table.mp3[k].length > 0),
    '모든 문장에 소리가 붙어 있다');

  /* ---- 장면 길이 안에 들어간다 ---- */
  const DUR = { 1: 2.94, 2: 1.58, 3: 1.16, 4: 2.08, 7: 2.44, 8: 1.29, 9: 1.63, 10: 3.07 };  // 5·6 은 가변
  const over = have.filter(k => {
    const no = Number(k.replace(/^s(\d+).*$/, '$1'));
    return DUR[no] !== undefined && table.sec[k] > DUR[no];
  });
  t.ok(over.length === 0, '클립이 장면보다 길지 않다 (말이 끊기지 않는다)',
    over.map(k => `${k} ${table.sec[k]}s`));

  /* ---- 말이 끝나면 바로 넘어간다 ----
   *
   * 예전에는 위의 "길지 않다"만 봤다. 그래서 0.86초 말하고 6초짜리 장면에 서 있어도
   * 통과했고, 실제로 장면 3 이 그랬다(빈 시간 5.14초). 이제 장면 길이가 클립에
   * 붙어 있는지까지 본다 — scenes.js 의 DUR 표는 손으로 적은 값이라, 클립을 다시
   * 구워 길이가 달라지면 여기서 어긋난다.
   *
   * A·B 가 갈리는 장면(1·4)은 긴 쪽에 맞춰져 있으므로(SPEC 7장의 길이 동일 요건)
   * 짧은 쪽은 그 차이만큼 여유가 더 있다 — 0.06초다. 그래서 위 여유를 본다. */
  const TAIL = 0.3, SLACK = 0.1;
  const gap = k => DUR[Number(k.replace(/^s(\d+).*$/, '$1'))] - table.sec[k];
  const loose = have.filter(k => {
    const no = Number(k.replace(/^s(\d+).*$/, '$1'));
    return DUR[no] !== undefined && gap(k) > TAIL + SLACK;
  });
  t.ok(loose.length === 0, `말 끝나고 ${TAIL}초 안에 컷 (빈 시간이 남지 않는다)`,
    loose.map(k => `${k} +${gap(k).toFixed(2)}s`));

  /* ---- 장면마다 말투가 다르다 ---- */
  /* 처음 구웠을 때는 열세 문장이 전부 같은 톤·같은 속도였다(F0 가 227~259Hz 한
   * 밴드에 몰려 있었고 실패 장면이 해소 장면보다 높았다).
   *
   * 여기서 보는 값은 **잰 값이 아니라 실제로 건 값이다.** 구운 소리에서 F0 를
   * 되재는 방식은 쓰지 않는다 — 문장 안에서 F0 가 한 옥타브 넘게 움직이는 대사가
   * 있어(167~302Hz) "가운데 높이"가 안정된 값이 아니고, 자기상관과 조화곱
   * 스펙트럼이 같은 클립을 208Hz 와 167Hz 로 달리 읽었다. 옮기는 양 자체는
   * 정확하므로(순음 검증) 건 값을 그대로 지키는 것이 확실하다. */
  t.section('장면마다 말투가 다르다');
  const rate = table.rate, semi = table.pitch;
  t.ok(rate && semi && Object.keys(semi).length === have.length,
    '말 속도·높이가 클립마다 기록돼 있다');

  const no = k => Number(k.replace(/^s(\d+).*$/, '$1'));
  const SHARED_SC = [1, 2, 3, 4, 10];
  const span = ks => Math.max(...ks.map(k => semi[k])) - Math.min(...ks.map(k => semi[k]));

  t.ok(semi.s4A === Math.min(...have.map(k => semi[k])),
    '실패(장면 4)가 가장 낮다', `${semi.s4A}반음`);
  t.ok(semi.s8 === Math.max(...have.map(k => semi[k])),
    '해소(장면 8)가 가장 높다', `${semi.s8}반음`);
  t.ok(rate.s4A === Math.max(...have.map(k => rate[k])),
    '실패가 가장 느리다', `${rate.s4A}배`);
  /* 가장 빠른 것은 장면 2 다 — "그대로 세탁 시작"을 무심하게 흘리는 것이
   * 실패의 씨앗이라 일부러 그렇게 뒀다. 여기서 볼 것은 무거운 대사와 가벼운
   * 대사가 갈렸는가지 누가 1등인가가 아니다. */
  t.ok(rate.s8 < rate.s4A, '해소가 실패보다 가볍고 빠르다',
    `해소 ${rate.s8}배 · 실패 ${rate.s4A}배`);

  const shared = have.filter(k => SHARED_SC.includes(no(k)));
  const intOnly = have.filter(k => !SHARED_SC.includes(no(k)));
  t.ok(span(shared) >= 3, '말투가 실제로 갈려 있다 (공통 장면 높이 폭)',
    span(shared).toFixed(1) + '반음');
  /* 연출의 motion.test.js 규칙 D 와 같은 이유다 — 개입 조건만 보는 구간이 더
   * 극적이면 노출 시간 비대칭 위에 각성 비대칭이 얹힌다. */
  t.ok(span(shared) >= span(intOnly),
    '개입 전용 구간이 공통 구간보다 극적이지 않다',
    { 공통: +span(shared).toFixed(1), intervene전용: +span(intOnly).toFixed(1) });

  /* ---- ver·mode 로 갈리는 짝은 같은 처리를 받는다 ---- */
  /* piper 는 기본값에서 합성에 난수를 쓴다. 켜 두면 **같은 문장이 구울 때마다
   * 다른 억양으로 나오고**(실측 180.7 / 196.9 / 204.2Hz), 낱말 하나만 다른 짝은
   * 억양까지 갈린다 — 첫 판에서 장면 4가 A 232Hz · B 182Hz 로 4반음 벌어져 있었다.
   * 이 광고의 전환점 대사인데 버전마다 다른 무게로 들렸다는 뜻이다.
   * 지금은 난수를 끄고(build-voice.py synth) 짝이 같은 값을 받는지 여기서 본다. */
  t.section('ver·mode 로 갈리는 짝은 같은 처리');
  for (const [a2, b2] of [['s1A', 's1B'], ['s4A', 's4B'], ['s6i', 's6w']]) {
    t.ok(semi[a2] === semi[b2] && rate[a2] === rate[b2],
      `${a2} · ${b2} 가 같은 속도·높이로 읽힌다`,
      `${rate[a2]}배 ${semi[a2]}반음 vs ${rate[b2]}배 ${semi[b2]}반음`);
  }

  /* ---- 끄는 법은 하나다 ---- */
  t.section('sound=0 이면 목소리도 꺼진다');
  const off = bootPage('?mode=watch&ver=A&sound=0&sid=v-off');
  await wait(150);
  t.ok(off.AD_VOICE.state() === 'off', 'state = off', off.AD_VOICE.state());
  t.ok(off.AD_VOICE.voiceOk() === null, 'VOICE_OK = null');
  t.ok(off.AD_VOICE.spoken === 0, '읽기 요청 자체가 안 나간다', off.AD_VOICE.spoken);

  /* ---- 소리가 안 나는 환경에서도 자극은 그대로 ---- */
  t.section('무음 환경 (jsdom = AudioContext 없음)');
  const w = bootPage('?mode=watch&ver=A&sid=v-none');
  await wait(150);
  t.ok(w.AD_VOICE.state() === 'none', '장치가 없으면 state = none', w.AD_VOICE.state());
  t.ok(w.AD_VOICE.voiceOk() === null, '해당 없음은 VOICE_OK = null (0 아님)', w.AD_VOICE.voiceOk());
  t.ok(w.AD_VOICE.spoken > 0, '소리가 안 나도 읽으려 한 문장 수는 센다', w.AD_VOICE.spoken);
  t.ok(w.AD_VOICE.heard === 0, '실제로 난 목소리는 0', w.AD_VOICE.heard);
  t.ok(w.__errors.length === 0, 'JS 에러 없음', w.__errors.map(String));
  t.ok(w.AD_ENGINE.scene.no === 1, '자극은 그대로 재생된다', w.AD_ENGINE.scene.no);

  /* ---- 효과음 코어와 섞이지 않는다 ---- */
  t.section('sfx 와 분리돼 있다');
  t.ok(!/AD_SFX/.test(voice),
    'voice.js 가 AD_SFX 를 건드리지 않는다 (게임과 글자 단위로 같아야 하는 코어다)');
  t.ok(!/https?:\/\//.test(voice) && !/https?:\/\//.test(clips),
    '외부 요청 없음 (base64 로 심겨 있다)');
  /* 확장자가 **문자열 안에** 있으면 파일을 가리키는 것이다. 그냥 /\.mp3/ 로 보면
   * CLIPS.mp3 같은 속성 이름까지 걸린다 — 그건 심어 둔 base64 를 꺼내는 것이지
   * 파일이 아니다. */
  t.ok(!/['"][^'"]*\.(mp3|wav|ogg|m4a)['"]/.test(voice) &&
    !/new Audio\(|fetch\(|XMLHttpRequest/.test(voice),
    '오디오 파일을 부르지 않는다 (심어 둔 base64 만 쓴다)');

  /* ---- 정지 화면에서는 읽지 않는다 ---- */
  const still = bootPage('?mode=watch&ver=A&still=4&sid=v-still');
  await wait(120);
  t.ok(still.AD_VOICE.spoken === 0,
    '?still 스토리보드 캡처에서는 읽지 않는다', still.AD_VOICE.spoken);

  /* ---- 자동재생이 막혔다가 풀리는 경우 ----
   *
   * 이 구간이 검사에서 통째로 비어 있었다. 다른 검사는 전부 jsdom(AudioContext 없음)
   * 이라 "소리가 안 나도 자극은 돈다"만 봤고, **소리가 실제로 나는 경로**는 아무도
   * 안 봤다. 그래서 다음이 통과한 채로 나갔다:
   *   장면에 들어갈 때 막혀 있으면 그 문장은 **버려지고 재시도가 없었다.**
   * 광고가 31초일 때는 여덟 문장이 흘러 늦게 눌러도 대부분 들렸지만, 길이를
   * 10.8초로 줄이자 화면을 한 번 누르는 사이에 광고가 끝났다.
   *
   * 여기서는 가짜 AudioContext 로 "막힘 → 풀림"을 그대로 재현한다. */
  t.section('막혔다가 풀리면 지금 장면을 다시 읽는다');

  /* sfx.js 도 같은 window.AudioContext 를 쓴다 — 목소리만 보려는 mock 이지만
   * 효과음이 부르는 노드까지 갖춰야 장면 전환이 예외로 멈추지 않는다. */
  const mockAudio = (win) => {
    const P = function (v) { this.value = v === undefined ? 1 : v; };
    P.prototype.cancelScheduledValues = P.prototype.setValueAtTime =
      P.prototype.linearRampToValueAtTime = P.prototype.exponentialRampToValueAtTime =
      P.prototype.setTargetAtTime = function () {};
    const node = () => ({
      connect() {}, disconnect() {}, start() {}, stop() {},
      gain: new P(), frequency: new P(440), detune: new P(0), Q: new P(1),
      threshold: new P(-24), knee: new P(30), ratio: new P(12),
      attack: new P(0.003), release: new P(0.25), type: 'sine', buffer: null, onended: null
    });
    win.AudioContext = function () {
      this.state = 'suspended';            // 자동재생 정책에 막힌 상태로 시작
      this.currentTime = 0;
      this.sampleRate = 44100;
      this.destination = {};
      const self = this;
      this.createGain = node;
      this.createOscillator = node;
      this.createBiquadFilter = node;
      this.createDynamicsCompressor = node;
      this.createBuffer = () => ({ getChannelData: () => new Float32Array(256), duration: 1 });
      /* 목소리만 센다 — 나래이션 버퍼에만 표시를 달아 효과음과 갈라낸다 */
      this.createBufferSource = () => {
        const n = node();
        n.start = function () { if (n.buffer && n.buffer.__voice) win.__played++; };
        return n;
      };
      /* 실제 브라우저의 자동재생 정책 — 제스처가 없으면 resume() 이 안 먹는다.
       * 이걸 흉내내지 않으면 mock 이 저 혼자 풀려서 "막힌 상태"를 못 만든다. */
      this.resume = function () {
        if (win.__gesture) self.state = 'running';
        return Promise.resolve();
      };
      this.decodeAudioData = function (buf, ok) {
        const b = { duration: 1, __voice: true };
        if (ok) ok(b);
        return Promise.resolve(b);
      };
    };
    win.__played = 0;
    win.__gesture = false;
  };

  const v = bootPage('?mode=watch&ver=A&sid=v-unlock');
  await wait(120);
  mockAudio(v);                                   // ctx() 는 부를 때 window 를 읽는다
  v.AD_ENGINE.gotoNo(3);                          // "세탁 중…" — 막혀 있어서 못 읽는다
  await wait(40);
  t.ok(v.AD_VOICE.state() === 'blocked', '막혀 있으면 state = blocked', v.AD_VOICE.state());
  t.ok(v.__played === 0, '막혀 있는 동안은 소리가 안 난다', v.__played);
  const spokenBefore = v.AD_VOICE.spoken;

  v.__gesture = true;                             // 참가자가 화면을 누른다
  v.AD_VOICE.unlock();
  await wait(60);
  t.ok(v.AD_VOICE.state() === 'on', '풀리면 state = on', v.AD_VOICE.state());
  t.ok(v.__played === 1, '풀리는 순간 지금 장면 문장을 읽는다', v.__played);
  t.ok(v.AD_VOICE.spoken === spokenBefore,
    '다시 읽은 것은 VOICE_SPOKEN 을 늘리지 않는다 (같은 문장이다)',
    { before: spokenBefore, after: v.AD_VOICE.spoken });

  v.AD_ENGINE.gotoNo(4);                          // 풀린 뒤에는 그냥 읽힌다
  await wait(40);
  t.ok(v.__played === 2, '풀린 뒤 장면들은 그대로 읽힌다', v.__played);

  /* ---- 막혀 있으면 광고를 아직 시작하지 않는다 ----
   *
   * 재시도만으로는 부족했다. 잠금이 풀린 "그 순간의 장면"만 되살아나므로 그전에
   * 지나간 문장은 그대로 잃는다. watch 가 10.8초라 화면을 한 번 누르는 사이에
   * 광고의 절반이 지나간다 — 그래서 소리가 정해질 때까지 시작을 미룬다. */
  t.section('소리가 막혀 있으면 시작을 미룬다');

  /* 스크립트가 붙기 전에 AudioContext 를 심어야 boot() 가 막힌 상태를 본다 */
  const g = bootPage('?mode=watch&ver=A&sid=v-gate', { before: mockAudio });
  await wait(300);
  const gated = g.AD_ENGINE && g.AD_ENGINE.scene === null || !g.AD_ENGINE.playing;
  t.ok(gated, '막혀 있는 동안 재생이 시작되지 않는다',
    { playing: g.AD_ENGINE.playing, scene: g.AD_ENGINE.scene && g.AD_ENGINE.scene.no });

  g.__gesture = true;                             // 확인하는 사람이 화면을 누른다
  g.AD_VOICE.unlock();
  await wait(250);
  t.ok(g.AD_ENGINE.playing && g.AD_ENGINE.scene && g.AD_ENGINE.scene.no === 1,
    '풀리면 장면 1 부터 시작한다',
    { playing: g.AD_ENGINE.playing, scene: g.AD_ENGINE.scene && g.AD_ENGINE.scene.no });
  t.ok(g.__played >= 1, '장면 1 나래이션을 놓치지 않는다', g.__played);

  /* ---- 로그에 남는다 ---- */
  t.section('로그에 남는다');
  const p = w.AD_ENGINE.snapshot ? w.AD_ENGINE.snapshot() : JSON.parse(w.AD_RESULT_JSON || '{}');
  const fin = bootPage('?mode=watch&ver=A&sid=v-log');
  await wait(150);
  fin.AD_ENGINE.finish({ reason: 'test' });
  await wait(50);
  const payload = JSON.parse(fin.AD_RESULT_JSON);
  t.ok('VOICE_OK' in payload, 'VOICE_OK 가 payload 에 있다', payload.VOICE_OK);
  t.ok(payload.VOICE_SPOKEN > 0, 'VOICE_SPOKEN 이 payload 에 있다', payload.VOICE_SPOKEN);
  void p;

  return t.failed;
};
