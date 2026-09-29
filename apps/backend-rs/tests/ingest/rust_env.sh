# Environment for librephotos-rs on database $1 with BASE_DATA $2 (source it).
V=/c/Users/Niaz/librephotos/wt-windev/apps/backend/.venv-win/Lib/site-packages
export DB_NAME="$1" BASE_DATA="$(cygpath -m "$2")" BASE_LOGS="$(cygpath -m "$2")/logs"
export SECRET_KEY=rust-bench-secret DB_USER=postgres DB_PASS=x DB_HOST=localhost DB_PORT=5433
export LP_MEDIA_MODE=direct
export LP_EXIFTOOL="$(cygpath -m "$V/exiftool_bin/exiftool.exe")"
export LP_FFMPEG="$(cygpath -m "$V/ffmpeg_bin/bin/ffmpeg.exe")" LP_FFPROBE="$(cygpath -m "$V/ffmpeg_bin/bin/ffprobe.exe")"
export LP_VIPS_LIB="$(cygpath -m "$(ls "$V"/libvips-42-*.dll)")"
export LP_PYTHON="$(cygpath -m /c/Users/Niaz/librephotos/wt-windev/apps/backend/.venv-win/Scripts/python.exe)"
export FEATURE_FACE_DETECTION=0 FEATURE_FACE_CLUSTER=0 FEATURE_IMAGE_CAPTIONING=0
export FEATURE_REVERSE_GEOCODING=0 FEATURE_SCENE_CLASSIFICATION=0
mkdir -p "$2/logs"
