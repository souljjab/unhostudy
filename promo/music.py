"""과제함 60초 광고용 배경음악 + 효과음 합성기.

외부 음원 없이 직접 합성하므로 저작권 걱정이 없습니다.
  python3 music.py <sfx.json> <out.wav> [duration]

sfx.json 은 render.mjs 가 index.html 의 큐 시트(window.SFX)에서 뽑아 줍니다.
음악 구조(120 BPM, 한 마디 2초)는 지침서 09장 구성표를 따릅니다:
  0–8초 음악 없음(훅의 낮은 베이스, 알림음) → 8초 박자 시작 → 34–36초 잠깐 비우기
  → 50–56초 절정 → 56초 마무리 화음.
"""
import json
import sys
import wave

import numpy as np
from scipy.signal import butter, sosfilt

SR = 48000
BPM = 120
BEAT = 60 / BPM          # 0.5 s
BAR = BEAT * 4           # 2.0 s
M0 = 8.0                 # music starts with the title
rng = np.random.default_rng(7)


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def lp(x, fc, order=2):
    return sosfilt(butter(order, min(fc, SR / 2 - 100) / (SR / 2), 'low', output='sos'), x)


def hp(x, fc, order=2):
    return sosfilt(butter(order, fc / (SR / 2), 'high', output='sos'), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo / (SR / 2), hi / (SR / 2)], 'band', output='sos'), x)


def tt(d):
    return np.arange(int(d * SR)) / SR


def saw(f, t):
    return 2 * ((f * t) % 1.0) - 1


def adsr(n, a=0.005, d=0.1, s=0.6, r=0.1, hold=None):
    """n samples; hold = seconds before release (defaults to n - r)."""
    t = np.arange(n) / SR
    total = n / SR
    hold = total - r if hold is None else hold
    e = np.where(t < a, t / max(a, 1e-6), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-6)))
    rel = np.clip((t - hold) / max(r, 1e-6), 0, 1)
    return e * (1 - rel)


class Mix:
    def __init__(self, dur):
        self.n = int((dur + 0.5) * SR)
        self.L = np.zeros(self.n)
        self.R = np.zeros(self.n)

    def add(self, t0, x, gain=1.0, pan=0.0):
        i = int(round(t0 * SR))
        if i >= self.n:
            return
        x = x[: self.n - i] * gain
        gl, gr = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        self.L[i:i + len(x)] += x * gl * 1.414
        self.R[i:i + len(x)] += x * gr * 1.414


# ---------------------------------------------------------------- instruments
def kick():
    t = tt(0.35)
    f = 45 + 110 * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / 0.16)
    click = hp(rng.standard_normal(len(t)), 2000) * np.exp(-t / 0.004) * 0.25
    return np.tanh(1.6 * (body + click))


def clap():
    t = tt(0.25)
    n = bp(rng.standard_normal(len(t)), 900, 4500)
    env = np.zeros(len(t))
    for o in (0, 0.011, 0.022):
        env += (t >= o) * np.exp(-np.clip(t - o, 0, None) / (0.012 if o < 0.02 else 0.09))
    return n * env * 0.5


def hat(open_=False):
    t = tt(0.18 if open_ else 0.05)
    return hp(rng.standard_normal(len(t)), 7000) * np.exp(-t / (0.06 if open_ else 0.012)) * 0.35


def crash():
    t = tt(2.2)
    n = hp(rng.standard_normal(len(t)), 4000)
    return n * np.exp(-t / 0.7) * 0.28


def pluck(m, d=0.22):
    t = tt(d + 0.25)
    f = mtof(m)
    x = 0.6 * np.sign(np.sin(2 * np.pi * f * t)) * 0.4 + 0.6 * saw(f * 1.003, t) * 0.5
    x = lp(x, 2600) * np.exp(-t / 0.11)
    return x * adsr(len(t), 0.002, 0.2, 1.0, 0.05)


