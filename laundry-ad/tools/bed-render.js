#!/usr/bin/env node
/* 배경음을 실제 신호로 뽑아 두 자극을 비교한다.
 *
 *   node tools/bed-render.js            두 배경음을 재고 표를 찍는다
 *   node tools/bed-render.js --wav      test/out/bed/ 에 WAV 도 만든다 (들어 보려고)
 *
 * ── 왜 필요했나 ────────────────────────────────────────────────────────
 *
 * INTEGRATION.md §5-3 은 두 자극의 배경음을 "화음·빠르기·한 바퀴 길이는 맞추고
 * 조성과 음표의 성김만 남긴다"고 정해 두고, **실제로 비슷하게 들리는지는 사람이
 * 같은 기기로 번갈아 들어 봐야 한다**고 적어 두었다. 그렇게 적힌 이유는 그때까지의
 * 자(test/sfx.test.js 의 audibleGain)가 거칠었기 때문이다 — 소스 텍스트에서 gain 값을
 * 정규식으로 긁어 200Hz 위 레이어의 세기를 더할 뿐이라 이런 것들을 못 본다.
 *
 *   · 음표 밀도   게임 아르페지오는 8분음표(초당 3.3개), 세탁 마림바는 4분음표(1.7개)다
 *   · 쉼표        세탁 벨 선율은 여덟 칸 중 셋이 쉼표다. 세기표에는 안 나타난다
 *   · 감쇠        dur 이 step 보다 짧으면 그 층은 시간의 일부만 울린다
 *   · 배음        같은 세기의 square 와 sine 은 전혀 다른 밝기를 낸다
 *   · 지속음      패드는 100% 울리고 악절은 그 일부만 울린다 — 같은 gain 이 아니다
 *
 * 그래서 코어(sfx.js 의 SFX-CORE)가 하는 합성을 그대로 다시 해서 **파형을 만들고**
 * 그 파형을 잰다. 사람이 들어야 하는 자리는 여전히 남지만(--wav 로 그 파일을 만든다),
 * 적어도 "얼마나 다른가"를 숫자로 말할 수 있다.
 *
 * ── 무엇을 그대로 따라 했나 ────────────────────────────────────────────
 *
 * 코어의 buildBed()·seqNote() 를 그대로 옮겼다. 값은 두 sfx.js 에서 직접 읽는다
 * (BED_VOICE 배열 리터럴을 잘라 와 평가한다) — 여기 옮겨 적으면 한쪽만 옛 값으로 남는다.
 *
 *   · 파형은 **대역제한**으로 만든다. Web Audio 의 square/triangle 은 나이퀴스트까지만
 *     배음을 넣은 PeriodicWave 다. 소박하게 만들면 앨리어싱이 고역에 얹혀 밝기가
 *     부풀고, 하필 게임만 square 를 써서 비교가 통째로 틀어진다.
 *   · 잡음은 코어와 같은 LCG(seed 22695477) 로 만든 1.2초 버퍼를 반복한다.
 *   · BiquadFilter 는 Audio EQ Cookbook 계수다. lowpass·highpass 의 Q 는 Web Audio
 *     규격대로 **데시벨**로 읽고(10^(Q/20)), bandpass 는 그냥 Q 로 읽는다.
 *   · LFO 는 gain 에 더해진다(g.gain = base + base·depth·sin). AudioParam 에 노드를
 *     연결하면 곱이 아니라 합이다.
 *
 * ── 무엇을 뺐나 ────────────────────────────────────────────────────────
 *
 * 리미터(DynamicsCompressor, 문턱 −10dB ≈ 0.316)는 넣지 않았다. 배경음의 최대
 * 진폭은 레이어 세기의 합 × BED.gain(0.075) × MASTER(0.32) 이라 세탁 0.026 ·
 * 게임 0.032 로 문턱의 1/10 이다 — 배경음만으로는 리미터가 걸리지 않는다.
 * 큐가 겹칠 때는 걸리지만 그건 여기서 재는 대상이 아니다.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SR = 48000;

/* 코어(SFX-CORE)가 정하는 값. 두 자극 공통이라 여기 한 번만 적는다 —
 * 어긋나면 아래 assertCore() 가 잡는다. */
