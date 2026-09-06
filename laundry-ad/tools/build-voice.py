#!/usr/bin/env python3
"""나래이션 클립 생성 — voice-clips.js 를 만든다 (생성물 · 손으로 고치지 않는다).

    python3 tools/build-voice.py            # 목소리 모델을 받아 두었으면 그대로 굽는다
    VOICE_MODEL=/경로/ko.onnx python3 tools/build-voice.py

받는 법·라이선스는 tools/README-voice.md.

왜 굽어서 심나
    브라우저 TTS(speechSynthesis)는 파일이 필요 없지만 기기마다 목소리가 다르고,
    한국어 음성이 없는 기기는 그 참가자만 무음이 된다. 참가자별로 자극이 갈리면
    실험 자극으로 못 쓴다. 그래서 여기서 한 번 구워 base64 로 심는다 —
    모든 참가자가 같은 소리를 듣고, 네트워크 요청은 여전히 0 이다.

읽는 문장
    자막을 글자 그대로 읽는다. 새 문구를 지어내지 않는 이유:
    정보량이 자막과 같아야 조건·버전 평행성이 자동으로 유지되고,
    SPEC 2장의 효과 표현 제한("줄여 준다"까지)을 새 문장이 넘을 일이 없다.
    test/voice.test.js 가 이 일치를 검사한다.
"""
import base64, json, os, subprocess, sys, tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'voice-clips.js'
MODEL = os.environ.get('VOICE_MODEL') or os.path.expanduser('~/.cache/piper/ko.onnx')
SR = 22050

# ── 문장 ────────────────────────────────────────────────────────────
# key: (자막 그대로, 읽을 때 쓰는 표기)
# 읽을 때 표기가 다른 것은 문장부호뿐이다 — '…' 는 소리로 옮길 수 없다.
CLIPS = {
    's1A': ('내일 입을 셔츠, 오늘 같이 빨래하기', None),
    's1B': ('내일 쓸 수건, 오늘 같이 빨래하기', None),
    's2':  ('그대로 세탁 시작', None),
    's3':  ('세탁 중…', '세탁 중.'),
    's4A': ('셔츠 색이 변해 버렸다', None),
    's4B': ('수건 색이 변해 버렸다', None),
    # 장면 11 은 장면 1("내일 입을 셔츠…")을 과거로 받는다. 받침 때문에 끝맺음이
    # 소재마다 다르다 — 셔츠였다 / 수건이었다. 구조는 같다.
    's11A': ('내일 입으려던 셔츠였다', None),
    's11B': ('내일 쓰려던 수건이었다', None),
    's5':  ('세탁을 시작하기 전에, 이 제품을 사용했다면?', None),
    's6i': ('시트를 세탁기 안으로 끌어다 놓아 주세요', None),
    's6w': ('시트를 세탁기 안으로 끌어다 놓기만 하면', None),
    's7':  ('떠다니는 염료를 시트가 붙잡아요', None),
    's8':  ('색은 그대로', None),
    's9':  ('시트 하나의 차이', None),
    's10': ('세탁 중 이염을 줄여 밝은 옷을 보호하세요', None),
}

