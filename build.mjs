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
import { cp, mkdir, rm, readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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

/* 2. 러너 — preview.html 이 '/' 로 열려야 하므로 index.html 로도 둔다
 *
 *    나가기 전에 <script src="survey.js?v=dev"> 의 dev 를 **파일 내용의 해시**로 바꾼다.
 *    손으로 올리던 시절에는 v=4 가 2026-08-13 이후 한 번도 안 올라갔고 그동안 survey.js 는
 *    다섯 번 바뀌었다. 주소가 그대로면 브라우저는 옛 파일을 계속 쓸 수 있고, 그러면 러너와
 *    설문이 서로 다른 시점의 것으로 섞인다 — 자유 서술 문항이 7점 척도로 그려지던 그 사고다.
 *    해시로 박으면 내용이 바뀐 파일만 주소가 바뀌고, 안 바뀐 파일은 캐시가 그대로 산다. */
console.log('\n▸ 러너·설문 복사');
for (const f of ['survey.js', 'practice.js']) {
  await cp(join(ROOT, f), join(OUT, f));
}

const stamp = async (f) =>
  createHash('sha256').update(await readFile(join(ROOT, f))).digest('hex').slice(0, 12);

const vSurvey = await stamp('survey.js');
const vPractice = await stamp('practice.js');

let runner = await readFile(join(ROOT, 'preview.html'), 'utf8');

/* 파일마다 따로 센다. "하나라도 바뀌었으면 통과" 로 두면 안 된다 —
 * survey.js 쪽 표시만 없어진 경우 practice.js 가 대신 바뀌어 검사를 통과시키고,
 * 정작 survey.js 는 ?v= 없이 나간다. 그게 바로 이 검사가 막으려던 상태다. */
const stampedIn = [];
for (const [file, v] of [['survey.js', vSurvey], ['practice.js', vPractice]]) {
  const marker = file + '?v=dev';
  const hits = runner.split(marker).length - 1;
  if (hits !== 1) {
    console.error(`\n배포 중단 — preview.html 에서 ${marker} 를 ${hits} 번 찾았다 (1 번이어야 한다).\n` +
                  `  <script src="${marker}"> 형태를 유지하거나, 이 스크립트를 맞춰라.`);
    process.exit(1);
  }
  runner = runner.replace(marker, file + '?v=' + v);
  stampedIn.push(`${file}?v=${v}`);
}

/* 바꿔치기 뒤에 dev 표시가 남아 있으면 안 된다 */
if (/\.js\?v=dev/.test(runner)) {
  console.error('\n배포 중단 — 아직 ?v=dev 가 남아 있다:\n  ' +
                (runner.match(/[\w.-]+\.js\?v=dev/g) || []).join(' · '));
  process.exit(1);
}
console.log('  ' + stampedIn.join(' · '));

await writeFile(join(OUT, 'preview.html'), runner);
await writeFile(join(OUT, 'index.html'), runner);

/* 3. 자극 두 종. 세탁은 빌드가 필요 없다(순수 HTML/CSS/JS, 외부 요청 없음) */
console.log('▸ 자극 복사');
for (const f of ['index.html', 'sfx.js', 'voice-clips.js', 'voice.js', 'scenes.js', 'style.css']) {
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
