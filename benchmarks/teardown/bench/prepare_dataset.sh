#!/usr/bin/env bash
# Prepare the benchmark dataset: download (verified), derive HEIC/MP4, add the messy and
# interop sets, lock.
#
# usage: bench/prepare_dataset.sh <dataset-dir> [small|full]
#
# Needs python3, exiftool, ffmpeg and heif-enc (Ubuntu: libimage-exiftool-perl ffmpeg
# libheif-examples libheif-plugin-x265). Rerunning reuses verified downloads.
set -euo pipefail

dest=${1:?dataset dir}
profile=${2:-small}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
scale=1
[[ "$profile" == "small" ]] && scale=0.34

for tool in python3 exiftool; do
  command -v "$tool" >/dev/null || {
    echo "missing $tool" >&2
    exit 2
  }
done

python3 "$here/dataset/fetch_dataset.py" --manifest "$here/dataset/manifest.json" --dest "$dest" --profile "$profile"
heic=60
mp4=4
if [[ "$profile" == "small" ]]; then
  heic=20
  mp4=2
fi
python3 "$here/dataset/derive_formats.py" --dataset "$dest" --heic "$heic" --mp4 "$mp4"
python3 "$here/dataset/make_messy.py" --dataset "$dest" --seed 42 --scale "$scale"
python3 "$here/dataset/make_interop.py" --dataset "$dest" --per-convention 3
python3 "$here/dataset/lock_dataset.py" --dataset "$dest" --manifest "$here/dataset/manifest.json" --profile "$profile"
