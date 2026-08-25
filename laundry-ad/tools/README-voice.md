# 나래이션 다시 굽기

장면 자막을 고쳤으면 목소리도 다시 구워야 한다. 안 그러면 참가자가 **자막과 다른 말을
듣는다** — `npm test voice` 가 이 어긋남을 잡지만, 고치는 것은 여기서 한다.

## 1. 도구

```bash
pip install piper-tts          # 신경망 TTS (onnxruntime 포함)
# ffmpeg 는 이미 있어야 한다 (자르기 · 음량 맞추기 · mp3)
```

## 2. 목소리 모델 (63MB · 저장소에 넣지 않는다)

```bash
mkdir -p ~/.cache/piper
B=https://huggingface.co/rhasspy/piper-voices/resolve/main/ko/ko_KR/kss/medium
curl -L -o ~/.cache/piper/ko.onnx      "$B/ko_KR-kss-medium.onnx"
curl -L -o ~/.cache/piper/ko.onnx.json "$B/ko_KR-kss-medium.onnx.json"
```

다른 곳에 두었으면 `VOICE_MODEL=/경로/ko.onnx` 로 넘긴다.

**라이선스**: 이 목소리는 KSS(Korean Single Speaker Speech Dataset)로 학습됐고
데이터셋이 **CC BY-NC-SA 4.0** 이다 — 비영리 연구에서만 쓴다. 이 자극은 가상 브랜드를
쓰는 학술 실험이라 조건에 맞는다. 상업적 용도로 돌리려면 목소리를 바꿔야 한다.

## 3. 굽기

```bash
cd laundry-ad
python3 tools/build-voice.py     # voice-clips.js 를 새로 쓴다
npm test voice                   # 자막과 같은 말을 하는지 대조
```

`voice-clips.js` 는 **생성물이지만 저장소에 커밋한다.** 배포되는 파일이고, 모델은
저장소에 없어서 배포 환경에서 다시 구울 수 없기 때문이다.

## 4. 말투 고치기

장면마다 말 속도·높이·끝맺음이 다르고, 전부 `build-voice.py` 의 `PROSODY` 한 곳에 있다.
표를 고치고 다시 구우면 된다. 지켜야 할 것:

- **음량으로 강조하지 않는다.** 열세 개 전부 -18 LUFS 다. 한 장면만 키우면 그 장면에서만
  각성이 올라가고, 5~9 는 개입 조건만 보는 구간이라 그게 조건 간 비대칭이 된다.
- **공통 장면(1·2·3·4·10)의 높이 폭이 개입 전용 구간(5~9)보다 넓어야 한다.** 같은 이유다.
- **ver·mode 로 갈리는 짝**(s1A·s1B / s4A·s4B / s6i·s6w)은 **같은 값**을 받아야 한다.
  장면 번호로 표를 찾으므로 저절로 그렇게 되지만, 예외를 만들지 말 것.

셋 다 `npm test voice` 가 검사한다.

## 5. 사람 목소리로 바꾸려면

합성 목소리가 광고 태도 점수에 영향을 준다고 판단되면 사람이 읽은 것으로 바꾼다.
`tools/build-voice.py` 의 `synth()` 를 녹음 파일을 읽는 것으로 바꾸면 나머지(잘라내기 ·
음량 맞추기 · mp3 · base64 · 검사)는 그대로 쓸 수 있다. **문장은 CLIPS 표 그대로 읽어야
한다** — 자막과 다르면 검사가 막는다.