def bass(m, d):
    t = tt(d)
    f = mtof(m)
    x = np.sin(2 * np.pi * f * t) + 0.35 * lp(saw(f, t), 700)
    return x * adsr(len(t), 0.004, 0.12, 0.7, 0.04)


def pad(notes, d, bright=1.0):
    t = tt(d + 0.6)
    x = np.zeros(len(t))
    for m in notes:
        f = mtof(m)
        for det in (-0.12, 0.0, 0.11):
            x += saw(f * 2 ** (det / 12), t + rng.random())
    x = lp(x / (3 * len(notes)), 1100 * bright, order=2)
    return x * adsr(len(t), 0.18, 0.4, 0.85, 0.5, hold=d)


def lead(m, d):
    t = tt(d + 0.3)
    f = mtof(m) * (1 + 0.004 * np.sin(2 * np.pi * 5.5 * t) * np.clip(t / 0.25, 0, 1))
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = 0.55 * np.sin(ph) + 0.3 * np.sign(np.sin(ph)) * 0.5 + 0.15 * np.sin(2 * ph)
    return lp(x, 3200) * adsr(len(t), 0.01, 0.15, 0.7, 0.18, hold=d)


def bell(f, d=1.4, g=1.0):
    t = tt(d)
    x = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / (d * k))
            for r, a, k in ((1, 1, .45), (2.0, .35, .25), (3.01, .18, .15), (4.16, .1, .08)))
    return x * np.clip(t / 0.003, 0, 1) * g


# ---------------------------------------------------------------- sound effects
def sfx(kind):
    if kind == 'tick':
        t = tt(0.03)
        return (np.sin(2 * np.pi * 2300 * t) * np.exp(-t / 0.005) + hp(rng.standard_normal(len(t)), 3000) * np.exp(-t / 0.002) * .3) * .35
    if kind == 'tok':  # 카드가 맞춰질 때 가벼운 "톡"
        t = tt(0.09)
        f = 700 + 500 * np.exp(-t / 0.012)
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.022) * .55
    if kind == 'boom':  # 훅의 낮은 베이스 한 번
        t = tt(2.2)
        f = 42 + 70 * np.exp(-t / 0.08)
        x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.7)
        x += 0.25 * lp(rng.standard_normal(len(t)), 200) * np.exp(-t / 0.15)
        return np.tanh(1.8 * x) * .5
    if kind == 'notif':  # 단체방 알림음
        f1 = rng.choice([1046.5, 1174.7, 1318.5, 1568.0])
        a = bell(f1, 0.5, .5)
        b = bell(f1 * rng.choice([1.25, 1.335, 1.5]), 0.6, .5)
        out = np.zeros(len(b) + int(.09 * SR))
        out[:len(a)] += a
        out[int(.09 * SR):] += b
        return out * .5
    if kind == 'riser':
        t = tt(1.0)
        n = rng.standard_normal(len(t))
        out = np.zeros_like(n)
        for i in range(10):  # stepped band sweep
            s, e = i * len(t) // 10, (i + 1) * len(t) // 10
            out[s:e] = bp(n, 300 + i * 500, 900 + i * 900)[s:e]
        sweep = np.sin(2 * np.pi * np.cumsum(200 + 900 * (t / t[-1]) ** 2) / SR) * .2
        return (out * .35 + sweep) * (t / t[-1]) ** 2
    if kind == 'swish':
        t = tt(0.3)
        n = bp(rng.standard_normal(len(t)), 1500, 6000)
        return n * np.sin(np.pi * t / t[-1]) ** 2 * .25
    if kind == 'fill':
        t = tt(0.8)
        f = 420 + 480 * (1 - np.exp(-t / 0.3))
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * t / t[-1]) * .18
    if kind == 'shutter':
        out = np.zeros(int(.2 * SR))
        for o, g in ((0, 1), (.07, .7)):
            t = tt(0.05)
            c = hp(rng.standard_normal(len(t)), 1800) * np.exp(-t / 0.008) * g
            i = int(o * SR)
            out[i:i + len(c)] += c
        return out * .6
    if kind == 'scan':
        t = tt(1.25)
        f = 300 + 900 * t / t[-1]
        x = np.sin(2 * np.pi * np.cumsum(f) / SR) * .12 + lp(rng.standard_normal(len(t)), 2500) * .05
        return x * np.sin(np.pi * t / t[-1])
    if kind == 'draw':
        t = tt(0.85)
        f = 500 + 300 * t / t[-1]
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * t / t[-1]) * .12
    if kind == 'chime':  # 업로드 완료 알림
        a, b = bell(1318.5, 1.0, .5), bell(1975.5, 1.4, .5)
        out = np.zeros(len(b) + int(.12 * SR))
        out[:len(a)] += a
        out[int(.12 * SR):] += b
        return out * .55
    if kind == 'click':
        t = tt(0.02)
        return (np.sin(2 * np.pi * 3200 * t) + hp(rng.standard_normal(len(t)), 2500) * .5) * np.exp(-t / 0.003) * .4
    if kind == 'ding':
        x = bell(1567.98, 1.6, .32)
        h = bell(3135.96, 0.8, .12)
        x[:len(h)] += h
        return x
    if kind == 'lock':
        t = tt(0.25)
        thump = np.sin(2 * np.pi * 170 * t) * np.exp(-t / 0.03)
        clk = hp(rng.standard_normal(len(t)), 3000) * np.exp(-np.clip(t - .035, 0, None) / 0.006) * (t > .035) * .6
        return (thump + clk) * .55
    if kind == 'end':
        return sum(bell(f, 2.6, .25) for f in (1046.5, 1318.5, 1568.0, 1975.5))
    raise ValueError(kind)


