/* 테스트 공용 하네스
 *  - bootPage(query) : index.html + scenes.js를 jsdom으로 실제 실행
 *  - bootArt(ver)    : DOM 없이 ART(일러스트 모듈)만 로드
 *  - suite(name)     : 아주 작은 assert/리포터
 * 광고 자극 자체는 의존성이 없다. jsdom은 테스트 전용이다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const APP_DIR = path.resolve(__dirname, '../..');
const HTML = fs.readFileSync(path.join(APP_DIR, 'index.html'), 'utf8');
const JS = fs.readFileSync(path.join(APP_DIR, 'scenes.js'), 'utf8');

/** 실제 페이지를 띄운다. window.__messages 에 postMessage 수신분이 쌓인다. */
function bootPage(query) {
  const dom = new JSDOM(HTML.replace('<script src="scenes.js"></script>', ''), {
    url: 'http://localhost/' + (query || ''),
    pretendToBeVisual: true,
    runScripts: 'dangerously'
  });
  const { window } = dom;
  window.__errors = [];
  window.__messages = [];
  window.addEventListener('error', e => window.__errors.push(e.error));
  window.addEventListener('message', e => window.__messages.push(e.data));

  const s = window.document.createElement('script');
  s.textContent = JS;
  window.document.body.appendChild(s);
  return window;
}

/** DOM 스텁으로 scenes.js를 평가해 ART만 꺼낸다(렌더 검사·스토리보드용). */
function bootArt(ver) {
  const win = {
    crypto: globalThis.crypto,
    location: { search: '?ver=' + (ver || 'A'), href: 'http://localhost/' }
  };
  win.window = win;
  const document = {
    readyState: 'loading',                 // boot()이 돌지 않게 한다
    documentElement: { dataset: {} },
    addEventListener() {},
    getElementById() { return null; },
    createElement() {
      return {
        className: '', dataset: {}, innerHTML: '',
        querySelector() { return { addEventListener() {}, classList: { add() {} } }; }
      };
    }
  };
  const fn = new Function(
    'window', 'document', 'location', 'URLSearchParams',
    'performance', 'setInterval', 'requestAnimationFrame', JS
  );
  fn(win, document, win.location, URLSearchParams, { now: () => 0 }, () => {}, () => {});
  return win.AD_ART;
}

const wait = ms => new Promise(r => setTimeout(r, ms));

/** 장면 6에서 쓸 포인터 드래그. jsdom에는 PointerEvent가 없어 MouseEvent로 만든다. */
function dragSheet(window, from, to) {
  const el = window.document.querySelector('.sc6');
  const svg = el.querySelector('svg');
  // jsdom은 레이아웃이 없으므로 뷰포트=뷰박스로 고정한다
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1080, height: 1920 });
  const sheet = el.querySelector('.s6-sheet');
  const mk = (type, x, y) =>
    new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });

  sheet.dispatchEvent(mk('pointerdown', from.x, from.y));
  el.dispatchEvent(mk('pointermove', (from.x + to.x) / 2, (from.y + to.y) / 2));
  el.dispatchEvent(mk('pointermove', to.x, to.y));
  el.dispatchEvent(mk('pointerup', to.x, to.y));
  return { el, sheet };
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
    get failed() { return state.failed; }
  };
}

module.exports = { APP_DIR, bootPage, bootArt, wait, dragSheet, suite };
