#!/usr/bin/env node
/* 스토리보드 추출 (테스트 아님 · IRB 별첨용)
 *   node test/storyboard.js [A|B|all]
 * test/out/<ver>/scene-N.svg 를 만들고, python3 + cairosvg가 있으면 PNG와
 * 한 장짜리 컨택트시트(contact.png)까지 만든다.
 *
 * 브라우저에서 뽑고 싶으면 ?still=N 을 쓰면 된다. 이 스크립트는 CI·헤드리스
 * 환경에서 구도만 빠르게 확인하려고 만든 것이라 CSS 애니메이션은 반영되지
 * 않는다(정지 상태로 그린다).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { bootArt } = require('./lib/harness');

const OUT = path.join(__dirname, 'out');
const SCENES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function render(ver) {
  const ART = bootArt(ver);
  const dir = path.join(OUT, ver);
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (const n of SCENES) {
    let body = ART['s' + n]({ still: true });
    if (n === 6) {
      // 장면 6은 위치를 CSS가 잡는다 → 정지 렌더용으로 좌표를 박아 넣는다
      body = body
        /* 좌표를 박아 두면 ART.S6.HOME 을 옮길 때 스토리보드만 옛 자리로 남는다 */
        .replace(/style="transform:translate\((-?[\d.]+)px,(-?[\d.]+)px\)"/, 'transform="translate($1,$2)"')
        .replace('<g class="s6-hand">', '<g class="s6-hand" transform="translate(310,1600)">')
        .replace('<g class="s6-grip">', '<g class="s6-grip" transform="translate(340,1570)">');
    }
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width="1080" height="1920">' +
      ART.defs() + body + '</svg>';
    const f = path.join(dir, 'scene-' + String(n).padStart(2, '0') + '.svg');
    fs.writeFileSync(f, svg);
    files.push(f);
  }
  return { dir, files };
}

function toPng(dir) {
  const py = `
import glob, os, sys
try:
    import cairosvg
except ImportError:
    sys.exit(3)
files = sorted(glob.glob(os.path.join(${JSON.stringify(dir)}, 'scene-*.svg')))
pngs = []
for f in files:
    p = f[:-4] + '.png'
    cairosvg.svg2png(url=f, write_to=p, output_width=540, output_height=960)
    pngs.append(p)
try:
    from PIL import Image
except ImportError:
    sys.exit(0)
ims = [Image.open(p).convert('RGB') for p in pngs]
w, h = ims[0].size
sheet = Image.new('RGB', (w * 5, h * 2), 'white')
for i, im in enumerate(ims):
    sheet.paste(im, ((i % 5) * w, (i // 5) * h))
sheet.save(os.path.join(${JSON.stringify(dir)}, 'contact.png'))
`;
  try {
    execFileSync('python3', ['-c', py], { stdio: 'pipe' });
    return true;
  } catch (e) {
    if (e.status === 3) console.log('  (PNG 생략 — pip install cairosvg 하면 PNG까지 만듭니다)');
    else console.log('  (PNG 생략 — ' + String(e.message).split('\n')[0] + ')');
    return false;
  }
}

const arg = (process.argv[2] || 'all').toUpperCase();
const vers = arg === 'ALL' ? ['A', 'B'] : [arg];
for (const ver of vers) {
  const { dir, files } = render(ver);
  console.log('ver ' + ver + ': SVG ' + files.length + '장 → ' + path.relative(process.cwd(), dir));
  if (toPng(dir)) console.log('  PNG + contact.png 생성');
}
