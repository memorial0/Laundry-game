# game — 마이크로게이트 실패-수정형 게임 광고 자극

`memorial0/game_setup`(내부 이름 `micro-rescue-experiment`)을 이 저장소로 흡수한 것이다.
가져온 시점의 원본 커밋: `11e85a98ae157d7dd52fb1687f0d25cbd3715669` ("package-lock.json 갱신").
이후 변경은 전부 이 저장소에서 관리하며, 원본 저장소로 되돌려 보내지 않는다.

## 실행

```bash
npm install
npm run dev     # vite dev 서버 (기본 4173, 점유 시 자동 증가)
npm run build   # dist/ 로 정적 빌드 — 통합 러너가 iframe으로 읽는 산출물
```

## 통합 과정에서 걷어낼 것

이 자극은 원래 **독립 실험 러너**였다. 통합 러너(`session.html`)가 참가자 ID·순서 배정·설문·
로그 내보내기를 전부 담당하므로, 여기서는 아래를 제거하거나 무력화한다.

- 참가자 ID 입력 화면 / 공통 안내 / 최종 설문 / 완료 화면 (`STAGES.INTRO`, `COMMON_INFO`, `FINAL_SURVEY`, `COMPLETION`)
- 세션별 설문 5문항 (`EMPTY_SURVEY`, `STAGES.SESSION_SURVEY`) — 통합 설문(`survey.js`)으로 대체
- CSV/JSON 내보내기 버튼

남길 것: 게임 자극 자체(캔버스·타임라인·되감기·개입)와 조건 파라미터, 종료 시 로그 postMessage.

## 알려진 미해결 사항

- 조건 이름이 세탁 자극과 다르다: 게임 `fail`/`rewind` ↔ 세탁 `watch`/`intervene`. 통합 로그에서는
  `watch`/`intervene`으로 통일한다.
- 평행 자극(A/B)이 없다. 두 세션 모두 `MAIN_TIMELINE` 하나를 쓴다. 같은 참가자가 시청·개입을
  모두 겪는 참가자내 설계이므로, 게이트/적 수·난이도·길이를 맞춘 두 번째 타임라인이 필요하다.
