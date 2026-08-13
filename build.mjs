/* 배포용 묶음 만들기 — 저장소 루트의 dist/ 하나에 러너와 자극 두 종을 모아 놓는다.
 * (game/dist/ 는 게임 자극의 빌드 결과고, 여기 dist/ 는 사이트 전체다. 둘은 다른 것이다.)
 *
 * 왜 저장소를 통째로 올리지 않나
 *   node_modules 와 test/ 가 같이 올라가고, 무엇보다 game/ 은 **빌드해야 돌아간다**.
 *   game/index.html 은 Vite 개발용 진입 파일이라 /src/main.jsx 를 부르는데, 브라우저는
 *   JSX 를 못 읽는다. 그대로 올리면 스크립트가 문법 오류로 죽고 흰 화면만 남는다.
 *   (실제로 그랬다 — 이 스크립트를 만든 이유다.)
 *
 * 참가자가 여는 주소는 '/' 다. preview.html 을 index.html 로도 복사해 두는 이유이고,
 * 예전 주소를 눌러도 되도록 preview.html 이라는 이름도 함께 남긴다.
 *
 * 경로는 preview.html 의 STIMS 와 1:1 이어야 한다 —
 *   laundry-ad/index.html · game/dist/index.html
 * 이 둘이 어긋나면 러너는 멀쩡히 뜨고 자극 자리만 비어 보인다. 아래 CHECK 가 그걸 막는다.
 */
import { cp, mkdir, rm, readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, 'dist');
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd: join(ROOT, cwd), stdio: 'inherit' });

/* 러너가 실제로 iframe 에 넣는 경로. 여기 없는 것이 하나라도 빠지면 배포를 멈춘다 */
const CHECK = ['index.html', 'preview.html', 'survey.js', 'practice.js',
               'laundry-ad/index.html', 'game/dist/index.html'];

await rm(OUT, { recursive: true, force: true });
await mkdir(join(OUT, 'laundry-ad'), { recursive: true });

/* 1. 게임 자극을 빌드한다. dist/ 는 .gitignore 에 있어서 저장소에 없다 —
 *    배포할 때마다 여기서 만든다. */
console.log('\n▸ 게임 자극 빌드');
run('npm', ['ci', '--no-audit', '--no-fund'], 'game');
run('npm', ['run', 'build'], 'game');

/* 2. 러너 — preview.html 이 '/' 로 열려야 하므로 index.html 로도 둔다 */
console.log('\n▸ 러너·설문 복사');
for (const f of ['preview.html', 'survey.js', 'practice.js']) {
  await cp(join(ROOT, f), join(OUT, f));
}
await cp(join(ROOT, 'preview.html'), join(OUT, 'index.html'));

/* 3. 자극 두 종. 세탁은 빌드가 필요 없다(순수 HTML/CSS/JS, 외부 요청 없음) */
console.log('▸ 자극 복사');
for (const f of ['index.html', 'scenes.js', 'style.css']) {
  await cp(join(ROOT, 'laundry-ad', f), join(OUT, 'laundry-ad', f));
}
await cp(join(ROOT, 'game', 'dist'), join(OUT, 'game', 'dist'), { recursive: true });

/* 4. 러너가 부르는 경로가 다 있는지 — 없으면 여기서 멈춘다.
 *    배포된 뒤에 자극 자리가 비어 있는 것을 발견하는 것보다 낫다. */
console.log('\n▸ 경로 점검');
const missing = [];
for (const p of CHECK) {
  try { await access(join(OUT, p)); console.log('  ✓ ' + p); }
  catch { missing.push(p); }
}
if (missing.length) {
  console.error('\n배포 중단 — 러너가 부르는 파일이 없다:\n  ' + missing.join('\n  '));
  process.exit(1);
}

/* 러너가 소스에 적어 둔 자극 경로와 실제로 만든 것이 같은지도 본다.
 * STIMS 를 고치고 이 스크립트를 안 고치면 여기서 걸린다. */
const html = await readFile(join(ROOT, 'preview.html'), 'utf8');
for (const [, p] of html.matchAll(/path:\s*'([^']+)'/g)) {
  if (!CHECK.includes(p)) {
    console.error('\n배포 중단 — preview.html 의 STIMS 가 가리키는 ' + p +
                  ' 를 이 스크립트가 안 만든다. build.mjs 의 CHECK 를 맞춰라.');
    process.exit(1);
  }
}

console.log('\ndist/ 준비 완료 — 참가자 주소는 /, 연구원 주소는 /?dev=1\n');