# ── 장면마다 다른 성격 ──────────────────────────────────────────────
#
# 처음 구웠을 때는 열세 문장이 전부 같은 톤·같은 속도였다. 실측하니 F0 가 한
# 밴드(227~259Hz)에 몰려 있었고 **실패 장면이 해소 장면보다 높았다** —
# 가장 무거운 대사가 가장 밝게 들렸다는 뜻이다.
#
#   rate   말 속도(piper length_scale). 1보다 크면 느리다.
#   pitch  문장 전체를 옮기는 양(반음). rubberband 로 정확히 옮긴다 —
#          순음으로 검증했다(200Hz → +7반음 → 301.3Hz).
#
# **tail(문장 끝만 따로 올리고 내리던 값)은 걷어냈다 (2026-09-05).** 아래 참고.
#
# **목표 높이(예: "178Hz 로")를 적지 않고 이동량을 적는 이유.** 목표 방식은
# 구운 결과의 F0 를 재서 그만큼 당기는 것인데, 문장 안에서 F0 가 한 옥타브 넘게
# 움직이는 대사가 있어("셔츠 색이 변해 버렸다"는 167~302Hz) 그 "가운데 높이"라는
# 값 자체가 불안정하다. 실제로 자기상관과 조화곱 스펙트럼이 같은 클립을 208Hz 와
# 167Hz 로 달리 읽었고, 되먹임으로 맞추려 하자 1.83 → 0.92 → 1.69 → 1.25 반음으로
# 진동하며 수렴하지 않았다. **측정할 수 없는 것을 되먹임에 넣지 않는다** —
# 합성이 결정적이므로(아래 synth) 이동량만 고정하면 결과도 고정된다.
#
# 음량은 성격에 안 쓴다. 열세 개 전부 -18 LUFS 로 맞춘다 — 특정 장면만 크면
# 그 장면에서만 각성이 올라가고, 5~9 는 개입 조건만 보는 구간이라 그 차이가
# 조건 간 각성 비대칭이 된다(연출의 motion.test.js 규칙 D 와 같은 이유).
# 임팩트는 높낮이·속도·프레즌스에서 낸다.
#
# 공통 장면(1·2·3·4·10)의 폭이 개입 전용 구간(5~9)보다 넓어야 한다 —
# 공통 3.6반음 · 개입 전용 2.5반음. voice.test.js 가 실제로 건 값으로 검사한다.
PROSODY = {
    1:  dict(rate=0.98, pitch=+0.2),    # 도입 — 일상적
    2:  dict(rate=0.93, pitch=-0.4),    # 무심하게, 조금 빠르게 (그 무심함이 실패의 씨앗)
    3:  dict(rate=1.06, pitch=-1.6),    # 세탁 중 — 낮고 조용히
    4:  dict(rate=1.13, pitch=-3.0),    # 실패 — 가장 낮고 가장 느리게
    5:  dict(rate=1.02, pitch=+0.6),    # 물음 — 지금은 평서문처럼 끝난다(아래 열어 둔 문제)
    6:  dict(rate=1.04, pitch=+0.2),    # 조작 안내 — 또렷하게
    7:  dict(rate=1.00, pitch=-0.3),    # 설명조
    8:  dict(rate=0.95, pitch=+2.2),    # 해소 — 가장 밝고 가장 빠르게
    9:  dict(rate=1.02, pitch=+1.0),    # 확신
    10: dict(rate=0.96, pitch=+0.6),    # 제품 메시지 — 앞으로 나오게
    # 실패의 여운 — 장면 4 바로 뒤라 그 무게를 잇되 한 단 덜 무겁게. 장면 4 가
    # 가장 낮고 가장 느린 자리를 지켜야 하므로(voice.test.js) 그보다 높고 빠르다.
    11: dict(rate=1.10, pitch=-2.4),    # 여운 — 장면 4 보다 덜 무겁게
}

# ── 끝맺음 처리(tail)를 걷어냈다 — 2026-09-05 ───────────────────────
#
# 장면 4·5·8·10·11 은 **문장 끝 24~34% 를 잘라내 따로 피치를 옮기고 25ms 로
# 이어 붙이고** 있었다(옛 tail_shift). 가장 큰 것이 장면 5 의 +5.0반음이다.
#
# 이건 연기가 아니라 편집이다. 억양은 음절에 걸쳐 흐르는 것인데 이 방식은
# 한 지점에서 계단으로 뛴다 — "가공된 티"가 난다면 이 자리가 첫 번째 후보다.
# 나래이션이 광고처럼 안 들린다는 판단을 받고 **인공적인 처리부터 걷어냈다.**
#
# **장면 5 는 이것 때문에 물음이 아니게 됐다. 열어 둔 문제다.**
#
# 걷어내면서 "piper 가 물음표를 이미 받고 있다"고 판단했었다. 날것 합성에서
# 끝 피치를 재니 물음표 -0.6반음 · 마침표 -3.9반음이라, 마침표만 떨어지는 것으로
# 보였다. **그 측정이 틀렸다.** 에너지 문턱(0.012)이 압축 전 신호의 조용한 끝
# 프레임을 걸러내서, 실제로는 떨어지는 구간을 못 보고 있었다.
#
# 사슬을 통과시킨 뒤 다시 재면 둘이 같다:
#
#                        문턱 0.012        문턱 0.040
#     "…사용했다면?"    -3.6반음          -6.1반음
#     "…사용했다면."    -3.5반음          -4.7반음
#
# 즉 **piper 는 '?' 를 사실상 안 받는다** — 앞사람 주석이 맞았고 내가 틀렸다.
# 지금 장면 5 는 평서문처럼 떨어지며 끝난다. 이 광고의 전환점 대사인데 물음이
# 아니게 된 것이라, 연출로는 손해다.
#
# **되살린다면 잘라 붙이는 방식으로 가지 말 것.** 계단으로 뛰는 것이 애초에
# 걷어낸 이유다. 갈 만한 길 셋: ① 마지막 어절에 걸쳐 **점진적으로** 올리는 램프
# ② CLIPS 의 speech 필드로 espeak 가 올려 주는 표기를 찾는다(s3 의 '…' → '.' 와
# 같은 자리다) ③ 사람이 읽는다(README-voice.md §5).
#
# 걷어내도 클립 길이는 안 바뀐다(피치 이동은 길이를 보존한다). DUR 표 그대로다.

