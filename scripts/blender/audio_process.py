"""Cuts raw recordings into game-ready sounds (run by scripts/audio/process.mjs).

Uses Blender's audio module (aud, with ffmpeg inside) and numpy – no extra tools needed.
  blender -b --factory-startup --python scripts/blender/audio_process.py -- job.json result.json

job.json: { "out": "public/audio", "slots": { "<slot>": { "spec": {...}, "inputs": ["path", ...] } } }
One-shots: onsets are detected in the loudness envelope, every event becomes a candidate cut,
the loudest cuts (spread over the input files) are kept, faded and peak-normalised.
Loops: the steadiest window of the recording is taken and its end cross-faded into its start,
so it repeats without a click; normalised to the same RMS level.
Output: Opus in Ogg, 48 kHz.
"""
import json
import os
import sys

import aud
import numpy as np

SR = 48000
HOP = 480  # 10 ms


def load(path, stereo):
    d = aud.Sound(path).resample(SR, 3).data().astype(np.float32)
    if d.ndim == 1:
        d = d[:, None]
    if stereo and d.shape[1] >= 2:
        d = d[:, :2]
    else:
        d = d.mean(axis=1, keepdims=True)
    return d - d.mean(axis=0)


def envelope_db(d):
    n = len(d) // HOP
    if n == 0:
        return np.full(1, -120.0)
    p = (d[: n * HOP] ** 2).mean(axis=1).reshape(n, HOP).mean(axis=1)
    return 10 * np.log10(p + 1e-12)


