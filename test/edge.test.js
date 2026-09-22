/* 가장자리 경로 — 미응답 · 선택 문항 · 철회 · 응답확인 오답 · 결측.
 * 정상 완주만 보면 이쪽은 통째로 안 지나간다. 실제 자료의 흠은 대부분 여기서 난다.
 */
'use strict';

const { bootRunner, startFlow, choose, countText, clickNext, suite } = require('./lib/harness');

module.exports = function () {
  const t = suite('가장자리 경로');

  /* ---------- 미응답이면 못 넘어간다 ---------- */
  t.section('미응답 차단 (lenient 끔)');
  {
    const w = bootRunner('group=3&sid=P004');
    const S = w.SURVEY;
    startFlow(w);
    w.state.step = w.state.flow.findIndex((f) => f.kind === 'pre');
    w.render();

    t.ok(!clickNext(w), '아무것도 안 고르면 다음으로 못 간다');
    t.ok(w.document.querySelectorAll('.item.miss').length === S.PRE.length,
      '빈 문항에 표시가 붙는다', w.document.querySelectorAll('.item.miss').length);

    S.PRE.slice(0, 2).forEach((it) => choose(w, 'pre', it.id, 2));
    t.ok(!clickNext(w), '하나라도 비면 여전히 막힌다');
    t.ok(countText(w) === '2 / 3 응답', '개수 표시가 2 / 3', countText(w));

    choose(w, 'pre', S.PRE[2].id, 2);
    t.ok(countText(w) === '모두 응답했습니다', '다 채우면 "모두 응답"', countText(w));
    t.ok(clickNext(w), '다 채우면 넘어간다');
  }

  /* ---------- 선택 문항은 비워도 넘어간다. 다만 분모에 안 들어간다 ---------- */
  t.section('선택 문항 (기본 정보의 서술형 소감)');
  {
    const w = bootRunner('group=3&sid=P004');
    const S = w.SURVEY;
    startFlow(w);
    w.state.step = w.state.flow.findIndex((f) => f.kind === 'demo');
    w.render();

    const required = S.DEMO.filter((it) => !it.optional).length;
    /* 분모를 화면의 문항 수(3)로 세면 선택 문항이 답한 것으로 잡혀
     * 아무것도 안 고른 화면이 "1 / 3 응답" 으로 시작한다 — 실제로 그랬다. */
    t.ok(countText(w) === '0 / ' + required + ' 응답',
      '아무것도 안 고르면 0 / ' + required, countText(w));

    choose(w, 'demo', '기본_연령대', 1);
    t.ok(countText(w) === '1 / ' + required + ' 응답', '하나 고르면 1 / ' + required, countText(w));
    t.ok(!clickNext(w), '필수가 비면 못 넘어간다');

    choose(w, 'demo', '기본_성별', 1);
    t.ok(countText(w) === '모두 응답했습니다', '필수를 다 채우면 "모두 응답"', countText(w));

    const at = w.state.step;
    t.ok(clickNext(w) && w.state.step === at + 1, '서술형을 비운 채 넘어간다');
    t.ok(w.state.resp.demo['기본_소감'] === null,
      '안 쓴 서술형은 빈 문자열이 아니라 공란(null)', w.state.resp.demo['기본_소감']);
  }

  /* ---------- 자료 사용 거절 ---------- */
  t.section('디브리핑에서 자료 사용을 거절하면');
  {
    const w = bootRunner('group=3&sid=P004&lenient=1');
    const S = w.SURVEY;
    startFlow(w);
    w.state.step = w.state.flow.findIndex((f) => f.kind === 'debrief');
    w.render();

    t.ok(!clickNext(w), 'lenient 여도 이 문항만은 못 건너뛴다');

    choose(w, 'debrief', S.DEBRIEF_WITHDRAW.id, S.WITHDRAW_VALUE);
    clickNext(w);
    t.ok(w.withdrew() === true, '철회로 판정된다');

    const b = w.withdrawnBundle();
    const r = w.withdrawnRow()[0];
    t.ok(!b.pre && !b.blocks && !b.demo && b.withdrawn === 1,
      '철회 묶음에 응답이 안 들어간다', Object.keys(b));
    /* 그래도 한 줄은 남긴다 — 몇 명이 왔고 몇 명이 빠졌는지는 논문에 적어야 한다 */
    t.ok(r['자료사용거절'] === 1 && !!r.sid && !('기본_연령대' in r),
      '탈락자 수를 셀 최소한만 남는다', Object.keys(r));
  }

  /* ---------- 응답확인 오답 ---------- */
  t.section('응답확인을 틀리면');
  {
    const w = bootRunner('group=3&sid=P004&lenient=1');
    const S = w.SURVEY;
    startFlow(w);
    const i = w.state.flow.findIndex((f) => f.kind === 'survey' && f.attention);
    w.state.step = i;
    w.render();

    const st = w.state.flow[i];
    const scope = w.blockKey(st.b) + '_' + st.page.key;
    const wrong = S.ATTENTION.expect === 2 ? 5 : 2;
    t.ok(choose(w, scope, S.ATTENTION.id, wrong), '응답확인 문항이 그 쪽에 붙어 있다');
    clickNext(w);

    const n = st.b.block;
    const row = w.flatRow()[0];
    t.ok(w.state.resp.attention['b' + n] === wrong, '오답이 그대로 기록된다', w.state.resp.attention['b' + n]);
    t.ok(row['응답확인_광고' + n + '_통과'] === 0, '통과 = 0 으로 표시된다', row['응답확인_광고' + n + '_통과']);
    t.ok(!((w.blockKey(st.b) + '_' + S.ATTENTION.id) in row), '29문항 칸에 안 섞인다');
  }

  /* ---------- 결측 ---------- */
  t.section('결측은 0 이 아니다');
  {
    const w = bootRunner('group=3&sid=P004&lenient=1');
    const S = w.SURVEY;
    t.ok(S.subscaleMean('유능감', { 유능감1: 5, 유능감2: 6 }) === null,
      '한 문항이라도 비면 하위척도 평균은 null', S.subscaleMean('유능감', { 유능감1: 5, 유능감2: 6 }));
    t.ok(S.subscaleMean('유능감', { 유능감1: 5, 유능감2: 6, 유능감3: 7 }) === 6,
      '다 차면 평균이 나온다');
    t.ok(w.toCsv([{ a: null, b: 0 }]).split('\n')[1] === ',0',
      'CSV 에서 공란은 빈칸, 0 은 0', w.toCsv([{ a: null, b: 0 }]).split('\n')[1]);
  }

  return t.failed;
};

if (require.main === module) process.exit(module.exports() ? 1 : 0);