# 말이 앞에 서게 하는 사슬. 열세 개 전부 같은 값을 쓴다 — 장면마다 다르면
# 그것도 각성 차이가 되고, 5~9 는 개입 조건만 보는 구간이라 조건 간 비대칭이 된다.
#
# ── 왜 다시 짰나 (2026-09-05) ────────────────────────────────────────
# "진짜 광고처럼 안 들린다"는 판단으로 열세 클립을 재 봤다. 원인이 억양이 아니라
# **스펙트럼 균형**이었다.
#
#     150~450Hz(몸통)  62.8%   ← 에너지의 3분의 2가 여기 있었다
#     2~4.5kHz(프레즌스) 3.1%
#     스펙트럼 중심     647Hz
#
# 몸통 대 프레즌스가 **20:1** 이다. 방송 나래이션은 이 비가 3~5:1 이고 중심이
# 900~1400Hz 다. 즉 목소리가 유리 뒤에서 읽고 있었다 — 광고 보이스가 아니라
# 낭독이다. 예전 사슬도 이걸 고치려 하긴 했지만(330Hz -2.4 · 3.1k +3.2) 20:1
# 을 상대로 ±3dB 는 밀어내는 게 아니라 건드리는 정도다.
#
# 치찰음은 1.5% 로 **원래 낮았다.** 그래서 프레즌스를 세게 올려도 쏘지 않는다 —
# 이 목소리에서는 올릴 여유가 있었는데 안 쓰고 있었던 것이다.
# 크레스트는 12.8dB 로 오히려 넓었다(광고 보이스는 대개 8~11dB). 압축을 더 걸
# 여유도 있었다.
#
# ── 순서가 사슬의 절반이다 ──────────────────────────────────────────
# 깎는 EQ → 압축 → 올리는 EQ 순이다. 압축을 프레즌스 뒤에 두면 방금 올린 그
# 대역이 컴프레서를 때려 도로 눌린다. 예전 사슬이 그 순서였다.
#
#   92Hz 아래 컷       방 울림·숨소리. 95 → 92 (가슴 울림을 조금 남긴다)
#   460Hz 셸프 -6.8dB **벨이 아니라 셸프여야 한다.** 20:1 은 두 점을 파서 되는
#                     불균형이 아니다 — 몸통 전체를 덜어내야 중심이 움직인다
#   490Hz -2.8dB      박스 한 점 더. 여성 보이스의 진짜 머드는 330 이 아니라 400~500
#   압축 4:1          어택 15ms — 자음을 통과시킨 뒤 문다. 6ms 는 자음머리까지
#                     같이 눌러서 또렷함이 아니라 답답함을 만든다
#   1.95kHz +2.8dB    모음 2포먼트 — 말의 알맹이가 앞으로 나온다
#   3.5kHz +6.0dB     자음이 서는 대역
#   6kHz 셸프 +3.0dB  숨과 공기. 22.05kHz 라 11k 까지만 있다
#   deesser i=0.25    위를 올린 뒤에야 필요해진 것이다 — 아래 참고
#   loudnorm          마지막에 -18 LUFS. **여기가 통제 지점이다** — 프레즌스를
#                     올리면 K-가중 라우드니스가 같이 오르므로 정렬하면 광대역
#                     레벨은 오히려 내려간다. 즉 "크게" 만든 게 아니라 "앞으로"
#                     옮긴 것이고, 효과음·배경음과의 균형은 그대로다.
#
# ── 값은 재서 골랐다 ────────────────────────────────────────────────
# 후보를 걸어 보고 골랐다. 방송 나래이션의 자리는 **중심 900~1400Hz ·
# 몸통 40~50% · 프레즌스 10~15%** 다.
#
#     후보          crest  중심     몸통    프레즌스  치찰(평균/최악)
#     옛 사슬       12.8dB  603Hz  62.2%    3.1%   0.9%
#     A 약함        14.0    993   51.3%   10.2%   2.9%
#     AB            14.8   1262   45.9%   13.2%   5.1% / 10.0%
#   → AB+디에서     14.6   1108   47.6%   12.7%   3.3% /  6.6%
#     B 셀함        15.1   1330   41.7%   17.5%   4.5%
#     C 아주 셀함   16.2   1846   30.2%   28.5%   7.1%
#
# B 도 자리 안이지만 프레즌스 17.5% 는 작은 스피커에서 쏘기 시작하는 값이고,
# C 는 몸통이 30% 라 목소리가 얇아진다.
#
# **디에서는 두 번 판단이 뒤집혔다.** 처음 다섯 클립으로 잴 때는 치찰이 0.9% 라
# 걸 이유가 없었고, i=0.12 는 측정값이 소수점까지 그대로였다(아무 일도 안 하는
# 필터를 사슬에 두면 다음 사람이 그게 뭔가를 막고 있다고 믿는다). i=0.4 는
# 반대로 중심을 1262 → 768Hz 로 끌어내려 **방금 올린 대역을 도로 깎았다** —
# 그 값에서는 디에서가 아니라 고역 차단기다.
#
# 그런데 **열다섯 개 전부로 재니 이야기가 달라졌다.** 치찰이 센 대사가 다섯
# 클립 표본에 안 들어 있었다 — 'ㅅ'이 몰린 s2("그대로 세탁 시작") 10.9% ·
# s3("세탁 중") 10.6% · s9("시트 하나의 차이") 9.8% 다. 프레즌스를 올린 뒤에
# 생긴 문제이므로 i=0.25 로 그 셋만 눌렀다(최악 10.0 → 6.6%). 표본을 다섯으로
# 잡은 것이 실수였고, 사슬을 다시 만질 때는 **열다섯 개 전부로 잴 것.**
#
# crest 가 12.8 → 14.6dB 로 오히려 넓어진 것은 압축이 덜 걸려서가 아니라
# 프레즌스 트랜지언트가 서고 loudnorm 이 광대역을 내려서다. 압축을 5:1 로
# 올려 봐도 crest 는 14.8 로 거의 그대로였고 밝기만 더 올랐다 — 그래서 4:1 이다.
POLISH = ('highpass=f=92,'
          'lowshelf=f=460:g=-6.8,'
          'equalizer=f=490:t=q:w=1.1:g=-2.8,'
          'acompressor=threshold=-22dB:ratio=4:attack=15:release=90:makeup=3,'
          'equalizer=f=1950:t=q:w=1.0:g=2.8,'
          'equalizer=f=3500:t=q:w=1.0:g=6.0,'
          'highshelf=f=6000:g=3.0,'
          'deesser=i=0.25,'
          'loudnorm=I=-18:TP=-2.0:LRA=11')
