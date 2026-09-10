/* ==========================================================
 * survey-doc.js — 제시용 전문(SURVEY.md)을 survey.js 에서 만든다.
 *
 * 왜 생성하나
 *   전문은 심의 서류로 나가고 코드는 화면을 그린다. 두 곳에 문항을 따로 적어 두면
 *   한쪽만 고치게 되고, 실제로 그렇게 됐다 — 사전 1의 선택지가 6개에서 7개로 늘고
 *   기본 정보에 서술형이 붙는 동안 전문은 123문항인 채로 남아 있었다.
 *   이제 전문은 손으로 고치는 문서가 아니라 survey.js 에서 떨어지는 산출물이다.
 *
 *   쓰는 법
 *     npm run survey:doc            SURVEY.md 를 다시 만든다
 *     npm run survey:doc -- --check 낡았으면 실패한다 (고쳐 놓고 안 돌린 것을 잡는다)
 *
 * 참가자에게 보이는 글자는 하나도 여기서 짓지 않는다 — 전부 survey.js 에서 온다.
 * 여기 있는 문장은 연구자용 각주(NOTES)뿐이다. 각주는 화면에 안 뜨는 설명이라
 * 문항 은행에 넣을 것이 아니고, 전문에서만 필요하다.
 * ========================================================== */
'use strict';

var fs = require('fs');
var path = require('path');
var S = require('./survey.js');

var OUT = path.join(__dirname, 'SURVEY.md');
var CHECK = process.argv.indexOf('--check') >= 0;

/* 지시문에는 굵게 표기가 <b> 로 들어 있다(화면이 HTML 이라서). 문서에서는 ** 로 옮긴다 —
 * 전문에도 '광고'와 '제품'이 굵게 남아야 한다. 그 대비가 C·D 를 가르는 장치다. */
function md(s) {
  return String(s).replace(/<b>/g, '**').replace(/<\/b>/g, '**');
}

/** 7점 눈금 라벨 한 줄 — '1 = 전혀 그렇지 않다 · 4 = 보통이다 · 7 = 매우 그렇다' */
function scaleLine(item) {
  var t = item.ticks || S.LIKERT_TICKS;
  return Object.keys(t).map(function (k) { return k + ' = ' + t[k]; }).join(' · ');
}

function circles(n) {
  var out = [];
  for (var i = 0; i < n; i++) out.push('○');
  return out.join(' | ');
}

function headRow(scale) {
  var nums = [];
  for (var v = 1; v <= scale; v++) nums.push(v);
  return nums;
}

/** 선택지형 한 줄 — '○ 전혀 안 함　○ 월 1회 이하 …' */
function optLine(item) {
  return item.options.map(function (o) { return '○ ' + o; }).join('　');
}

/** 광고별 설문 29문항의 번호 — 쪽(A~F)이 바뀌어도 1..29 로 이어진다 */
function numbersFor() {
  var no = 1, map = {};
  S.BLOCK_PAGES.forEach(function (pg) {
    pg.items.forEach(function (it) { map[it.id] = no++; });
  });
  return map;
}
var NO = numbersFor();

/** 제품군에 따라 갈리는 문항의 번호대 — '21–23' 처럼 각주에 쓴다 */
function branchRange() {
  var ns = S.BLOCK_ITEMS.filter(function (it) { return it.stemBy; })
                        .map(function (it) { return NO[it.id]; });
  if (!ns.length) return null;
  var lo = Math.min.apply(null, ns), hi = Math.max.apply(null, ns);
  return lo === hi ? String(lo) : lo + '–' + hi;
}

/* 연구자용 각주. 화면에 안 뜨는 설명이라 survey.js 가 아니라 여기 산다.
 * 문항 번호를 손으로 적지 않는다 — 문항이 늘거나 줄면 번호가 따라 움직인다. */