def fades(x, fade_in, fade_out):
    x = x.copy()
    n = len(x)
    i = min(int(fade_in * SR), n // 4)
    o = min(int(fade_out * SR), n // 2)
    if i > 0:
        x[:i] *= np.linspace(0, 1, i, dtype=np.float32)[:, None]
    if o > 0:
        x[n - o:] *= (np.cos(np.linspace(0, np.pi / 2, o, dtype=np.float32)) ** 2)[:, None]
    return x


def events(d, max_len, slice_all, min_len=0.0, pre_roll=2.5):
    """Onset → decay windows, as (start, end, peak_db) in samples.
    Short files (< 4 s) are one event each – splitting them only produces clicks."""
    db = envelope_db(d)
    peak = db.max()
    floor = np.percentile(db, 20)
    if not slice_all or len(d) < 4 * SR:
        # the main event: start where it rises (≤ pre_roll s before the loudest moment), keep its tail
        top = int(np.argmax(db))
        start = top
        while start > max(0, top - int(pre_roll * 100)) and db[start - 1] > peak - 22:
            start -= 1
        start = max(0, start - 15)
        tail = np.nonzero(db > peak - 42)[0]
        end = min(max(tail[-1] + 10, top + 50), start + int(max_len * 100), len(db))
        return [(start * HOP, end * HOP, peak)]
    thr = max(peak - 26, floor + 9)
    out = []
    i = 2
    max_frames = int(max_len * 100)
    min_frames = int(min_len * 100)
    while i < len(db):
        before = db[max(0, i - 15): i].min()
        if db[i] >= thr and db[i] - before > 7:
            start = i - 1
            while start > max(0, i - 6) and db[start - 1] < db[start]:
                start -= 1
            ev_peak = db[i: i + 20].max()
            stop = max(ev_peak - 32, floor + 3)
            j = i
            quiet = 0
            while j < len(db) and j - start < max_frames:
                quiet = quiet + 1 if db[j] < stop else 0
                if quiet >= 5 and j - start >= min_frames:
                    break
                j += 1
            if j - start >= max(8, min_frames - 5):
                out.append((start * HOP, j * HOP, ev_peak))
            i = j + 3
        else:
            i += 1
    return out


def normalise_peak(x, target=0.89, max_gain_db=30):
    p = np.abs(x).max()
    if p < 1e-6:
        return x
    return x * min(target / p, 10 ** (max_gain_db / 20))


def make_loop(d, length):
    xf = min(1.5, length * 0.15)
    dur = len(d) / SR
    if dur < length + xf + 0.2:
        length = max(2.0, dur - xf - 0.2)
    L, X = int(length * SR), int(xf * SR)
    W = L + X
    db = envelope_db(d)
    best, best_score = 0, None
    margin = int(0.5 * SR)
    for s in range(margin if len(d) - W - margin > margin else 0, max(1, len(d) - W - margin), SR // 2):
        w = db[s // HOP: (s + W) // HOP]
        if len(w) == 0:
            continue
        score = w.std() + 0.5 * (w.max() - np.median(w))
        if best_score is None or score < best_score:
            best, best_score = s, score
    seg = d[best: best + W]
    body = seg[:L].copy()
    x = np.linspace(0, np.pi / 2, X, dtype=np.float32)[:, None]
    body[:X] = seg[:X] * np.sin(x) + seg[L: L + X] * np.cos(x)
    rms = np.sqrt((body ** 2).mean())
    body *= (10 ** (-18 / 20)) / max(rms, 1e-6)
    p = np.abs(body).max()
    if p > 0.95:
        body *= 0.95 / p
    return body


def write(x, path, bitrate):
    ch = aud.CHANNELS_STEREO if x.shape[1] == 2 else aud.CHANNELS_MONO
    aud.Sound.buffer(np.ascontiguousarray(x, dtype=np.float32), SR).write(
        path, SR, ch, aud.FORMAT_FLOAT32, aud.CONTAINER_OGG, aud.CODEC_OPUS, bitrate, 0)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    job = json.load(open(argv[0], encoding='utf-8'))
    out_dir = job['out']
    os.makedirs(out_dir, exist_ok=True)
    result = {}
    for slot, cfg in job['slots'].items():
        spec, inputs = cfg['spec'], cfg['inputs']
        for f in os.listdir(out_dir):
            if f.startswith(slot + '-') and f.endswith('.ogg'):
                os.remove(os.path.join(out_dir, f))
        files = []
        if spec['kind'] == 'loop':
            d = load(inputs[0], spec.get('stereo', False))
            loop = make_loop(d, spec['len'])
            name = f'{slot}-1.ogg'
            write(loop, os.path.join(out_dir, name), 96000 if loop.shape[1] == 2 else 64000)
            files.append({'file': name, 'source': os.path.basename(inputs[0]), 'seconds': round(len(loop) / SR, 2)})
        else:
            per_file = []
            for path in inputs:
                d = load(path, False)
                evs = sorted(events(d, spec['maxLen'], spec.get('slice', False), spec.get('minLen', 0), spec.get('preRoll', 2.5)), key=lambda e: -e[2])
                per_file.append([(d, e, os.path.basename(path)) for e in evs])
            # round-robin over the files, loudest first, so variants come from different takes
            picked = []
            k = 0
            while len(picked) < spec.get('variants', 1) and any(k < len(p) for p in per_file):
                for p in per_file:
                    if k < len(p) and len(picked) < spec.get('variants', 1):
                        picked.append(p[k])
                k += 1
            for n, (d, (s, e, _), src) in enumerate(picked, 1):
                cut = d[s:e]
                long = len(cut) / SR > 1.5
                cut = fades(cut, 0.004, max(0.03, len(cut) / SR * (0.3 if long else 0.2)))
                cut = normalise_peak(cut)
                name = f'{slot}-{n}.ogg'
                write(cut, os.path.join(out_dir, name), 64000)
                files.append({'file': name, 'source': src, 'seconds': round(len(cut) / SR, 2)})
        result[slot] = files
        print(f'AUDIO {slot}: ' + ', '.join(f"{x['file']} ({x['seconds']} s)" for x in files), flush=True)
    json.dump(result, open(argv[1], 'w', encoding='utf-8'), indent=2)


main()
