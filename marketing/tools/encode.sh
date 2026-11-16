#!/usr/bin/env bash
# encode.sh <cover.png> <framesDir> <out.mp4> <W> <H>
# Opens on the static cover (0.8 s), crossfades (0.5 s) into the gameplay frames
# (30 fps, real speed), no audio, H.264 yuv420p, faststart.
set -euo pipefail
COVER=$1 FR=$2 OUT=$3 W=$4 H=$5
ffmpeg -v error -y \
  -loop 1 -t 1.3 -framerate 30 -i "$COVER" \
  -framerate 30 -i "$FR/f%05d.jpg" \
  -filter_complex "[0:v]scale=${W}:${H},setsar=1,format=yuv420p,fps=30[c];[1:v]scale=${W}:${H},setsar=1,format=yuv420p[g];[c][g]xfade=transition=fade:duration=0.5:offset=0.8,format=yuv420p[v]" \
  -map "[v]" -an -c:v libx264 -preset slow -crf 19 -profile:v high -pix_fmt yuv420p -movflags +faststart "$OUT"
ffprobe -v error -show_entries format=duration,size -show_entries stream=width,height,codec_name -of compact "$OUT"
