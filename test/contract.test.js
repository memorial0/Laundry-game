/* 러너와 설문의 판이 어긋나면 시작을 막는가.
 *
 * 왜 이 검사가 있나. renderItem 의 마지막 else 가 모르는 종류를 전부 받아 7점 척도로
 * 그리던 시절이 있었다. 서술형(type:'text') 분기가 생기기 전 러너에 지금 설문이 물리면
 * 기본 정보 마지막 자유 서술 문항이 1~7 눈금으로 그려졌고, 화면은 멀쩡해 보였다.
 * 참가자는 아무 숫자나 누르고, 소감 자리에 숫자가 든 것은 자료를 열기 전까지 모른다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { bootRunner, startFlow, suite, ROOT } = require('./lib/harness');

/* 서술형 분기가 생기기 전 러너. 이 판을 실제로 꺼내 와 지금 설문과 물려 본다. */
const OLD_RUNNER = '1f7ea54';

function tmpdir(name) {
  const d = path.join(ROOT, 'test', '.tmp-' + name);
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
  return d;
}

module.exports = function () {
  const t = suite('러너 ↔ 설문 계약');

  /* ---------- 정상 조합 ---------- */
  {
    const w = bootRunner('group=3&sid=P004');
    t.ok(!w.state.blocked, '지금 판끼리는 막히지 않는다');
    t.ok(w.unrenderable().length === 0, '러너가 모든 문항 종류를 그릴 줄 안다', w.SURVEY.TYPES_USED);
    t.ok(w.SURVEY.runnerMismatch() === null, '설문 쪽에서 봐도 어긋남이 없다');
  }

  /* ---------- 설문이 러너보다 앞선 경우 (러너가 모르는 종류) ---------- */
  t.section('설문에 러너가 모르는 종류가 들었을 때');
  {
    const dir = tmpdir('newsurvey');
    fs.copyFileSync(path.join(ROOT, 'preview.html'), path.join(dir, 'preview.html'));
    fs.copyFileSync(path.join(ROOT, 'practice.js'), path.join(dir, 'practice.js'));
    fs.writeFileSync(path.join(dir, 'survey.js'),
      fs.readFileSync(path.join(ROOT, 'survey.js'), 'utf8')
        .replace("{ id: '기본_소감', type: 'text'", "{ id: '기본_소감', type: 'slider'"));

    const w = bootRunner('group=3&sid=P004', { base: dir });
    t.ok(w.unrenderable().length === 1, '러너가 못 그리는 문항을 찾아낸다', w.unrenderable());
    t.ok(w.state.blocked === true, '시작을 막는 상태가 된다');
    const btn = w.document.getElementById('next');
    t.ok(btn && btn.disabled === true, '시작 버튼이 죽는다', btn && btn.textContent);

    /* 그 문항을 억지로 그려 봐도 눈금으로는 안 그린다 */
    startFlow(w);
    w.state.step = w.state.flow.findIndex((f) => f.kind === 'demo');
    w.render();
    const host = w.document.querySelector('[data-item="기본_소감"]');
    t.ok(host && host.querySelectorAll('input[type=radio]').length === 0,
      '모르는 종류를 7점 척도로 그리지 않는다',
      host && host.querySelectorAll('input[type=radio]').length);
    t.ok(host && !!host.querySelector('.broken'), '대신 눈에 띄게 고장 표시가 뜬다');
    fs.rmSync(dir, { recursive: true, force: true });
  }

  /* ---------- 러너가 설문보다 낡은 경우 (실제로 샌 쪽) ---------- */
  t.section('러너가 설문보다 낡았을 때 (' + OLD_RUNNER + ')');
  {
    let old = null;
    try {
      old = execFileSync('git', ['show', OLD_RUNNER + ':preview.html'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 8e6 });
    } catch (e) { /* 얕은 클론 등으로 그 판이 없을 수 있다 */ }

    if (!old) {
      t.note('옛 판을 못 꺼내 이 검사는 건너뛴다 (' + OLD_RUNNER + ')');
    } else {
      const dir = tmpdir('oldrunner');
      fs.writeFileSync(path.join(dir, 'preview.html'), old);
      fs.copyFileSync(path.join(ROOT, 'survey.js'), path.join(dir, 'survey.js'));
      fs.copyFileSync(path.join(ROOT, 'practice.js'), path.join(dir, 'practice.js'));

      t.ok(old.indexOf("item.type === 'text'") < 0, '그 판에는 서술형 분기가 없다 (사고의 전제)');

      const w = bootRunner('group=3&sid=P004', { base: dir });
      t.ok(w.SURVEY.runnerMismatch() !== null,
        '설문이 낡은 러너를 알아본다', w.SURVEY.runnerMismatch());

      /* survey.js 의 검사는 DOMContentLoaded 뒤에 돈다 — 한 박자 기다린다 */
      return new Promise((done) => {
        setTimeout(() => {
          const cover = w.document.getElementById('survey-mismatch');
          t.ok(!!cover, '경고 덮개가 붙는다');
          t.ok(cover && cover.textContent.indexOf('설문을 시작할 수 없습니다') >= 0,
            '시작할 수 없다고 알린다');
          /* 러너가 나중에 시작 화면을 다시 그려도 덮개는 남아야 한다 —
           * 안 그러면 자극 확인 fetch 가 언제 돌아오느냐에 따라 막히기도 안 막히기도 한다 */
          w.showStart(null);
          t.ok(!!w.document.getElementById('survey-mismatch'),
            '러너가 화면을 다시 그려도 덮개가 남는다');
          t.ok(w.document.documentElement.lastChild.id === 'survey-mismatch',
            '덮개가 맨 위에 있다', w.document.documentElement.lastChild.id);
          /* 덮개 밑의 버튼은 마우스로는 못 누르지만 Tab 으로 닿을 수 있다.
           * 눌러도 시작되지 않아야 한다 — 덮어 놓고 시작되는 것이 제일 나쁘다. */
          const at = w.state.step;
          const btn = w.document.getElementById('next');
          if (btn) btn.click();
          t.ok(w.state.step === at && !w.state.flow.length,
            '덮개 밑 버튼을 눌러도 시작되지 않는다', { step: w.state.step, flow: w.state.flow.length });
          fs.rmSync(dir, { recursive: true, force: true });
          done(t.failed);
        }, 30);
      });
    }
  }

  return t.failed;
};

if (require.main === module) {
  Promise.resolve(module.exports()).then((f) => process.exit(f ? 1 : 0));
}