TRIM = ('silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB,areverse,'
        'silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB,areverse')
BITRATE = '40k'


def scene_of(key):
    return int(key[1:].rstrip('ABiw'))


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, **kw)


def pcm_in(cmd, data):
    return subprocess.run(cmd, input=data, capture_output=True, check=True).stdout


def synth(text, rate, wav):
    """합성 난수를 끄고 굽는다.

    켜 두면 **같은 문장이 구울 때마다 다른 억양으로 나온다** — 실측으로 같은
    문장 세 번이 180.7 / 196.9 / 204.2Hz 였다(2.1반음 폭). 그래서 ver A 와 ver B
    처럼 낱말 하나만 다른 짝이 억양까지 갈렸다. 실제로 첫 판에서 장면 4가
    A 232Hz · B 182Hz 로 4반음 벌어져 있었다 — 이 광고의 전환점 대사인데
    버전마다 다른 무게로 들렸다는 뜻이다.

    끄면 세 번 다 같은 값이 나오고(198.6Hz) **표현력 손해도 없다** —
    높낮이 폭이 오히려 넓다(149.9Hz vs 128.9~145.7Hz). 자극은 대본에서
    똑같이 다시 나와야 하므로 끄는 쪽이 맞다."""
    run(['piper', '-m', MODEL, '--length-scale', str(rate),
         '--noise-scale', '0', '--noise-w-scale', '0', '-f', wav],
        input=text.encode('utf-8'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)




def to_pcm(path, af=None):
    cmd = ['ffmpeg', '-v', 'error', '-i', path]
    if af: cmd += ['-af', af]
    return subprocess.run(cmd + ['-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'],
                          capture_output=True, check=True).stdout


def pcm_filter(data, af):
    return pcm_in(['ffmpeg', '-v', 'error', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-',
                   '-af', af, '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-'], data)


def pitch(data, semitones):
    """문장 전체를 옮긴다.

    **formant=preserved 가 중요하다.** rubberband 의 기본값은 formant=shifted 라
    포먼트가 피치를 따라 같이 끌려간다 — 성도의 길이가 바뀌는 것과 같아서, 내리면
    화자가 커지고 올리면 작아진다. 장면 4 는 -3.0반음, 장면 8 은 +2.2반음이라
    **같은 사람이 장면마다 다른 몸집으로 들렸다.** 말투를 갈라 놓으려던 값이
    화자를 갈라 놓고 있었던 셈이다. 걷어낸 tail 과 같은 종류의 인공적인 처리다.

    pitchq=quality 도 같이 켠다. 기본값 speed 는 실시간용 근사라 자음에 위상
    번짐이 남는다 — 여기서는 미리 굽는 것이라 빠를 이유가 없다.

    이동량 자체는 순음으로 검증했다(200Hz → +7반음 → 301.3Hz)."""
    if abs(semitones) < 0.01: return data
    return pcm_filter(data, 'rubberband=pitch=%.6f:formant=preserved:pitchq=quality'
                      % (2 ** (semitones / 12)))


def encode(data, mp3):
    run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-',
         '-af', TRIM + ',' + POLISH, '-ac', '1', '-ar', str(SR), '-b:a', BITRATE, mp3],
        input=data, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def duration(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                          '-of', 'default=nw=1:nk=1', path], capture_output=True, text=True,
                         check=True).stdout
    return round(float(out.strip()), 2)


