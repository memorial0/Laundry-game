#!/usr/bin/env node
/* 스토리보드 추출 (테스트 아님 · IRB 별첨용)
 *   node test/storyboard.js [A|B|all] [--mode=intervene|watch]
 * test/out/<ver>/scene-N.png 과 한 장짜리 contact.png 를 만든다.
 *
 * 참가자가 보는 그대로를 찍는다 — 실제 브라우저에 index.html 을 ?still=N 으로
 * 띄우고 화면을 캡처한다. 예전에는 ART 모듈만 불러 SVG 를 만들고 cairosvg 로
 * 굽었는데, 그 그림은 참가자 화면과 세 군데가 달랐다:
 *
 *   ① 한글이 전부 □ 로 나왔다 — SVG <text> 에 font-family 가 없어 cairosvg 가
 *      한글 없는 기본 폰트로 떨어졌다. 자막도 카피도 못 읽는 스토리보드였다.
 *   ② HTML 오버레이가 통째로 빠졌다 — 팩샷의 구매 버튼, 닫기 [×], 하단 자막은
 *      SVG 밖이라 한 장도 안 찍혔다. 팩샷 아래쪽이 비어 보였던 이유다.
 *   ③ 필터가 무시됐다 — 이염 얼룩의 블러가 안 걸려 부드럽게 번지는 자국이
 *      테두리 선명한 타원 여러 개로 나왔다. 실제보다 훨씬 도형처럼 보였다.
 *
 * 이 그림으로 광고를 판단하면 없는 문제를 고치고 있는 문제를 놓친다. 그래서
 * 렌더러를 브라우저로 바꿨다. 애니메이션은 여전히 정지 상태로 찍힌다(?still 의
 * 뜻이 그렇다) — 움직임은 이 도구가 아니라 실제 재생으로 본다.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync, execFile } = require('child_process');

const APP_DIR = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const SCENES = [1, 2, 3, 4, 11, 5, 6, 7, 8, 9, 10];  // 재생 순서 (11 은 4 뒤)
const W = 540, H = 960;          // 9:16 — 예전 출력과 같은 크기
const COLS = 6;                  // 컨택트시트 6 × 2 (장면 11 장, 마지막 칸은 빈다)

/* ---------------------------------------------------------------
 * 브라우저 찾기
 * ------------------------------------------------------------- */

/** 설치된 크로미움 계열 실행 파일. 없으면 null. */
function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  // playwright 가 받아 둔 것 (이 저장소의 코드스페이스에 이미 있다)
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(cache)) {
    for (const d of fs.readdirSync(cache).filter((n) => n.startsWith('chromium-')).sort().reverse()) {
      for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const p = path.join(cache, d, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    try { return execFileSync('command', ['-v', name], { shell: '/bin/bash', encoding: 'utf8' }).trim(); }
    catch (e) { /* 다음 후보 */ }
  }
  return null;
}

/* ---------------------------------------------------------------
 * 자극을 실제 주소로 띄운다 (file:// 이 아니라 참가자와 같은 http)
 * ------------------------------------------------------------- */

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

/** APP_DIR(+extra) 을 서비스하는 임시 서버. { port, close() } 를 준다. */
function serve(extraDirs) {
  const roots = [APP_DIR].concat(extraDirs || []);
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    for (const root of roots) {
      const f = path.join(root, rel);
      // 루트 밖으로 나가는 경로는 막는다
      if (!f.startsWith(root + path.sep) && f !== path.join(root, rel)) continue;
      if (fs.existsSync(f) && fs.statSync(f).isFile()) {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
        return fs.createReadStream(f).pipe(res);
      }
    }
    res.writeHead(404).end('not found');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      close: () => new Promise((r) => server.close(r))
    }));
  });
}

/* ---------------------------------------------------------------
 * 캡처
 * ------------------------------------------------------------- */