const BED = { gain: 0.075, fadeIn: 1.2, fadeOut: 0.9 };
const MASTER = 0.32;
const SEQ_START = 0.12;      // 모든 악절이 함께 출발하는 시각 (코어의 t0 = t + 0.12)
const NOTE_ATTACK = 0.008;   // seqNote 의 상승 시간

/* 참가자가 실제로 듣는 길이. watch 를 기준으로 잰다 — 두 자극이 같은 값이고(INTEGRATION §4),
 * 배경음 한 바퀴가 9.6초라 2.9바퀴가 들어간다. */
const WATCH_SEC = 28.0;

/* ==========================================================================
 * 1. 두 sfx.js 에서 BED_VOICE 를 읽어 온다
 * ========================================================================== */

/** `var NAME = [ ... ];` 배열 리터럴을 잘라 와 평가한다. 순수 리터럴이라 안전하다. */
function readArray(file, name) {
  const src = fs.readFileSync(file, 'utf8');
  const head = src.indexOf('var ' + name + ' = [');
  if (head < 0) throw new Error(name + ' 을 ' + file + ' 에서 못 찾았다');
  let i = src.indexOf('[', head), depth = 0, end = -1;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '[') depth++;
    else if (src[j] === ']' && --depth === 0) { end = j + 1; break; }
  }
  if (end < 0) throw new Error(name + ' 의 닫는 괄호를 못 찾았다');
  return eval(src.slice(i, end));   // eslint-disable-line no-eval
}

/** 코어가 정하는 값이 여기 적어 둔 것과 같은지 확인한다. */
function assertCore(file) {
  const src = fs.readFileSync(file, 'utf8');
  const num = re => { const m = re.exec(src); return m ? parseFloat(m[1]) : null; };
  const got = {
    'BED.gain': num(/gain:\s*([0-9.]+),\s*\/\/ 마스터 대비 배경음 천장/),
    'BED.fadeIn': num(/fadeIn:\s*([0-9.]+)/),
    'BED.fadeOut': num(/fadeOut:\s*([0-9.]+)/),
    MASTER: num(/var MASTER = ([0-9.]+)/)
  };
  const want = { 'BED.gain': BED.gain, 'BED.fadeIn': BED.fadeIn, 'BED.fadeOut': BED.fadeOut, MASTER };
  for (const k of Object.keys(want)) {
    if (got[k] !== want[k]) {
      throw new Error(`${path.relative(ROOT, file)} 의 ${k} 가 ${got[k]} 인데 이 도구는 ${want[k]} 로 알고 있다 — 도구를 고칠 것`);
    }
  }
}

/* ==========================================================================
 * 2. 합성 — 코어의 buildBed() · seqNote() 를 그대로 옮긴 것
 * ========================================================================== */

/** 대역제한 파형 한 표본. Web Audio 의 PeriodicWave 와 같은 배음 구성이다. */
function waveSample(type, phase, f) {
  const nyq = SR / 2;
  const kmax = Math.max(1, Math.floor(nyq / f));
  let v = 0, k;
  switch (type) {
    case 'sine':
      return Math.sin(phase);
    case 'square':
      for (k = 1; k <= kmax; k += 2) v += Math.sin(k * phase) / k;
      return v * (4 / Math.PI);
    case 'sawtooth':
      for (k = 1; k <= kmax; k++) v += (k % 2 ? 1 : -1) * Math.sin(k * phase) / k;
      return v * (2 / Math.PI);
    case 'triangle':
      for (k = 1; k <= kmax; k += 2) {
        v += (((k - 1) / 2) % 2 ? -1 : 1) * Math.sin(k * phase) / (k * k);
      }
      return v * (8 / (Math.PI * Math.PI));
    default:
      return Math.sin(phase);
  }
}