# 재생 순서(개입형). --wav 가 한 장으로 이을 때 쓴다.
WAV_ORDER = ['s1A', 's2', 's3', 's4A', 's11A', 's5', 's6i', 's7', 's8', 's9', 's10']
WAV_GAP = 0.55          # 클립 사이 (초) — 장면 길이가 아니라 귀로 듣기 좋은 간격이다
WAV_DIR = ROOT / 'test' / 'out' / 'voice'


def dump_wavs(mp3_by_key):
    """--wav — 구운 클립을 들어 볼 수 있게 WAV 로 뽑는다.

    **마지막 판단은 귀다.** 위의 사슬은 스펙트럼으로 골랐지만 스펙트럼이 광고
    보이스를 보장하지는 않는다. 배경음에 `npm run bed -- --wav` 가 있는 것과
    같은 이유이고, 같은 자리에서 쓰는 도구다.

    한 장짜리 voice-all.wav 를 같이 만든다 — 열한 문장을 재생 순서로 이어
    들어야 **광고 한 편의 읽기**로 들리는지가 판단된다. 낱개로는 안 보인다.
    """
    WAV_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for key, raw in mp3_by_key.items():
            src = os.path.join(tmp, key + '.mp3')
            Path(src).write_bytes(raw)
            run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-ar', str(SR), '-ac', '1',
                 str(WAV_DIR / (key + '.wav'))])
        sil = os.path.join(tmp, 'gap.wav')
        run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi',
             '-i', 'anullsrc=r=%d:cl=mono' % SR, '-t', str(WAV_GAP), sil])
        lst = os.path.join(tmp, 'list.txt')
        lines = []
        for key in WAV_ORDER:
            lines += ["file '%s'" % (WAV_DIR / (key + '.wav')), "file '%s'" % sil]
        Path(lst).write_text('\n'.join(lines))
        run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst,
             '-ar', str(SR), '-ac', '1', str(WAV_DIR / 'voice-all.wav')])
    print('\nWAV → %s  (낱개 %d개 + voice-all.wav)'
          % (WAV_DIR.relative_to(ROOT), len(mp3_by_key)))