/** 한 주소를 찍는다.
 *
 * 반드시 비동기여야 한다. 자극을 띄우는 서버가 이 프로세스 안에서 돌기 때문에,
 * execFileSync 로 기다리면 이벤트 루프가 멈춰 서버가 index.html 을 못 내준다 —
 * 크롬은 페이지를 기다리고 서버는 크롬을 기다리는 교착이 된다.
 *
 * --user-data-dir 로 프로필을 따로 주지 않는다. 그래야 여러 장을 나란히 찍을 수
 * 있지만, 이 컨테이너에서는 **새 프로필이면 첫 실행 초기화에서 그대로 멈춘다**
 * (/tmp 든 홈 아래든, --no-first-run · --disable-background-networking ·
 * --disable-component-update 을 다 붙여도 마찬가지다). 기본 프로필은 멀쩡하므로
 * 프로필을 공유하고 대신 한 장씩 순서대로 찍는다 — 10장에 15초 남짓이다. */
function shoot(chrome, url, outFile, w, h) {
  return new Promise((resolve, reject) => {
    execFile(chrome, [
      '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--hide-scrollbars', '--force-device-scale-factor=1',
      '--window-size=' + w + ',' + h,
      // 폰트·CSS·SVG 가 다 자리를 잡은 뒤에 찍는다. 모자라면 글자가 빠진 채 찍힌다.
      '--virtual-time-budget=4000',
      '--screenshot=' + outFile,
      url
    ], { timeout: 60000 }, (err) => {
      if (err) return reject(new Error('캡처 실패 (' + url + '): ' + err.message.split('\n')[0]));
      if (!fs.existsSync(outFile)) return reject(new Error('캡처 실패 — 파일이 안 생김: ' + url));
      resolve(outFile);
    });
  });
}

async function render(chrome, port, ver, mode) {
  const dir = path.join(OUT, ver);
  fs.mkdirSync(dir, { recursive: true });

  const files = [];
  for (const n of SCENES) {
    const f = path.join(dir, 'scene-' + String(n).padStart(2, '0') + '.png');
    const url = 'http://127.0.0.1:' + port + '/index.html' +
      '?still=' + n + '&ver=' + ver + '&mode=' + mode + '&sound=0&sid=storyboard';
    await shoot(chrome, url, f, W, H);
    files.push(f);
  }

  // 컨택트시트도 같은 브라우저로 만든다 — PIL 을 따로 두지 않는다
  const sheet = path.join(dir, 'contact.html');
  fs.writeFileSync(sheet,
    '<!doctype html><meta charset="utf-8"><style>' +
    'html,body{margin:0;background:#fff}' +
    'div{display:grid;grid-template-columns:repeat(' + COLS + ',' + W + 'px);width:max-content}' +
    'img{display:block;width:' + W + 'px;height:' + H + 'px}' +
    '</style><div>' +
    files.map((f) => '<img src="' + path.basename(f) + '">').join('') +
    '</div>');
  await shoot(chrome, 'file://' + sheet, path.join(dir, 'contact.png'),
    W * COLS, H * Math.ceil(SCENES.length / COLS));
  fs.unlinkSync(sheet);

  return { dir, files };
}

/* ---------------------------------------------------------------
 * 실행
 * ------------------------------------------------------------- */

(async function main() {
  const args = process.argv.slice(2);
  const modeArg = (args.find((a) => a.startsWith('--mode=')) || '--mode=intervene').split('=')[1];
  const verArg = (args.find((a) => !a.startsWith('--')) || 'all').toUpperCase();

  if (modeArg !== 'intervene' && modeArg !== 'watch') {
    console.error('--mode 는 intervene 또는 watch 여야 합니다.');
    process.exit(2);
  }

  const chrome = findChrome();
  if (!chrome) {
    console.error('브라우저를 못 찾았습니다. 스토리보드는 참가자 화면 그대로를 찍어야 하므로');
    console.error('브라우저가 있어야 합니다:');
    console.error('  npx playwright install chromium      (또는 CHROME_PATH=/경로/chrome)');
    process.exit(3);
  }

  const { port, close } = await serve();
  try {
    for (const ver of (verArg === 'ALL' ? ['A', 'B'] : [verArg])) {
      const { dir, files } = await render(chrome, port, ver, modeArg);
      console.log('ver ' + ver + ' (' + modeArg + '): PNG ' + files.length + '장 + contact.png → ' +
        path.relative(process.cwd(), dir));
    }
  } finally {
    await close();
  }
})().catch((e) => {
  console.error(String(e.message || e).split('\n')[0]);
  process.exit(1);
});
