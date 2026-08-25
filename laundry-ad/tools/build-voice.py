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
#   tail   (자르는 지점 비율, 반음). 문장 끝만 따로 옮긴다. 자르는 자리는
#          그 근처에서 소리가 가장 작은 곳으로 잡아 말 도중에 안 이어 붙는다.
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
    1:  dict(rate=0.98, pitch=+0.2),                      # 도입 — 일상적
    2:  dict(rate=0.93, pitch=-0.4),                      # 무심하게, 조금 빠르게 (그 무심함이 실패의 씨앗)
    3:  dict(rate=1.06, pitch=-1.6),                      # 세탁 중 — 낮고 조용히
    4:  dict(rate=1.13, pitch=-3.0, tail=(0.72, -1.6)),   # 실패 — 가장 낮고 가장 느리게, 끝을 떨군다
    5:  dict(rate=1.02, pitch=+0.6, tail=(0.76, +5.0)),   # 물음 — '?'인데 piper 가 안 올려서 직접 올린다
    6:  dict(rate=1.04, pitch=+0.2),                      # 조작 안내 — 또렷하게
    7:  dict(rate=1.00, pitch=-0.3),                      # 설명조
    8:  dict(rate=0.95, pitch=+2.2, tail=(0.66, +1.2)),   # 해소 — 가장 밝고 가장 빠르게
    9:  dict(rate=1.02, pitch=+1.0),                      # 확신
    10: dict(rate=0.96, pitch=+0.6, tail=(0.70, +1.0)),   # 제품 메시지 — 앞으로 나오게
}

# 휴대폰 스피커에서 말이 앞에 서게 하는 사슬. 열세 개 전부 같은 값을 쓴다 —
# 장면마다 다르면 그것도 각성 차이가 된다.
#   95Hz 아래 컷    방 울림·숨소리 제거
#   330Hz -2.4dB   저중역 뭉침을 걷어낸다 (작은 스피커에서 특히 지저분하다)
#   3.1kHz +3.2dB  자음이 서는 대역 — '임팩트'는 대개 여기서 온다
#   압축 3:1       문장 안 기복을 줄여 작은 소리도 들리게
#   loudnorm       마지막에 -18 LUFS 로 정렬
POLISH = ('highpass=f=95,'
          'equalizer=f=330:t=q:w=1.1:g=-2.4,'
          'equalizer=f=3100:t=q:w=1.5:g=3.2,'
          'acompressor=threshold=-20dB:ratio=3:attack=6:release=140:makeup=2,'
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
    if abs(semitones) < 0.01: return data
    return pcm_filter(data, 'rubberband=pitch=%.6f' % (2 ** (semitones / 12)))


def tail_shift(data, frac, semitones):
    """문장 끝만 따로 옮긴다. 자르는 자리는 그 근처에서 가장 조용한 곳 —
       말 한가운데를 이어 붙이면 그 자리가 들린다."""
    import array, math
    x = array.array('f'); x.frombytes(data)
    n = len(x)
    w = int(SR * 0.02)
    lo, hi = max(w, int(n * (frac - 0.10))), min(n - w, int(n * (frac + 0.10)))
    if hi <= lo: return data
    step = w // 2
    best, best_e = lo, None
    for i in range(lo, hi, step):
        e = math.fsum(v * v for v in x[i:i + w])
        if best_e is None or e < best_e: best, best_e = i, e
    f = int(SR * 0.025)
    head = x[:best + f]
    tail = array.array('f'); tail.frombytes(pitch(x[best:].tobytes(), semitones))
    k = min(f, len(head), len(tail))
    if k <= 0: return data
    out = array.array('f', x[:best + f - k])
    for j in range(k):
        r = j / k
        out.append(head[len(head) - k + j] * (1 - r) + tail[j] * r)
    out.extend(tail[k:])
    return out.tobytes()


def encode(data, mp3):
    run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-',
         '-af', TRIM + ',' + POLISH, '-ac', '1', '-ar', str(SR), '-b:a', BITRATE, mp3],
        input=data, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def duration(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                          '-of', 'default=nw=1:nk=1', path], capture_output=True, text=True,
                         check=True).stdout
    return round(float(out.strip()), 2)


def main():
    if not Path(MODEL).exists():
        sys.exit('목소리 모델이 없다: %s\n  받는 법: tools/README-voice.md' % MODEL)
    clips, meta = {}, {}
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
            if pr.get('tail'):
                pcm[key] = tail_shift(pcm[key], pr['tail'][0], pr['tail'][1])

        # 3) 굽는다
        for key in CLIPS:
            pr = PROSODY[scene_of(key)]
            mp3 = os.path.join(tmp, key + '.mp3')
            encode(pcm[key], mp3)
            raw = Path(mp3).read_bytes()
            clips[key] = base64.b64encode(raw).decode('ascii')
            meta[key] = {'text': CLIPS[key][0], 'sec': duration(mp3), 'bytes': len(raw),
                         'rate': pr['rate'], 'pitch': pr['pitch']}
            print('  %-4s %5.2fs %6.1fKB  속도 %.2f · %+.1f반음%s  %s'
                  % (key, meta[key]['sec'], len(raw) / 1024, pr['rate'], pr['pitch'],
                     ' · 끝 %+.1f' % pr['tail'][1] if pr.get('tail') else '         ',
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


if __name__ == '__main__':
    main()
