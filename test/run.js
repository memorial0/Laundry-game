#!/usr/bin/env node
/* 러너·설문 테스트 전체 실행:  npm test   (또는  node test/run.js [이름] )
 *
 * 자극 두 종에는 각자 테스트가 있다(laundry-ad/test · game/test). 여기 있는 것은
 * 그 둘을 이어 붙이는 러너와, 두 자극이 함께 쓰는 문항 은행(survey.js)을 본다.
 */
'use strict';

const SUITES = ['contract', 'render', 'response', 'edge'];

(async () => {
  const only = process.argv[2];
  const list = only ? SUITES.filter((s) => s.includes(only)) : SUITES;
  if (!list.length) {
    console.error('그런 테스트가 없습니다: ' + only + '  (있는 것: ' + SUITES.join(', ') + ')');
    process.exit(2);
  }

  const t0 = Date.now();
  let failed = 0;
  for (const name of list) {
    try {
      failed += await require('./' + name + '.test.js')();
    } catch (e) {
      console.log('\x1b[31m  ✗\x1b[0m ' + name + ' 실행 중 예외\n' + (e && e.stack));
      failed++;
    }
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(failed
    ? `\n\x1b[31m실패 ${failed}건\x1b[0m (${secs}s)`
    : `\n\x1b[32m전부 통과\x1b[0m (${secs}s)`);
  process.exit(failed ? 1 : 0);
})();