# ---------------------------------------------------------------- arrangement
F, G, Em, Am, C = 'F', 'G', 'Em', 'Am', 'C'
CH = {  # pad voicing, bass root, arp tones
    F: ([53, 57, 60, 64], 41, [65, 69, 72, 76]),
    G: ([55, 59, 62, 64], 43, [67, 71, 74, 76]),
    Em: ([52, 55, 59, 62], 40, [64, 67, 71, 74]),
    Am: ([57, 60, 64, 67], 45, [69, 72, 76, 79]),
    C: ([48, 55, 59, 62, 64], 36, [72, 76, 79, 83]),
}


def chord_at(bar):
    """bar index from M0 (2 s each); returns list of (offset_beats, chord, beats)."""
    if bar == 23:  # 54–56: IV–V into the final C
        return [(0, F, 2), (2, G, 2)]
    return [(0, [F, G, Em, Am][bar % 4], 4)]


def build(sfx_cues, dur):
    mx = Mix(dur)
    end = 56.0
    nbars = int((end - M0) / BAR)

    def section(t):
        if t < 12: return 'intro'
        if 34 <= t < 36: return 'break'
        if 50 <= t < 56: return 'peak'
        return 'groove'

    kicks = []
    for b in range(nbars):
        bt = M0 + b * BAR
        for (ob, ch, nb) in chord_at(b):
            t0 = bt + ob * BEAT
            sec = section(t0)
            notes, root, arp = CH[ch]
            d = nb * BEAT
            bright = {'intro': .7, 'break': .55, 'groove': 1.0, 'peak': 1.5}[sec]
            mx.add(t0, pad(notes, d, bright), .32 if sec != 'break' else .4)
            if sec != 'break':
                for k in range(nb * 2):  # 8th-note bass, octave bounce
                    m = root + (12 if k % 2 else 0)
                    mx.add(t0 + k * BEAT / 2, bass(m, BEAT / 2 * .9), .27 if sec != 'intro' else .21)
            if sec in ('groove', 'peak', 'break'):
                pat = [0, 1, 2, 3, 2, 1, 2, 3]
                for k in range(nb * 4):  # 16th arp
                    tk = t0 + k * BEAT / 4
                    m = arp[pat[k % 8]] + (12 if sec == 'peak' and k % 4 == 3 else 0)
                    g = .15 if sec != 'break' else .10
                    mx.add(tk, pluck(m), g, pan=-.35 if k % 2 else .35)
                    mx.add(tk + .375, pluck(m), g * .35, pan=.35 if k % 2 else -.35)  # dotted-8th echo
        # drums
        for k in range(4):
            tb = bt + k * BEAT
            sec = section(tb)
            if sec == 'break':
                continue
            kicks.append(tb)
            mx.add(tb, kick(), .52)
            if sec in ('groove', 'peak') and k in (1, 3):
                mx.add(tb, clap(), .5)
            if sec != 'intro' or k >= 2:
                mx.add(tb + BEAT / 2, hat(sec == 'peak'), .5)
                if sec in ('groove', 'peak'):
                    mx.add(tb + BEAT / 4, hat(), .22)
                    mx.add(tb + 3 * BEAT / 4, hat(), .22)
    # build into the break return and the peak
    for i in range(8):
        mx.add(35.0 + i * BEAT / 4, clap(), .12 + i * .03)
    mx.add(12.0, crash(), .6)
    mx.add(36.0, crash(), .5)
    mx.add(50.0, crash(), .8)
    # peak hook melody (50–56), offsets/lengths in 8th notes
    mel = [(0, 76, 1), (1, 79, 1), (2, 81, 1.5), (3.5, 79, .5), (4, 79, 1), (5, 76, 1), (6, 74, 2),
           (8, 71, 1), (9, 74, 1), (10, 76, 1.5), (11.5, 74, .5), (12, 72, 1), (13, 74, 1), (14, 76, 1), (15, 74, 1),
           (16, 72, 1), (17, 74, 1), (18, 79, 2), (20, 77, 1), (21, 76, 1), (22, 74, 2)]
    for ob, m, nb in mel:
        mx.add(50.0 + ob * BEAT / 2, lead(m, nb * BEAT / 2 * .95), .24, pan=.1)
    # final chord at 56 with long ring-out
    notes, root, _ = CH[C]
    mx.add(end, pad(notes, 2.4, 1.3), .45)
    mx.add(end, bass(root, 2.6) * np.exp(-tt(2.6) / 1.2), .4)
    mx.add(end, kick(), .7)
    mx.add(end, crash(), .7)

    # sidechain: duck music under each kick
    duck = np.ones(mx.n)
    tail = np.exp(-np.arange(int(.22 * SR)) / SR / .09)
    for kt in kicks:
        i = int(kt * SR)
        seg = duck[i:i + len(tail)]
        seg *= 1 - .45 * tail[:len(seg)]
    mx.L *= duck
    mx.R *= duck
    # gentle fade at the very end
    t = np.arange(mx.n) / SR
    fade = np.clip((dur - t) / 1.6, 0, 1)
    mx.L *= fade
    mx.R *= fade

    # sound effects on top (not ducked)
    for c in sfx_cues:
        pan = float(rng.uniform(-.5, .5)) if c['k'] == 'notif' else 0.0
        mx.add(c['t'], sfx(c['k']), .9 * c.get('g', 1), pan)
    return mx


def main():
    cues = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    dur = float(sys.argv[3]) if len(sys.argv) > 3 else 60.0
    mx = build(cues, dur)
    st = np.stack([mx.L, mx.R], 1)[: int(dur * SR)]
    st = np.tanh(st * 1.1) / np.tanh(1.1)          # soft clip
    st *= 0.89 / max(1e-9, np.abs(st).max())        # peak at -1 dBFS
    pcm = (st * 32767).astype('<i2')
    with wave.open(out, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print('audio →', out)


if __name__ == '__main__':
    main()
