"""Frame-by-frame change in one region of a screen recording: did anything in the panel move, dim or flicker?

python diff.py video.mp4 x y w h   (region in the video's pixels)
Prints JSON: frame count, the mean absolute change per frame against the first frame and the previous one,
and which frames changed visibly.
"""
import json
import subprocess
import sys

import numpy as np

video, x, y, w, h = sys.argv[1], *map(int, sys.argv[2:6])
w -= w % 2
h -= h % 2
raw = subprocess.run(
    ['ffmpeg', '-v', 'error', '-i', video, '-vf', f'crop={w}:{h}:{x}:{y}', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    capture_output=True, check=True).stdout
frames = np.frombuffer(raw, np.uint8).reshape(-1, h, w).astype(np.int16)
first = frames[0]
vs_first = [float(np.abs(f - first).mean()) for f in frames]
vs_prev = [0.0] + [float(np.abs(frames[i] - frames[i - 1]).mean()) for i in range(1, len(frames))]
# local changes too (a marker moving, a ring flicking): pixels that jumped by more than video noise ever does
local = [0] + [int((np.abs(frames[i] - frames[i - 1]) > 40).sum()) for i in range(1, len(frames))]
# video compression leaves a little noise on still content; a visible change is well above it
changed = [i for i in range(len(frames)) if vs_prev[i] > 1.5 or local[i] > 25]
print(json.dumps({
    'frames': len(frames),
    'maxVsFirst': round(max(vs_first), 2),
    'maxVsPrev': round(max(vs_prev), 2),
    'maxLocalPx': max(local),
    'framesChanged': len(changed),
    'changedAt': changed[:20],
}))
