/* 효과음 — 두 자극의 소리가 같은 규격인지 검사한다.
 *
 * 왜 이 검사가 필요한가
 *   소리는 두 광고를 비교하는 실험에서 교란변인이 되기 쉽다. 한쪽만 크거나, 길거나,
 *   더 자주 울리면 그 차이가 "광고 형식의 효과"로 잘못 읽힌다. 그래서 신호의 길이·세기와
 *   CTA 클릭음은 두 파일이 **글자 그대로 같은 코어**에 두고, 여기서 그것을 직접 비교한다.
 *   음색(VOICES)만 자극마다 다르다 — 광고하는 물건이 다르니 소리도 다르되, 다른 것은 음색뿐이다.
 *
 *   배경음(BGM)도 같은 규칙을 따른다. 음량 천장·페이드·켜고 끄는 절차는 코어(BED)에 있고,
 *   음색(BED_VOICE)만 자극마다 다르다 — 이건 의도한 차이이므로 여기서 "달라야 한다"고 검사한다.
 *   그 대가(광고 태도 차이가 형식 때문인지 음악 때문인지 갈리지 않는다)는 INTEGRATION.md §3 참고.
 *
 * 한계: jsdom 에는 AudioContext 가 없다. 여기서 "소리가 실제로 나는지"는 확인할 수 없고,
 *   ① 규격이 같은지 ② 소리 코드가 자극을 멈추지 않는지 ③ 신호 수가 로그에 남는지를 본다.
 *   실제로 들리는지는 브라우저에서 사람이 확인해야 한다(AUDIO_OK 로 참가자별 기록도 남는다).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { APP_DIR, bootPage, wait, suite } = require('./lib/harness');

const LAUNDRY_SFX = path.join(APP_DIR, 'sfx.js');
const GAME_SFX = path.join(APP_DIR, '..', 'game', 'src', 'sfx.js');

const BEGIN = 'SFX-CORE-BEGIN';
const END = 'SFX-CORE-END';

/** 두 파일이 같아야 하는 구간만 잘라 낸다 */
function core(src) {
  const a = src.indexOf(BEGIN);
  const b = src.indexOf(END);
  if (a < 0 || b < 0) return null;
  return src.slice(a, b + END.length);
}

