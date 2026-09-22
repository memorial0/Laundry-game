/* 러너·설문 테스트 공용 하네스
 *  - bootRunner(query) : preview.html + survey.js + practice.js 를 jsdom 으로 실제 실행
 *  - fillPage / clickNext : 화면을 사람처럼 채우고 넘긴다
 *  - suite(name) : 아주 작은 assert/리포터 (laundry-ad/test 와 같은 꼴)
 *
 * 왜 러너를 통째로 띄우나. 문항 은행(survey.js)만 단위 검사하면 "값이 어느 칸으로
 * 들어가는가"를 못 본다. 실제로 샌 사고들이 거기 있었다 — 서술형이 7점 척도로 그려지고,
 * 응답 개수 표시가 선택 문항을 답한 것으로 세고. 화면을 실제로 눌러 봐야 드러난다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '../..');

/* jsdom 은 외부 <script src> 를 가져오지 않는다. 태그를 지우고 직접 주입한다.
 * ?v= 는 build.mjs 가 해시로 바꿔 넣으므로 숫자만 받으면 안 된다. */
const STRIP = /<script src="(survey|practice)\.js\?v=[\w.-]+"><\/script>/g;

/** 러너를 띄운다. base 를 주면 배포본(dist/) 으로도 같은 검사를 돌릴 수 있다. */
function bootRunner(query, opts) {
  const base = (opts && opts.base) || ROOT;
  const file = fs.existsSync(path.join(base, 'preview.html')) ? 'preview.html' : 'index.html';
  const html = fs.readFileSync(path.join(base, file), 'utf8');
  const survey = fs.readFileSync(path.join(base, 'survey.js'), 'utf8');
  const practice = fs.readFileSync(path.join(base, 'practice.js'), 'utf8');
  const inline = html.match(/<script>([\s\S]*)<\/script>/)[1];

  const dom = new JSDOM(
    html.replace(STRIP, '').replace(/<script>[\s\S]*<\/script>/, '<script></script>'),
    { url: 'http://localhost/' + file + '?' + (query || ''), pretendToBeVisual: true, runScripts: 'dangerously' }
  );
  const w = dom.window;

  /* 러너는 시작할 때 game/dist 존재를 HEAD 로 확인한다 — jsdom 에는 fetch 가 없다.
   * 있다고 답해 두면 시작 화면이 경고 없이 뜬다. */
  w.fetch = () => Promise.resolve({ ok: true });
  /* jsdom 에 없는 스크롤 API. 없으면 화면 전환마다 예외가 나 흐름이 끊긴다. */
  w.Element.prototype.scrollIntoView = function () {};
  w.scrollTo = function () {};

  w.__errors = [];
  w.addEventListener('error', (e) => w.__errors.push(String(e.error)));

  [survey, practice, inline].forEach((src) => {
    const s = w.document.createElement('script');
    s.textContent = src;
    w.document.body.appendChild(s);
  });
  return w;
}

/** 실험 흐름을 처음부터 만든다 (시작 화면의 '시작' 버튼이 하는 일) */
function startFlow(w) {
  w.state.flow = w.buildFlow();
  w.state.step = 0;
  w.render();
  return w.state.flow;
}

/** 동의서 화면의 확인란을 모두 켜고 넘어간다 */
function agreeConsent(w) {
  w.SURVEY.CONSENT.checks.forEach((c) => {
    const b = w.document.getElementById('ck_' + c.id);
    b.checked = true;
    b.onchange();
  });
  w.document.getElementById('next').click();
}

/** 라디오 하나를 사람처럼 고른다 (change 를 울려야 개수 표시가 따라온다) */
function choose(w, scope, id, value) {
  const el = w.document.querySelector('input[name="' + scope + '__' + id + '"][value="' + value + '"]');
  if (!el) return false;
  el.checked = true;
  el.dispatchEvent(new w.Event('change', { bubbles: true }));
  return true;
}

/** 서술형 칸에 글을 넣는다 */
function type(w, scope, id, text) {
  const ta = w.document.querySelector('textarea[name="' + scope + '__' + id + '"]');
  if (!ta) return false;
  ta.value = text;
  ta.dispatchEvent(new w.Event('input', { bubbles: true }));
  return true;
}

/** 지금 화면에 그려진 문항 목록 */
function itemsOnScreen(w) {
  return Array.from(w.document.querySelectorAll('.item[data-item]'));
}

/** 화면 아래 개수 표시 */
function countText(w) {
  const el = w.document.getElementById('count');
  return el ? el.textContent : null;
}

/** 지금 화면의 scope — 문항 이름에 붙는 앞머리 */
function scopeOf(w, st) {
  if (st.kind === 'survey') return w.blockKey(st.b) + '_' + st.page.key;
  if (st.kind === 'debrief') return 'debrief';
  return st.kind;   // pre · demo
}

/** 지금 화면에서 받는 문항들 (응답확인이 붙는 쪽은 그것까지) */
function itemsOf(w, st) {
  const S = w.SURVEY;
  if (st.kind === 'pre') return S.PRE;
  if (st.kind === 'demo') return S.DEMO;
  if (st.kind === 'debrief') return [S.DEBRIEF_WITHDRAW];
  return st.page.items.concat(st.attention ? [S.ATTENTION] : []);
}

/** '다음' 을 누른다. 화면이 안 바뀌면 false (미응답으로 막힌 것) */
function clickNext(w) {
  const before = w.state.step;
  const btn = w.document.getElementById('next');
  if (btn) btn.click();
  return w.state.step !== before;
}

/** 안내·휴식·자극 재생처럼 문항이 없는 화면을 지나간다 */
function skipScreen(w) {
  const before = w.state.step;
  if (!clickNext(w)) { w.state.step++; w.render(); }
  return w.state.step !== before;
}

function suite(name) {
  console.log('\n\x1b[1m' + name + '\x1b[0m');
  const state = { failed: 0 };
  return {
    ok(cond, label, extra) {
      const mark = cond ? '\x1b[32m  ✓\x1b[0m ' : '\x1b[31m  ✗\x1b[0m ';
      console.log(mark + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
      if (!cond) state.failed++;
    },
    section(t) { console.log('  \x1b[2m' + t + '\x1b[0m'); },
    note(t, extra) { console.log('\x1b[2m  ·\x1b[0m ' + t + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); },
    get failed() { return state.failed; }
  };
}

module.exports = {
  ROOT, bootRunner, startFlow, agreeConsent, choose, type,
  itemsOnScreen, countText, scopeOf, itemsOf, clickNext, skipScreen, suite
};
