#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 4 ]; then
  echo "usage: build.sh <linux-x86_64|linux-aarch64|win64|macos-arm64> <src-dir> <stage-dir> <source-url> [work-dir]" >&2
  exit 2
fi

python=${PYTHON:-python3}
absolute() {
  "$python" -c 'import os, sys; print(os.path.abspath(sys.argv[1]))' "$1"
}

target=$1
src=$(absolute "$2")
stage=$(absolute "$3")
source_url=$4
work=$(absolute "${5:-$PWD/ffmpeg-work-$target}")
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
prefix=$work/prefix
install=$work/install
jobs=$(getconf _NPROCESSORS_ONLN)

rm -rf "$work" "$stage"
mkdir -p "$prefix/lib/pkgconfig" "$prefix/include" "$prefix/bin" "$stage"
export PATH=$prefix/bin:$PATH
export PKG_CONFIG_LIBDIR=$prefix/lib/pkgconfig
export PKG_CONFIG_PATH=
export SOURCE_DATE_EPOCH=946684800

encoders=libx264,aac,mjpeg,libwebp,libwebp_anim,wrapped_avframe,pcm_s16le
muxers=mp4,mov,ipod,tgp,tg2,matroska,webm,avi,asf,flv,mpegts,mpeg1system,mpeg2vob,mpeg2svcd,ogg,ogv,image2,webp,null
filters=format,aformat,null,anull,copy,scale,zscale,tonemap
filters=$filters,transpose,hflip,vflip,rotate,crop,trim,atrim,aresample,setpts,asetpts,fps,setparams,setsar,setdar
test_encoders=ffv1,mpeg4
test_filters=testsrc,testsrc2,color,sine,anullsrc,signalstats,concat

case $target in
  linux-x86_64 | linux-aarch64)
    export CC=gcc CXX=g++ AR=ar RANLIB=ranlib STRIP=strip
    export CFLAGS="-O2 -fPIC" CXXFLAGS="-O2 -fPIC"
    host_args=()
    meson_cross=()
    ffmpeg_target=(--enable-pthreads)
    ffmpeg_ldflags="-Wl,--as-needed"
    ffmpeg_libs="-lstdc++ -lm"
    ;;
  win64)
    triplet=x86_64-w64-mingw32
    export CC=$triplet-gcc-win32 CXX=$triplet-g++-win32 AR=$triplet-ar RANLIB=$triplet-ranlib STRIP=$triplet-strip
    export CFLAGS="-O2" CXXFLAGS="-O2"
    host_args=(--host=$triplet)
    cat >"$work/cross.meson" <<EOF
[binaries]
c = '$CC'
cpp = '$CXX'
ar = '$AR'
strip = '$STRIP'
windres = '$triplet-windres'
pkg-config = 'pkg-config'

[host_machine]
system = 'windows'
cpu_family = 'x86_64'
cpu = 'x86_64'
endian = 'little'
EOF
    meson_cross=(--cross-file "$work/cross.meson")
    ffmpeg_target=(--target-os=mingw32 --arch=x86_64 --cross-prefix=$triplet- --enable-w32threads)
    ffmpeg_ldflags="-static-libgcc -static-libstdc++"
    ffmpeg_libs="-lm"
    ;;
  macos-arm64)
    export MACOSX_DEPLOYMENT_TARGET=14.0
    export CC=clang CXX=clang++ AR=ar RANLIB=ranlib STRIP=strip
    export CFLAGS="-O2 -fPIC -arch arm64" CXXFLAGS="-O2 -fPIC -arch arm64" LDFLAGS="-arch arm64"
    host_args=()
    meson_cross=()
    ffmpeg_target=(--enable-pthreads --arch=aarch64 --install-name-dir=@rpath)
    ffmpeg_ldflags=""
    ffmpeg_libs="-lc++ -lm"
    ;;
  *)
    echo "unknown target $target" >&2
    exit 2
    ;;
esac

build_nasm() {
  if [ "$target" = linux-aarch64 ] || [ "$target" = macos-arm64 ] || command -v nasm >/dev/null; then
    return
  fi
  cp -a "$src/nasm" "$work/nasm"
  (cd "$work/nasm" && CC=gcc CFLAGS=-O2 ./configure --prefix="$prefix" >/dev/null && make -j"$jobs" nasm ndisasm >/dev/null && cp nasm ndisasm "$prefix/bin/")
}