var NOTES = {
  pre1: '사전 1은 다른 두 사전 문항보다 구간을 잘게 나눈 ' + S.PRE[0].options.length +
        '단 척도임. 저빈도(월 단위)와 고빈도(주 5~6회·매일)를 함께 갈라야 하는 문항이라 ' +
        '6단으로는 위쪽이 뭉침. 접촉량을 재는 문항이므로 7점 동의 척도를 쓰지 않음 — ' +
        '"자주"의 기준이 참가자마다 달라 같은 노출량이 다른 점수로 들어옴.',
  pre3: '사전 3은 비게임 제품군(세탁)에 대한 영역 친숙도 문항으로, 게임 앱 이용 빈도와 ' +
        '동일한 ' + S.PRE[1].options.length + '점 구간 척도를 사용함. 두 제품군의 친숙도를 ' +
        '같은 자로 재야 비교가 성립함.',
  cd: '섹션 C와 D는 화면(페이지)을 분리하여 제시하고, 지시문의 \'광고\' / \'제품\'을 굵게 표기함.',
  e: '실제 화면에는 광고된 제품군에 해당하는 문구 하나만 제시됨.',
  attention: '응답 확인 문항은 별도 화면에 두지 않고 해당 블록 마지막 쪽 끝에 붙여 제시함. ' +
             '혼자 있는 화면에 두면 눈에 띄어 거의 전원이 통과하므로 걸러내는 힘을 잃음.',
  demoText: '서술형 문항은 선택 문항이며, 디브리핑 직전(참가자가 아직 연구 목적을 모르는 시점)에 ' +
            '한 번만 제시함. 목적을 알고 나면 소감이 그 틀에 맞춰 재구성되므로 이 자리에서만 ' +
            '있는 그대로의 인상을 받을 수 있음. 방향을 지정하지 않음 — 비교를 시키거나 ' +
            '\'실패\'·\'개입\' 같은 말을 쓰면 조작을 이름 붙여 알려 주는 셈이 됨.'
};

var L = [];
function put(s) { L.push(s == null ? '' : s); }

/* ---------- 머리말 ---------- */
put('# 설문지 (연구참여자 제시용 전문)');
put('');
put('<!-- 이 문서는 survey.js 에서 만든다. 손으로 고치지 말 것 — `npm run survey:doc` 로 다시 만든다. -->');
put('');
put('본 설문은 연구팀 제공 기기의 화면으로 제시되며, 아래는 화면 제시 내용의 전문임.');
put('');
put('구성: 사전 문항 ' + S.PRE.length + ' + 광고별 설문 ' + S.BLOCK_ITEMS.length + '×4 + ' +
    '응답 확인 ' + S.ATTENTION_BLOCKS.length + ' + 기본 정보 ' + S.DEMO.length +
    ' = 총 ' + S.TOTAL_ITEMS + '문항');
put('');
put('연구 참여 동의서와 디브리핑은 이 설문의 앞뒤에 각각 제시되며 별도 문서로 관리함 ' +
    '(문항 수에 세지 않음 · 화면 문구는 `survey.js` 의 `CONSENT` · `DEBRIEF`).');
put('');

/* ---------- 사전 문항 ---------- */
put('## 사전 문항 (동의 취득 직후 · 광고 제시 전 · ' + S.PRE.length + '문항)');
put('');
put('안내: ' + S.PRE_INSTRUCTION);
put('');
S.PRE.forEach(function (it, i) {
  put('**사전 ' + (i + 1) + '.** ' + md(it.stem));
  put('');
  put(optLine(it));
  put('');
});
put('> ※ ' + NOTES.pre1);
put('>');
put('> ※ ' + NOTES.pre3);
put('');

/* ---------- 광고별 설문 ---------- */
var range = branchRange();
put('## 광고별 설문 (광고 1편 종료 직후 제시 · 광고당 ' + S.BLOCK_ITEMS.length + '문항 · 4편 반복)');
put('');
put('아래 ' + S.BLOCK_ITEMS.length + '문항은 광고 1~4 각각의 직후에 문항·순서·문구 동일하게 반복 ' +
    '제시됩니다. 문항 ' + range + '은 광고된 제품군에 따라 대상 명사가 바뀝니다' +
    '([게임]/[비게임] 병기 — 구성개념과 척도는 동일). 광고 제시 순서는 참가자별 배정에 따릅니다.');
put('');
put('화면 안내: ' + S.BEFORE_AD + ' → [광고 제시] → ' + S.AFTER_AD);
put('');
put('개입 조건에는 광고 제시 전 안내에 한 줄이 더 붙습니다: ' + S.BEFORE_AD_INTERVENE);
put('');