def main():
    if not Path(MODEL).exists():
        sys.exit('목소리 모델이 없다: %s\n  받는 법: tools/README-voice.md' % MODEL)
    clips, meta, mp3raw = {}, {}, {}
    with tempfile.TemporaryDirectory() as tmp:
        # 1) 성격을 입혀 만든다
        pcm = {}
        for key, (text, speech) in CLIPS.items():
            pr = PROSODY[scene_of(key)]
            wav = os.path.join(tmp, key + '.wav')
            synth(speech or text, pr['rate'], wav)
            pcm[key] = to_pcm(wav)      # 높이는 아래에서 목표까지 당긴다

        # 2) 성격을 입힌다 — 이동량이 표에 있으므로 재지 않는다
        for key in CLIPS:
            pr = PROSODY[scene_of(key)]
            pcm[key] = pitch(pcm[key], pr['pitch'])

        # 3) 굽는다
        for key in CLIPS:
            pr = PROSODY[scene_of(key)]
            mp3 = os.path.join(tmp, key + '.mp3')
            encode(pcm[key], mp3)
            raw = Path(mp3).read_bytes()
            mp3raw[key] = raw
            clips[key] = base64.b64encode(raw).decode('ascii')
            meta[key] = {'text': CLIPS[key][0], 'sec': duration(mp3), 'bytes': len(raw),
                         'rate': pr['rate'], 'pitch': pr['pitch']}
            print('  %-4s %5.2fs %6.1fKB  속도 %.2f · %+.1f반음  %s'
                  % (key, meta[key]['sec'], len(raw) / 1024, pr['rate'], pr['pitch'],
                     CLIPS[key][0]))

    total = sum(m['bytes'] for m in meta.values())
    j = lambda d: json.dumps(d, ensure_ascii=False, indent=2).replace('\n', '\n  ')
    body = [
        '/* 생성물 — tools/build-voice.py 가 만든다. 손으로 고치지 않는다.',
        ' *',
        ' * 나래이션 클립. 자막을 그대로 읽은 것이고, base64 로 심어서 네트워크 요청이 없다',
        ' * (SPEC 1장 오프라인 요건). 재생·잠금·끄기는 voice.js 가 맡는다.',
        ' *',
        ' * 장면마다 말 속도·높이가 다르다 — 표와 이유는 build-voice.py 의 PROSODY.',
        ' * 음량은 열세 개가 전부 같다(-18 LUFS). 임팩트는 높낮이에서 내지 크기로 내지 않는다.',
        ' *',
        ' * 목소리: piper ko_KR-kss-medium (KSS 데이터셋 · CC BY-NC-SA 4.0 · 비영리 연구용).',
        ' * 합계 %.0fKB / %d개.' % (total / 1024, len(clips)),
        ' */',
        "'use strict';",
        'window.AD_VOICE_CLIPS = {',
        '  /** 장면별 문장 — voice.test.js 가 자막과 글자 단위로 대조한다 */',
        '  text: ' + j({k: v['text'] for k, v in meta.items()}) + ',',
        '  /** 재생 길이(초) — 장면 길이 안에 들어가는지 검사한다 */',
        '  sec: ' + j({k: v['sec'] for k, v in meta.items()}) + ',',
        '  /** 장면마다 실제로 건 말 속도와 높이(반음). 잰 값이 아니라 건 값이다 —',
        '   *  voice.test.js 가 이 값으로 (a) ver·mode 로 갈리는 짝이 같은 처리를 받았는지',
        '   *  (b) 공통 장면의 폭이 개입 전용 구간보다 넓은지를 검사한다. */',
        '  rate: ' + j({k: v['rate'] for k, v in meta.items()}) + ',',
        '  pitch: ' + j({k: v['pitch'] for k, v in meta.items()}) + ',',
        '  /** mp3 · mono · 22.05kHz · %s */' % BITRATE,
        '  mp3: {',
    ]
    for k, b64 in clips.items():
        body.append("    %s: '%s'," % (k, b64))
    body += ['  }', '};', '']
    OUT.write_text('\n'.join(body), encoding='utf-8')
    print('\n%s  (%.0fKB)' % (OUT.name, OUT.stat().st_size / 1024))

    if '--wav' in sys.argv:
        dump_wavs(mp3raw)


if __name__ == '__main__':
    main()