/** 코어의 noiseBuffer() 와 같은 잡음 1.2초. Math.random 을 쓰지 않는다. */
function noiseBuffer() {
  const n = Math.floor(SR * 1.2);
  const d = new Float64Array(n);
  let seed = 22695477;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    d[i] = (seed / 0x3fffffff) - 1;
  }
  return d;
}

/** Audio EQ Cookbook 계수. Web Audio BiquadFilterNode 와 같은 식이다. */
function biquad(type, f0, q) {
  const w0 = 2 * Math.PI * f0 / SR;
  const cw = Math.cos(w0), sw = Math.sin(w0);
  /* 규격상 lowpass·highpass 의 Q 는 데시벨, bandpass 는 그냥 Q 다. */
  const Q = (type === 'lowpass' || type === 'highpass') ? Math.pow(10, q / 20) : q;
  const alpha = sw / (2 * Q);
  let b0, b1, b2;
  if (type === 'lowpass') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
  else if (type === 'highpass') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
  else { b0 = alpha; b1 = 0; b2 = -alpha; }            // bandpass (0dB 피크)
  const a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/**
 * 배경음 한 편을 렌더한다.
 * @returns {{pcm: Float64Array, layers: Array}} pcm 은 마스터를 통과한 뒤의 신호
 */
function render(voice, seconds) {
  const n = Math.round(seconds * SR);
  const mix = new Float64Array(n);       // BED.gain·MASTER 를 걸기 **전**의 합
  const layers = [];
  const noise = noiseBuffer();

  for (const spec of voice) {
    const buf = new Float64Array(n);
    const base = Math.max(0.0002, spec.gain === undefined ? 1 : spec.gain);

    if (spec.seq) {
      /* 반복 악절 — 코어의 스케줄러가 step 마다 한 칸씩 예약하는 것과 같다.
       * 한 음의 포락선은 0.0001 →(8ms, 지수) peak →(dur, 지수) 0.0001 이다. */
      const step = spec.step;
      const dur = spec.dur === undefined ? step * 0.9 : spec.dur;
      let sounded = 0;
      for (let i = 0; ; i++) {
        const t0 = SEQ_START + i * step;
        if (t0 >= seconds) break;
        const semi = spec.seq[i % spec.seq.length];
        if (semi === null || semi === undefined) continue;
        sounded += Math.min(dur, seconds - t0);
        const f = spec.root * Math.pow(2, semi / 12);
        const i0 = Math.round(t0 * SR);
        const iEnd = Math.min(n, Math.round((t0 + dur) * SR));
        const iAtk = Math.min(iEnd, Math.round((t0 + NOTE_ATTACK) * SR));
        let phase = 0;
        const dp = 2 * Math.PI * f / SR;
        for (let s = i0; s < iEnd; s++, phase += dp) {
          if (s < 0) continue;
          /* 지수 램프: 0.0001 에서 목표까지 로그선형으로 오른다 */
          let g;
          if (s < iAtk) {
            const u = (s - i0) / Math.max(1, iAtk - i0);
            g = 0.0001 * Math.pow(base / 0.0001, u);
          } else {
            const u = (s - iAtk) / Math.max(1, iEnd - iAtk);
            g = base * Math.pow(0.0001 / base, u);
          }
          buf[s] += g * waveSample(spec.wave || 'square', phase, f);
        }
      }
      layers.push({ spec, buf, duty: sounded / seconds, kind: 'seq' });
    } else {
      /* 지속음 — 오실레이터 또는 잡음. 필터와 LFO 가 붙을 수 있다. */
      const filt = spec.filter ? biquad(spec.filter, spec.ff, spec.q === undefined ? 1 : spec.q) : null;
      let z1 = 0, z2 = 0, y1 = 0, y2 = 0;
      const f = spec.f;
      const detune = spec.detune ? Math.pow(2, spec.detune / 1200) : 1;
      const dp = f ? 2 * Math.PI * f * detune / SR : 0;
      let phase = 0;
      for (let s = 0; s < n; s++) {
        let x;
        if (spec.noise) x = noise[s % noise.length];
        else { x = waveSample(spec.wave || 'sine', phase, f * detune); phase += dp; }
        if (filt) {
          const y = filt.b0 * x + filt.b1 * z1 + filt.b2 * z2 - filt.a1 * y1 - filt.a2 * y2;
          z2 = z1; z1 = x; y2 = y1; y1 = y;
          x = y;
        }
        /* LFO 는 gain 에 더해진다 — 사인이 0 에서 출발한다 */
        let g = base;
        if (spec.lfo) g += base * spec.lfo.depth * Math.sin(2 * Math.PI * spec.lfo.rate * (s / SR));
        buf[s] += g * x;
      }
      layers.push({ spec, buf, duty: 1, kind: spec.noise ? 'noise' : 'drone' });
    }
    for (let s = 0; s < n; s++) mix[s] += buf[s];
  }

  /* out 게인의 페이드 인 · 끝의 페이드 아웃 · BED.gain · MASTER */
  const pcm = new Float64Array(n);
  for (let s = 0; s < n; s++) {
    const t = s / SR;
    let env = t < BED.fadeIn ? 0.0001 * Math.pow(BED.gain / 0.0001, t / BED.fadeIn) : BED.gain;
    const tail = seconds - t;
    if (tail < BED.fadeOut) env *= Math.pow(0.0001 / 1, 1 - tail / BED.fadeOut);
    pcm[s] = mix[s] * env * MASTER;
  }
  return { pcm, layers };
}

/* ==========================================================================
 * 3. 재기
 * ========================================================================== */

/** 실수 FFT 없이 쓰는 굿-투 스펙트럼 — Goertzel 로 옥타브 밴드 에너지만 뽑는다. */
function bandEnergy(pcm, lo, hi, from, to) {
  /* 대역별 에너지는 2차 IIR 밴드패스를 통과시킨 뒤의 제곱합으로 낸다.
   * 정확한 스펙트럼이 필요한 게 아니라 대역 사이의 비율만 보면 된다. */
  const f0 = Math.sqrt(lo * hi);
  const q = f0 / (hi - lo);
  const c = biquad('bandpass', f0, q);
  let z1 = 0, z2 = 0, y1 = 0, y2 = 0, sum = 0;
  for (let s = 0; s < pcm.length; s++) {
    const x = pcm[s];
    const y = c.b0 * x + c.b1 * z1 + c.b2 * z2 - c.a1 * y1 - c.a2 * y2;
    z2 = z1; z1 = x; y2 = y1; y1 = y;
    if (s >= from && s < to) sum += y * y;
  }
  return sum / (to - from);
}

/** 스펙트럼 중심(밝기). 영교차율로 근사하지 않고 대역 에너지의 가중평균으로 낸다. */
function centroid(pcm, from, to) {
  const edges = [20, 80, 160, 320, 640, 1280, 2560, 5120, 10240, 20000];
  let num = 0, den = 0;
  for (let i = 0; i < edges.length - 1; i++) {
    const e = bandEnergy(pcm, edges[i], edges[i + 1], from, to);
    const f = Math.sqrt(edges[i] * edges[i + 1]);
    num += e * f; den += e;
  }
  return den > 0 ? num / den : 0;
}

/**
 * ITU-R BS.1770 K-가중 라우드니스(LUFS).
 *
 * 그냥 RMS 로 재면 저역이 과대평가된다 — 사람 귀는 100Hz 아래를 훨씬 둔하게 듣는데
 * 두 배경음의 저역 비중이 크게 다르기 때문에(세탁 46% · 게임 67%) RMS 차이를
 * 그대로 "얼마나 크게 들리는가"로 읽으면 게임 쪽을 부풀려 말하게 된다.
 * 48kHz 기준 표준 계수 두 단(하이셸프 → RLB 하이패스)이다.
 */
function lufs(pcm, from, to) {
  const stages = [
    { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [1, -1.69065929318241, 0.73248077421585] },
    { b: [1.0, -2.0, 1.0], a: [1, -1.99004745483398, 0.99007225036621] }
  ];
  let x = pcm;
  for (const st of stages) {
    const y = new Float64Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = st.b[0] * x[i] + st.b[1] * x1 + st.b[2] * x2 - st.a[1] * y1 - st.a[2] * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    x = y;
  }
  let sq = 0;
  for (let i = from; i < to; i++) sq += x[i] * x[i];
  return -0.691 + 10 * Math.log10(sq / (to - from));
}

function measure(pcm, fromSec, toSec) {
  const from = Math.round(fromSec * SR), to = Math.round(toSec * SR);
  let sq = 0, peak = 0;
  for (let s = from; s < to; s++) { sq += pcm[s] * pcm[s]; if (Math.abs(pcm[s]) > peak) peak = Math.abs(pcm[s]); }
  const rms = Math.sqrt(sq / (to - from));

  /* 200Hz 아래는 노트북·휴대폰 스피커가 통째로 잘라 낸다 — 참가자 대부분이
   * 휴대폰으로 보므로 "작은 스피커에서 남는 것"을 따로 잰다(§5-3 과 같은 잣대). */
  const low = bandEnergy(pcm, 20, 200, from, to);
  const mid = bandEnergy(pcm, 200, 2000, from, to);
  const high = bandEnergy(pcm, 2000, 16000, from, to);
  const tot = low + mid + high;

  /* 100ms 창의 세기가 얼마나 출렁이는지 — 곡이 고르게 깔리는지 들쭉날쭉한지 */
  const win = Math.round(0.1 * SR);
  const frames = [];
  for (let s = from; s + win <= to; s += win) {
    let f = 0;
    for (let k = 0; k < win; k++) f += pcm[s + k] * pcm[s + k];
    frames.push(Math.sqrt(f / win));
  }
  frames.sort((a, b) => a - b);
  const pct = p => frames[Math.min(frames.length - 1, Math.floor(frames.length * p))];

  return {
    lufs: lufs(pcm, from, to),
    rmsDb: 20 * Math.log10(rms),
    peakDb: 20 * Math.log10(peak),
    crestDb: 20 * Math.log10(peak / rms),
    centroidHz: centroid(pcm, from, to),
    lowPct: 100 * low / tot,
    midPct: 100 * mid / tot,
    highPct: 100 * high / tot,
    audibleDb: 10 * Math.log10(mid + high),   // 작은 스피커에서 남는 대역의 세기
    dynDb: 20 * Math.log10(pct(0.9) / Math.max(1e-12, pct(0.1)))
  };
}

/* ==========================================================================
 * 4. WAV
 * ========================================================================== */

/* 들으려고 만드는 파일에 거는 이득.
 *
 * 배경음의 실제 레벨은 −57 ~ −48 dBFS 다(BED.gain 0.075 × MASTER 0.32). 그대로 쓰면
 * 음량을 끝까지 올려야 겨우 들려서 A/B 비교가 안 된다. **두 파일에 똑같은 값을 건다** —
 * 상대 차이는 그대로 남고 절대 레벨만 올라간다. 게임 쪽 최대가 −31.3dBFS 라
 * +30dB 이면 −1.3dBFS 로 클리핑 없이 올라간다. 재는 값은 이득 걸기 전 신호로 낸다. */
const WAV_GAIN_DB = 30;

function writeWav(file, pcm) {
  const g = Math.pow(10, WAV_GAIN_DB / 20);
  const n = pcm.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, pcm[i] * g));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
}