S.BLOCK_PAGES.forEach(function (pg) {
  var nums = pg.items.map(function (it) { return NO[it.id]; });
  var span = nums[0] === nums[nums.length - 1] ? String(nums[0])
                                               : nums[0] + '–' + nums[nums.length - 1];
  put('### 섹션 ' + pg.key + '. ' + pg.title + ' (문항 ' + span + ')');
  put('');
  if (pg.instruction) { put(md(pg.instruction)); put(''); }

  var first = pg.items[0];
  if (first.type === 'sd') {
    var head = headRow(first.scale);
    put('| 번호 | | ' + head.join(' | ') + ' | |');
    put('|---|---|' + head.map(function () { return ':-:|'; }).join('') + '---|');
    pg.items.forEach(function (it) {
      put('| ' + NO[it.id] + ' | ' + it.poles[0] + ' | ' + circles(it.scale) + ' | ' + it.poles[1] + ' |');
    });
  } else {
    put(scaleLine(first));
    put('');
    var h = headRow(first.scale);
    put('| 번호 | 문항 | ' + h.join(' | ') + ' |');
    put('|---|---|' + h.map(function () { return ':-:|'; }).join(''));
    pg.items.forEach(function (it) {
      var stem;
      if (it.stemBy) {
        stem = '[게임] ' + it.stemBy.game + '  /  [비게임] ' + it.stemBy.nongame;
      } else {
        stem = md(S.stemFor(it, 'nongame'));
      }
      put('| ' + NO[it.id] + ' | ' + stem + ' | ' + circles(it.scale) + ' |');
    });
  }
  put('');
  if (pg.key === 'D') { put('> ※ ' + NOTES.cd); put(''); }
  if (pg.items.some(function (it) { return it.stemBy; })) { put('> ※ ' + NOTES.e); put(''); }
});

/* ---------- 응답 확인 ---------- */
var attNo = S.BLOCK_ITEMS.length + 1;
put('## 응답 확인 문항 (' +
    S.ATTENTION_BLOCKS.map(function (n) { return '광고 ' + n; }).join('·') +
    ' 블록 말미에만 · 각 1문항)');
put('');
put('| 번호 | 문항 | ' + headRow(S.ATTENTION.scale).join(' | ') + ' |');
put('|---|---|' + headRow(S.ATTENTION.scale).map(function () { return ':-:|'; }).join(''));
put('| ' + attNo + ' | ' + md(S.ATTENTION.stem) + ' | ' + circles(S.ATTENTION.scale) + ' |');
put('');
put('> ※ ' + NOTES.attention);
put('');

/* ---------- 기본 정보 ---------- */
put('## 기본 정보 (광고 4편 종료 후 · ' + S.DEMO.length + '문항)');
put('');
put('안내: ' + S.DEMO_INSTRUCTION);
put('');
var hasText = false;
S.DEMO.forEach(function (it, i) {
  put('**기본 ' + (i + 1) + '.** ' + md(it.stem) + (it.optional ? '  *(선택 문항)*' : ''));
  put('');
  if (it.type === 'text') {
    hasText = true;
    put('```');
    put('[자유 서술 · ' + (it.rows || 4) + '줄 · 최대 ' + (it.maxlen || 1000) + '자]');
    put('```');
    if (it.note) put('화면 표시: ' + it.note);
  } else {
    put(optLine(it));
  }
  put('');
});
if (hasText) { put('> ※ ' + NOTES.demoText); put(''); }

/* ---------- 종료 ---------- */
put('이후 화면 안내: ' + S.CLOSING + ' (디브리핑으로 연결)');
put('');

var doc = L.join('\n');

/* 문항 은행이 스스로 어긋나 있으면 전문부터 틀린다 — 만들기 전에 걸러 낸다 */
var errs = S.validate();
if (errs.length) {
  console.error('survey.js 가 자기점검에서 걸렸다 — 전문을 만들지 않는다:\n  ' + errs.join('\n  '));
  process.exit(1);
}

if (CHECK) {
  var cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (cur !== doc) {
    console.error('SURVEY.md 가 survey.js 와 어긋났다 — npm run survey:doc 을 돌려라.');
    process.exit(1);
  }
  console.log('SURVEY.md 는 survey.js 와 일치한다 (총 ' + S.TOTAL_ITEMS + '문항)');
} else {
  fs.writeFileSync(OUT, doc);
  console.log('SURVEY.md 를 만들었다 — 총 ' + S.TOTAL_ITEMS + '문항 ' +
              '(사전 ' + S.PRE.length + ' + ' + S.BLOCK_ITEMS.length + '×4 + ' +
              '응답확인 ' + S.ATTENTION_BLOCKS.length + ' + 기본 ' + S.DEMO.length + ')');
}
