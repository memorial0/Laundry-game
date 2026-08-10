/* 렌더 검사 — 10개 장면 × ver A/B의 SVG가 파싱 가능한 형식인지 */
'use strict';
const { JSDOM } = require('jsdom');
const { bootArt, suite } = require('./lib/harness');

const SCENES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const parser = new (new JSDOM().window.DOMParser)();

function parseError(svg) {
  const doc = parser.parseFromString(svg, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  return err ? err.textContent.trim().split('\n')[0] : null;
}

module.exports = async function () {
  const t = suite('SVG 렌더');

  for (const ver of ['A', 'B']) {
    t.section('ver ' + ver);
    const ART = bootArt(ver);
    for (const n of SCENES) {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920">' +
        ART.defs() + ART['s' + n]({ still: true }) + '</svg>';
      const err = parseError(svg);
      t.ok(!err, `장면 ${n} 파싱 (${svg.length.toLocaleString()}자)`, err || undefined);
    }
    // 참조하는 id가 defs에 실제로 있는지 (그라디언트·필터 오타 방지)
    const defs = ART.defs();
    const all = SCENES.map(n => ART['s' + n]({ still: true })).join('');
    const refs = [...new Set((all.match(/url\(#([\w-]+)\)/g) || []))];
    const missing = refs.filter(r => {
      const id = r.slice(5, -1);
      return !defs.includes('id="' + id + '"') && !all.includes('id="' + id + '"');
    });
    t.ok(missing.length === 0, `url(#…) 참조 ${refs.length}종 모두 정의됨`, missing.length ? missing : undefined);
  }

  return t.failed;
};
