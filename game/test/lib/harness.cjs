/* 게임 자극 테스트 공용 하네스
 *  - build()      : src 를 jsdom 이 실행할 수 있는 단일 IIFE 번들로 묶는다(esbuild)
 *  - bootPage(q)  : 그 번들을 jsdom 에서 실제로 돌린다
 *  - suite(name)  : laundry-ad/test/lib/harness.js 와 같은 아주 작은 리포터
 *
 * 자극 자체는 브라우저 API 만 쓴다. jsdom·esbuild 는 테스트 전용이다.
 * jsdom 에는 캔버스가 없으므로 2D 컨텍스트를 통째로 스텁으로 갈아 끼운다 —
 * 그림은 검사하지 않고 상태 기계·로그·종료 통지만 본다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { JSDOM } = require('jsdom');

const APP_DIR = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(__dirname, '../.build');
const BUNDLE = path.join(OUT_DIR, 'main.js');

/** src/main.jsx → test/.build/main.js (IIFE). 브라우저 빌드(dist)와 별개다. */
function build() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  execFileSync(path.join(APP_DIR, 'node_modules/.bin/esbuild'), [
    path.join(APP_DIR, 'src/main.jsx'),
    '--bundle',
    '--format=iife',
    '--jsx=automatic',
    '--loader:.css=empty',      // 스타일은 검사 대상이 아니다
    '--define:process.env.NODE_ENV="production"',  // StrictMode 이중 실행을 피한다
    '--outfile=' + BUNDLE
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  return fs.readFileSync(BUNDLE, 'utf8');
}

/** 캔버스 2D 컨텍스트 스텁 — 자극이 호출하는 메서드를 전부 받아 넘긴다 */
function stubContext() {
  const noop = () => {};
  const ctx = {
    canvas: null,
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop,
    rect: noop, roundRect: noop, fill: noop, stroke: noop,
    fillRect: noop, strokeRect: noop, clearRect: noop, fillText: noop,
    measureText: () => ({ width: 0 }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop })
  };
  return ctx;
}

/**
 * 자극 페이지를 띄운다.
 *   window.__messages 에 postMessage 수신분이, __errors 에 JS 에러가 쌓인다.
 */
function bootPage(query, bundle) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/' + (query || ''),
    pretendToBeVisual: true,          // requestAnimationFrame 이 실제로 돈다
    runScripts: 'dangerously'
  });
  const { window } = dom;
  window.__errors = [];
  window.__messages = [];
  window.addEventListener('error', e => window.__errors.push(e.error || e.message));
  window.addEventListener('message', e => window.__messages.push(e.data));

  // 캔버스: 컨텍스트와 레이아웃을 둘 다 스텁으로 준다.
  // getBoundingClientRect 가 0 이면 포인터 좌표 변환에서 Infinity 가 나온다.
  window.HTMLCanvasElement.prototype.getContext = function () {
    if (!this.__ctx) { this.__ctx = stubContext(); this.__ctx.canvas = this; }
    return this.__ctx;
  };
  window.HTMLCanvasElement.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, width: 480, height: 720, right: 480, bottom: 720, x: 0, y: 0 };
  };

  const s = window.document.createElement('script');
  s.textContent = bundle;
  window.document.body.appendChild(s);
  return window;
}

/** 개입 구간에서 참가자 조작을 흉내낸다 — 캔버스 좌표 x 로 기체를 옮긴다 */
function movePointer(window, x) {
  window.dispatchEvent(new window.MouseEvent('mousemove', {
    clientX: x, clientY: 600, bubbles: true
  }));
}

const wait = ms => new Promise(r => setTimeout(r, ms));

function suite(name) {
  console.log('\n\x1b[1m' + name + '\x1b[0m');
  const state = { failed: 0 };
  return {
    ok(cond, label, extra) {
      const mark = cond ? '\x1b[32m  ✓\x1b[0m ' : '\x1b[31m  ✗\x1b[0m ';
      console.log(mark + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
      if (!cond) state.failed++;
    },
    info(label, extra) {
      console.log('\x1b[2m  ·\x1b[0m ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
    },
    section(t) { console.log('  \x1b[2m' + t + '\x1b[0m'); },
    get failed() { return state.failed; }
  };
}

module.exports = { APP_DIR, build, bootPage, movePointer, wait, suite };