/** var VOICES = { ... } 의 최상위 신호 이름 */
function voiceNames(src) {
  const at = src.indexOf('var VOICES = {');
  if (at < 0) return [];
  const body = src.slice(at);
  const out = [];
  const re = /^ {4}(\w+): \[/gm;
  let m;
  while ((m = re.exec(body))) out.push(m[1]);
  return out;
}

/** CUES 의 신호 이름 */
function cueNames(src) {
  const at = src.indexOf('var CUES = {');
  if (at < 0) return [];
  const body = src.slice(at, src.indexOf('};', at));
  const out = [];
  const re = /^ {4}(\w+): \{/gm;
  let m;
  while ((m = re.exec(body))) out.push(m[1]);
  return out;
}

/** var BED_VOICE = [ ... ] 본문. 없으면 null */
function bedVoice(src) {
  const at = src.indexOf('var BED_VOICE = [');
  if (at < 0) return null;
  const end = src.indexOf('\n  ];', at);
  return end < 0 ? null : src.slice(at, end);
}

/** 코어에서 `var 이름 = { ... }` 블록 하나를 잘라 낸다 */
function block(src, name) {
  const at = src.indexOf('var ' + name + ' = {');
  if (at < 0) return '';
  const end = src.indexOf('\n  };', at);
  return end < 0 ? '' : src.slice(at, end);
}

/**
 * 배경음 레이어를 훑어 "작은 스피커에서 살아남는 대역"의 세기를 더한다.
 *
 * 노트북·휴대폰 스피커는 대략 150~200Hz 아래를 통째로 잘라 낸다. 배경음을 저역으로만
 * 짜 두면 이어폰에서는 들리고 참가자 대부분의 기기에서는 안 들려서, **한쪽 자극만 무음**
 * 이 된다(실제로 게임 쪽이 55·82Hz 로 그렇게 됐던 적이 있다).
 *
 * 정확한 음량 계산이 아니라 "전부 저역"을 잡아내는 거친 자다 —
 * 두 배경음의 실제 크기가 비슷한지는 사람이 같은 기기로 번갈아 들어 봐야 한다.
 */
function audibleGain(bedSrc) {
  const chunks = (bedSrc || '').split(/\n\s*\{\s/).slice(1);
  let sum = 0;
  for (const c of chunks) {
    const gain = parseFloat((/gain:\s*([0-9.]+)/.exec(c) || [])[1]);
    if (!(gain > 0)) continue;
    let f;
    if (/\broot:\s*([0-9.]+)/.test(c)) {
      // 반복 악절 — 기준 음으로 본다(음이 그 위아래로 오르내린다)
      f = parseFloat(/\broot:\s*([0-9.]+)/.exec(c)[1]);
    } else if (/noise:\s*true/.test(c)) {
      const ff = parseFloat((/\bff:\s*([0-9.]+)/.exec(c) || [])[1]);
      // 저역통과는 대역 전체가 아니라 그 아래에 에너지가 실린다 — 중심을 절반으로 본다
      f = /'lowpass'/.test(c) ? ff / 2 : ff;
    } else {
      f = parseFloat((/\bf:\s*([0-9.]+)/.exec(c) || [])[1]);
    }
    if (f >= 200) sum += gain;
  }
  return Math.round(sum * 100) / 100;
}

/**
 * 큐 음색이 "작은 스피커에서 살아남는가".
 *
 * 배경음에는 이미 같은 잣대를 대고 있었는데(audibleGain) 큐에는 없었다. 그 틈으로
 * 세탁 쪽 fail 이 순수 sine 190 → 72Hz 로 들어가 있었다 — 휴대폰에서는 거의 안 들려서,
 * CUES 가 정해 둔 beat < bad < fail 세기 순서가 기기에서는 뒤집혀 있었다.
 *
 * 파형에 따라 남는 것이 다르다. sine 은 배음이 없어 기본음이 잘리면 끝이고,
 * triangle·square·sawtooth 는 배음이 위로 뻗어 기본음이 잘려도 소리가 남는다
 * (사람은 그 배음들로 원래 음높이를 듣는다 — 결여 기본음).
 *
 * 정확한 음량 계산이 아니라 "저역에만 있는 신호"를 잡아내는 거친 자다.
 */
const SMALL_SPEAKER_CUT = 200;   // Hz — 이 아래는 없는 것으로 친다

function layerSurvives(chunk) {
  const num = re => { const m = re.exec(chunk); return m ? parseFloat(m[1]) : null; };
  const f0 = num(/\bf0:\s*([0-9.]+)/);
  if (f0 === null) return true;                       // 주파수가 없는 레이어는 판단 대상 아님
  const f1 = num(/\bf1:\s*([0-9.]+)/);
  const geo = f1 ? Math.sqrt(f0 * f1) : f0;           // 훑는 소리는 기하평균으로 대표한다
  if (/noise:\s*true/.test(chunk)) {
    return (/'lowpass'/.test(chunk) ? geo / 2 : geo) >= SMALL_SPEAKER_CUT;
  }
  if (/wave:\s*'sine'/.test(chunk)) return geo >= SMALL_SPEAKER_CUT;
  return geo * 3 >= SMALL_SPEAKER_CUT;                // 배음이 있는 파형
}

/** 신호 이름 → 살아남는 레이어가 하나라도 있는가 */
function cueSurvival(src) {
  const at = src.indexOf('var VOICES = {');
  const body = src.slice(at, src.indexOf('\n  };', at));
  const out = {};
  const re = /^ {4}(\w+): \[([\s\S]*?)^ {4}\]/gm;
  let m;
  while ((m = re.exec(body))) {
    const layers = m[2].split(/\n\s*\{\s/).slice(1);
    out[m[1]] = layers.some(layerSurvives);
  }
  return out;
}

module.exports = async function () {
  const t = suite('효과음 · 두 자극 규격 일치');

  const L = fs.readFileSync(LAUNDRY_SFX, 'utf8');
  const G = fs.readFileSync(GAME_SFX, 'utf8');

  t.section('공유 코어 — 길이·세기·CTA 음·재생 절차');
  const lc = core(L);
  const gc = core(G);
  t.ok(!!lc && !!gc, '두 파일 모두 코어 표시가 있다');
  t.ok(lc === gc, '코어가 글자 하나까지 같다',
    lc === gc ? (lc || '').split('\n').length + '줄' : '어긋남 — 한쪽만 고쳤다');

  t.section('신호 목록');
  const lCues = cueNames(L);
  const gCues = cueNames(G);
  const lV = voiceNames(L).sort();
  const gV = voiceNames(G).sort();
  t.ok(lCues.length > 0 && String(lCues) === String(gCues), '신호 이름·순서가 같다', lCues.join(' '));
  t.ok(String(lV) === String(gV), '두 자극이 같은 신호에 음색을 준다', lV.join(' '));
  /* cta 는 음색까지 공유해야 하므로 VOICES 에 있으면 안 된다 —
   * 있으면 코어의 CTA_VOICE 대신 그것이 쓰인다고 착각하기 쉽다(실제로는 코어가 이긴다). */
  t.ok(lV.indexOf('cta') < 0 && gV.indexOf('cta') < 0,
    'CTA 클릭음은 음색까지 공유한다(VOICES 에 없다)');
  const missing = lCues.filter(c => c !== 'cta' && lV.indexOf(c) < 0);
  t.ok(missing.length === 0, '모든 신호에 음색이 있다', missing.length ? missing : undefined);

  t.section('배경음 — 규격은 공유, 음색만 다르다');
  const lb = bedVoice(L);
  const gb = bedVoice(G);
  t.ok(!!lb && !!gb, '두 파일 모두 배경음 음색이 있다');
  /* 음량 천장·페이드는 코어에 있어야 한다. 자극별 파일로 새어 나가면 한쪽만 크게 깔 수 있다. */
  t.ok(/var BED = \{/.test(lc || '') && /var BED = \{/.test(gc || ''),
    '음량 천장·페이드는 코어가 정한다 (BED)');
  t.ok(!/\bBED\s*=\s*\{/.test((lb || '') + (gb || '')),
    '자극별 파일은 BED 를 덮어쓰지 않는다');
  /* 배경음이 큐를 가리면 길이·세기를 맞춰 둔 의미가 없다.
   * 가장 작은 큐(beat)보다 확실히 낮은지 본다. */
  const bedGain = parseFloat((/gain:\s*([0-9.]+)/.exec(block(lc || '', 'BED')) || [])[1]);
  const cueGains = [...block(lc || '', 'CUES').matchAll(/gain:\s*([0-9.]+)/g)].map(m => parseFloat(m[1]));
  const minCue = cueGains.length ? Math.min.apply(null, cueGains) : NaN;
  t.ok(bedGain > 0 && bedGain < minCue / 2,
    '배경음이 가장 작은 큐보다 확실히 낮다 (큐를 가리지 않는다)',
    { 배경음: bedGain, 최소큐: minCue });
  /* 음색은 달라야 한다 — 자극별 배경음을 쓰기로 한 결정이다(INTEGRATION.md §3). */
  t.ok(lb !== gb, '배경음 음색은 자극마다 다르다 (의도된 차이)');

  t.section('큐 음색도 작은 스피커에서 살아남는다');
  {
    /* 두 자극 모두에 같은 잣대를 댄다 — 한쪽만 검사하면 그 자체가 비대칭이 된다. */
    for (const [name, src] of [['세탁', L], ['게임', G]]) {
      const surv = cueSurvival(src);
      const dead = Object.keys(surv).filter(k => !surv[k]);
      t.ok(dead.length === 0, name + ' — 모든 큐에 200Hz 위로 남는 성분이 있다',
        dead.length ? dead : undefined);
    }
  }
  t.ok(/startBed/.test(lc || '') && /stopBed/.test(lc || ''),
    '켜고 끄는 절차가 코어에 있다');
  /* 반복 악절(시퀀서)도 코어에 있어야 한다. 한쪽 자극에만 두면 빠르기·박자 정확도가
   * 자극마다 달라지고, 그건 음색이 아니라 규격의 차이다. */
  t.ok(/function seqNote/.test(lc || '') && /BED\.lookahead/.test(lc || ''),
    '반복 악절 재생도 코어가 맡는다 (빠르기·박자 정확도가 자극마다 안 갈린다)');
  /* 저역으로만 짜인 배경음은 작은 스피커에서 통째로 사라진다 —
   * 그러면 그 자극만 무음이 되어, 맞춰 놓은 규격이 아무 의미가 없어진다. */
  const la = audibleGain(lb);
  const ga = audibleGain(gb);
  t.ok(la >= 0.1 && ga >= 0.1,
    '두 배경음 다 작은 스피커에서 들리는 대역이 있다 (전부 저역이 아니다)',
    { 세탁: la, 게임: ga });
  /* 한쪽만 앞에 나오면 그 차이가 광고 태도 점수로 들어온다. 한때 세탁 0.16 : 게임 0.55 로
   * 벌어져 있었고, 세탁에도 악절을 얹어 맞췄다. 거친 자라 2배까지는 봐준다 —
   * 실제 크기가 비슷한지는 사람이 같은 기기로 번갈아 들어야 안다. */
  const ratio = Math.round((Math.max(la, ga) / Math.min(la, ga)) * 100) / 100;
  t.ok(ratio <= 2, '두 배경음의 밝기가 비슷하다 (한쪽만 앞에 나오지 않는다)',
    { 배수: ratio, 세탁: la, 게임: ga });

  t.section('오프라인 · 파일 없음');
  const external = /https?:\/\//;
  t.ok(!external.test(L) && !external.test(G), '외부 요청 없음(두 파일 모두 합성)');
  t.ok(!/\.(mp3|wav|ogg|m4a)\b/.test(L) && !/\.(mp3|wav|ogg|m4a)\b/.test(G),
    '오디오 파일을 쓰지 않는다');
  // 호출만 본다 — 코어 주석이 Math.random 을 언급하고 있어서 이름만으로는 못 가린다
  t.ok(!/Math\.random\s*\(/.test(core(L) || ''),
    '잡음이 결정적이다(참가자마다 다른 소리가 나지 않는다)');

  t.section('무음 환경에서도 자극이 돌아간다 (jsdom = AudioContext 없음)');
  const w = bootPage('?mode=watch&ver=A&sid=sfx-w');
  await wait(150);
  t.ok(!!w.AD_SFX, 'AD_SFX 가 만들어졌다');
  t.ok(w.AD_SFX.state() === 'none', '장치가 없으면 state = none', w.AD_SFX && w.AD_SFX.state());
  t.ok(w.AD_SFX.audioOk() === null, '해당 없음은 AUDIO_OK = null (0 아님)', w.AD_SFX && w.AD_SFX.audioOk());
  t.ok(w.AD_SFX.fired > 0, '소리가 안 나도 신호 수는 센다', w.AD_SFX && w.AD_SFX.fired);
  t.ok(w.AD_SFX.played === 0, '실제로 난 소리는 0', w.AD_SFX && w.AD_SFX.played);
  t.ok(typeof w.AD_SFX.startBed === 'function' && typeof w.AD_SFX.stopBed === 'function',
    '배경음 켜고 끄기가 노출돼 있다');
  t.ok(w.AD_SFX.bedOn === false, '장치가 없으면 배경음도 안 켜진다(자극은 그대로 진행)',
    w.AD_SFX && w.AD_SFX.bedOn);
  t.ok(w.AD_SFX.startBed() === false, '켜 달라고 해도 조용히 실패한다(예외 없음)');
  t.ok((w.__errors || []).length === 0, 'JS 에러 없음', (w.__errors || []).map(String));

  t.section('sound=0 이면 처음부터 무음');
  const q = bootPage('?mode=watch&ver=A&sid=sfx-q&sound=0');
  await wait(150);
  t.ok(q.AD_SFX.state() === 'off', 'state = off', q.AD_SFX && q.AD_SFX.state());
  t.ok(q.AD_SFX.audioOk() === null, 'AUDIO_OK = null');

  t.section('로그에 남는다');
  const E = w.AD_ENGINE;
  for (let i = 0; i < 10; i++) { E.next(); await wait(12); }
  await wait(40);
  const p = (w.__messages.find(m => m && m.type === 'AD_DONE') || {}).payload || {};
  t.ok(p.SFX_COUNT > 0, 'SFX_COUNT 가 payload 에 있다', p.SFX_COUNT);
  t.ok(p.AUDIO_OK === null, 'AUDIO_OK 가 payload 에 있다', p.AUDIO_OK);

  return t.failed;
};