build_zlib() {
  cp -a "$src/zlib" "$work/zlib"
  cd "$work/zlib"
  if [ "$target" = win64 ]; then
    make -f win32/Makefile.gcc CC="$CC" AR="$AR" RC=$triplet-windres STRIP="$STRIP" CFLAGS="$CFLAGS" libz.a
    cp zlib.h zconf.h "$prefix/include/"
    cp libz.a "$prefix/lib/"
  else
    ./configure --prefix="$prefix" --static
    make -j"$jobs" install
  fi
  cd - >/dev/null
}

build_x264() {
  mkdir -p "$work/x264"
  cd "$work/x264"
  local cross=()
  if [ "$target" = win64 ]; then
    cross=(--host=$triplet --cross-prefix=$triplet-)
  fi
  "$src/x264/configure" --prefix="$prefix" "${cross[@]}" --enable-static --enable-pic --disable-cli \
    --disable-opencl --disable-lavf --disable-swscale --disable-ffms --disable-gpac --disable-lsmash
  make -j"$jobs" install-lib-static
  cd - >/dev/null
}

build_dav1d() {
  meson setup "$work/dav1d" "$src/dav1d" "${meson_cross[@]}" --prefix="$prefix" --libdir=lib \
    --buildtype=release --default-library=static -Db_staticpic=true \
    -Denable_tools=false -Denable_tests=false -Denable_examples=false
  ninja -C "$work/dav1d" install
}

build_zimg() {
  cp -a "$src/zimg" "$work/zimg-src"
  (cd "$work/zimg-src" && ./autogen.sh)
  mkdir -p "$work/zimg"
  cd "$work/zimg"
  "$work/zimg-src/configure" --prefix="$prefix" "${host_args[@]}" --enable-static --disable-shared --with-pic \
    --disable-testapp --disable-example --disable-unit-test
  make -j"$jobs" install
  if [ "$target" = win64 ]; then
    sed -i 's/-lstdc++/-l:libstdc++.a/g' "$prefix/lib/pkgconfig/zimg.pc"
  fi
  if [ "$target" = macos-arm64 ]; then
    sed -i.orig 's/-lstdc++/-lc++/g' "$prefix/lib/pkgconfig/zimg.pc"
  fi
  cd - >/dev/null
}

build_libwebp() {
  mkdir -p "$work/libwebp"
  cd "$work/libwebp"
  "$src/libwebp/configure" --prefix="$prefix" "${host_args[@]}" --enable-static --disable-shared --with-pic \
    --enable-libwebpmux --disable-libwebpdemux --disable-libwebpdecoder --disable-libwebpextras \
    --disable-png --disable-jpeg --disable-tiff --disable-gif --disable-wic --disable-gl --disable-sdl
  make -j"$jobs" install
  cd - >/dev/null
}

configure_args=(
  --prefix="$install"
  "${ffmpeg_target[@]}"
  --enable-gpl
  --disable-autodetect
  --enable-zlib
  --enable-shared
  --disable-static
  --disable-debug
  --disable-doc
  --disable-ffplay
  --disable-network
  --disable-everything
  --enable-decoders
  --enable-demuxers
  --enable-parsers
  --enable-bsfs
  --enable-protocol=file,pipe
  --enable-encoder=$encoders,$test_encoders
  --enable-muxer=$muxers
  --enable-filter=$filters,$test_filters
  --enable-indev=lavfi
  --enable-libx264
  --enable-libdav1d
  --enable-libzimg
  --enable-libwebp
  --pkg-config=pkg-config
  --pkg-config-flags=--static
  --extra-cflags=-I$prefix/include
  "--extra-ldflags=-L$prefix/lib $ffmpeg_ldflags"
  "--extra-libs=$ffmpeg_libs"
  --extra-version=librephotos
)