/* ==========================================================================
 * 5. 실행
 * ========================================================================== */

const LAUNDRY = path.join(ROOT, 'laundry-ad', 'sfx.js');
const GAME = path.join(ROOT, 'game', 'src', 'sfx.js');

function main() {
  const wantWav = process.argv.includes('--wav');
  assertCore(LAUNDRY); assertCore(GAME);

  const beds = {
    세탁: readArray(LAUNDRY, 'BED_VOICE'),
    게임: readArray(GAME, 'BED_VOICE')
  };

  const out = {};
  for (const name of Object.keys(beds)) {
    const r = render(beds[name], WATCH_SEC);
    /* 페이드 인이 끝나고(1.2초) 악절이 한 바퀴를 돈 뒤부터 잰다 — 9.72~28.0초.
     * 시작 구간을 넣으면 페이드가 두 자극의 차이로 잘못 읽힌다. */
    out[name] = { r, m: measure(r.pcm, 9.72, WATCH_SEC - BED.fadeOut) };
    if (wantWav) {
      const dir = path.join(ROOT, 'laundry-ad', 'test', 'out', 'bed');
      fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, 'bed-' + (name === '세탁' ? 'laundry' : 'game') + '-watch.wav');
      writeWav(f, r.pcm);
      out[name].wav = f;
    }
  }

  const L = out['세탁'].m, G = out['게임'].m;
  const row = (label, a, b, fmt, ratio) => {
    const f = fmt || (v => v.toFixed(2));
    const cmp = ratio ? ratio(a, b) : (a - b >= 0 ? '+' : '') + (a - b).toFixed(2);
    console.log('  ' + label.padEnd(26) + f(a).padStart(10) + f(b).padStart(10) + String(cmp).padStart(12));
  };

  console.log('\n배경음 실측 — watch 길이 ' + WATCH_SEC + '초 · 9.72초부터 잰다 (페이드·첫 바퀴 제외)\n');
  console.log('  ' + ''.padEnd(26) + '세탁'.padStart(9) + '게임'.padStart(9) + '차'.padStart(11));
  console.log('  ' + '-'.repeat(58));
  row('라우드니스 (LUFS)', L.lufs, G.lufs, v => v.toFixed(1));
  row('세기 RMS (dBFS)', L.rmsDb, G.rmsDb, v => v.toFixed(1) + 'dB');
  row('최대 (dBFS)', L.peakDb, G.peakDb, v => v.toFixed(1) + 'dB');
  row('크레스트', L.crestDb, G.crestDb, v => v.toFixed(1) + 'dB');
  row('작은 스피커에서 남는 세기', L.audibleDb, G.audibleDb, v => v.toFixed(1) + 'dB');
  row('밝기(스펙트럼 중심)', L.centroidHz, G.centroidHz, v => Math.round(v) + 'Hz',
    (a, b) => '×' + (a / b).toFixed(2));
  row('200Hz 아래 비중', L.lowPct, G.lowPct, v => v.toFixed(1) + '%');
  row('200~2000Hz 비중', L.midPct, G.midPct, v => v.toFixed(1) + '%');
  row('2kHz 위 비중', L.highPct, G.highPct, v => v.toFixed(1) + '%');
  row('세기 출렁임(90/10 분위)', L.dynDb, G.dynDb, v => v.toFixed(1) + 'dB');

  console.log('\n  층별 — 세기(gain) · 울리는 시간 비율(duty) · 초당 음 수');
  for (const name of Object.keys(out)) {
    console.log('  [' + name + ']');
    for (const l of out[name].r.layers) {
      const s = l.spec;
      const what = s.seq
        ? (s.wave || 'square') + ' seq ' + s.step + 's'
        : (s.noise ? 'noise ' + s.filter + ' ' + s.ff + 'Hz' : (s.wave || 'sine') + ' ' + s.f + 'Hz');
      const rate = s.seq ? (s.seq.filter(v => v !== null && v !== undefined).length / (s.seq.length * s.step)) : 0;
      console.log('    ' + what.padEnd(26) +
        ('gain ' + (s.gain === undefined ? 1 : s.gain)).padStart(11) +
        ('duty ' + (l.duty * 100).toFixed(0) + '%').padStart(11) +
        (rate ? ('  ' + rate.toFixed(1) + '음/초') : ''));
    }
  }

  if (wantWav) {
    console.log('\n  WAV: ' + Object.keys(out).map(k => path.relative(ROOT, out[k].wav)).join('  ·  '));
    console.log('  두 파일에 같은 이득 +' + WAV_GAIN_DB + 'dB 를 걸었다 — 상대 차이는 그대로다.');
    console.log('  같은 기기·같은 음량으로 번갈아 들어 볼 것 (효과음은 빠져 있다 — 배경음만이다)');
  }
  console.log('');
}

if (require.main === module) main();
module.exports = { render, measure, readArray, WATCH_SEC, SR };