require_components() {
  local kind=$1 name missing=0
  for name in ${2//,/ }; do
    if ! grep -q "^#define CONFIG_${name^^}_${kind^^} 1" config_components.h; then
      echo "FFmpeg did not enable the $kind $name" >&2
      missing=1
    fi
  done
  [ "$missing" = 0 ]
}

build_ffmpeg() {
  mkdir -p "$work/ffmpeg"
  cd "$work/ffmpeg"
  if ! "$src/ffmpeg/configure" --cc="$CC" --cxx="$CXX" "${configure_args[@]}"; then
    tail -n 80 ffbuild/config.log >&2
    exit 1
  fi
  require_components encoder "$encoders,$test_encoders"
  require_components muxer "$muxers"
  require_components filter "$filters,$test_filters"
  require_components protocol file,pipe
  require_components indev lavfi
  require_components decoder libdav1d
  make -j"$jobs"
  make install
  cd - >/dev/null
}

stage_linux() {
  mkdir -p "$stage/bin" "$stage/lib"
  cp "$install/bin/ffmpeg" "$install/bin/ffprobe" "$stage/bin/"
  local lib soname
  for lib in "$install"/lib/lib*.so.*.*.*; do
    soname=$(basename "$lib" | sed -E 's/(\.so\.[0-9]+)\.[0-9]+\.[0-9]+$/\1/')
    cp "$lib" "$stage/lib/$soname"
  done
  "$STRIP" --strip-unneeded "$stage"/bin/* "$stage"/lib/*
  patchelf --set-rpath '$ORIGIN/../lib' "$stage"/bin/*
  patchelf --set-rpath '$ORIGIN' "$stage"/lib/*
  local needed
  needed=$(for f in "$stage"/bin/* "$stage"/lib/*; do patchelf --print-needed "$f"; done | sort -u)
  echo "NEEDED: $(echo "$needed" | tr '\n' ' ')"
  if echo "$needed" | grep -vE '^(lib(av|sw)[a-z]+\.so\.[0-9]+|libc\.so\.6|libm\.so\.6|libpthread\.so\.0|libdl\.so\.2|librt\.so\.1|libstdc\+\+\.so\.6|libgcc_s\.so\.1|ld-linux-[a-z0-9_-]+\.so\.[0-9])$'; then
    echo "unexpected shared library dependency" >&2
    exit 1
  fi
}

stage_macos() {
  mkdir -p "$stage/bin" "$stage/lib"
  cp "$install/bin/ffmpeg" "$install/bin/ffprobe" "$stage/bin/"
  local lib name
  for lib in "$install"/lib/lib*.dylib; do
    name=$(basename "$lib")
    if [[ $name =~ ^lib[a-z]+\.[0-9]+\.dylib$ ]]; then
      cp -L "$lib" "$stage/lib/$name"
    fi
  done
  chmod 755 "$stage"/bin/* "$stage"/lib/*
  "$STRIP" -x "$stage"/bin/* "$stage"/lib/*
  local file
  for file in "$stage"/bin/*; do
    install_name_tool -add_rpath @loader_path/../lib "$file"
  done
  for file in "$stage"/lib/*; do
    install_name_tool -add_rpath @loader_path "$file"
  done
  codesign --force --sign - "$stage"/bin/* "$stage"/lib/*
  local needed
  needed=$(for file in "$stage"/bin/* "$stage"/lib/*; do otool -L "$file" | tail -n +2 | awk '{print $1}'; done | sort -u)
  echo "linked: $(echo "$needed" | tr '\n' ' ')"
  if echo "$needed" | grep -vE '^(@rpath/lib(av|sw)[a-z]+\.[0-9]+\.dylib|/usr/lib/libSystem\.B\.dylib|/usr/lib/libc\+\+\.1\.dylib)$'; then
    echo "unexpected shared library dependency" >&2
    exit 1
  fi
  "$stage/bin/ffmpeg" -hide_banner -version | head -n 1
}

stage_win64() {
  mkdir -p "$stage/bin"
  cp "$install"/bin/ffmpeg.exe "$install"/bin/ffprobe.exe "$install"/bin/*.dll "$stage/bin/"
  "$STRIP" --strip-unneeded "$stage"/bin/*
  local needed
  needed=$(for f in "$stage"/bin/*; do $triplet-objdump -p "$f" | sed -n 's/^\s*DLL Name: //p'; done | tr 'A-Z' 'a-z' | sort -u)
  echo "DLL imports: $(echo "$needed" | tr '\n' ' ')"
  if echo "$needed" | grep -vE '^((av|sw)[a-z]+-[0-9]+\.dll|kernel32\.dll|msvcrt\.dll|user32\.dll|advapi32\.dll|bcrypt\.dll|ole32\.dll|shell32\.dll|shlwapi\.dll|psapi\.dll|gdi32\.dll|ws2_32\.dll|secur32\.dll|ntdll\.dll|api-ms-win-[a-z0-9-]+\.dll)$'; then
    echo "unexpected DLL dependency" >&2
    exit 1
  fi
}

build_nasm
build_zlib
build_x264
build_dav1d
build_zimg
build_libwebp
build_ffmpeg

case $target in
  win64) stage_win64 ;;
  macos-arm64) stage_macos ;;
  *) stage_linux ;;
esac

configure_line="${configure_args[*]}"
configure_line=${configure_line//$prefix/<deps>}
configure_line=${configure_line//$install/<prefix>}
"$python" "$here/sources.py" notices "$src" "$stage" "$source_url" "$configure_line" "$($CC --version | head -n 1)"
{ du -ab "$stage" 2>/dev/null || du -ak "$stage"; } | sort -n | tail -n 20
