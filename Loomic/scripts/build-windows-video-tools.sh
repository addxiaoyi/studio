#!/usr/bin/env bash
set -euo pipefail

# Build the Windows tools with the same sources shipped in the installer.
output=$(realpath -m "${1:?Pass an output directory}")
work=$(mktemp -d "${TMPDIR:-/tmp}/loomic-video-tools.XXXXXX")
prefix="$work/install"
ffmpeg_commit=946fcce07b6dcd0331c8cc609192aeff5e1924f8
x264_commit=0480cb05fa188d37ae87e8f4fd8f1aea3711f7ee
jobs=${BUILD_JOBS:-2}
[[ "$jobs" =~ ^[1-9][0-9]*$ ]] || { echo 'BUILD_JOBS must be positive' >&2; exit 1; }
for tool in git make nasm pkg-config xz x86_64-w64-mingw32-gcc x86_64-w64-mingw32-ar; do
  command -v "$tool" >/dev/null || { echo "Missing build tool: $tool" >&2; exit 1; }
done

checkout() {
  local url=$1 commit=$2 directory=$3
  git init --quiet "$directory"
  git -C "$directory" fetch --quiet --depth=1 "$url" "$commit"
  git -C "$directory" checkout --quiet --detach FETCH_HEAD
  [[ $(git -C "$directory" rev-parse HEAD) == "$commit" ]]
}

checkout https://code.videolan.org/videolan/x264.git "$x264_commit" "$work/x264"
checkout https://github.com/FFmpeg/FFmpeg.git "$ffmpeg_commit" "$work/ffmpeg"
(
  cd "$work/x264"
  ./configure --host=x86_64-w64-mingw32 --cross-prefix=x86_64-w64-mingw32- \
    --enable-static --disable-cli --prefix="$prefix"
  make -j"$jobs"
  make install
)
(
  cd "$work/ffmpeg"
  PKG_CONFIG_LIBDIR="$prefix/lib/pkgconfig" ./configure \
    --prefix="$prefix" --arch=x86_64 --target-os=mingw32 \
    --cross-prefix=x86_64-w64-mingw32- --enable-cross-compile \
    --disable-autodetect --disable-network --disable-doc --disable-debug \
    --enable-gpl --enable-libx264 --enable-static --disable-shared \
    --pkg-config=pkg-config --pkg-config-flags=--static \
    --extra-cflags="-I$prefix/include" --extra-ldflags="-L$prefix/lib"
  make -j"$jobs" ffmpeg.exe ffprobe.exe
)
mkdir -p "$output"
cp "$work/ffmpeg/ffmpeg.exe" "$work/ffmpeg/ffprobe.exe" "$output/"
cp "$work/ffmpeg/COPYING.GPLv2" "$output/LICENSE.txt"
cp "$work/ffmpeg/ffbuild/config.mak" "$output/ffmpeg-config.mak"
cp "$work/x264/config.mak" "$output/x264-config.mak"
git -C "$work/ffmpeg" archive --format=tar HEAD | xz -9 -T1 > "$output/ffmpeg-source.tar.xz"
git -C "$work/x264" archive --format=tar HEAD | xz -9 -T1 > "$output/x264-source.tar.xz"
printf 'FFmpeg commit %s\nSource: https://github.com/FFmpeg/FFmpeg\nx264 commit %s\nSource: https://code.videolan.org/videolan/x264\n\nBuilt by scripts/build-windows-video-tools.sh using MinGW-w64.\nSource archives, license and exact configure output are included.\n' "$ffmpeg_commit" "$x264_commit" > "$output/SOURCE.txt"
(cd "$output" && sha256sum ffmpeg.exe ffprobe.exe ffmpeg-source.tar.xz x264-source.tar.xz > SHA256SUMS)
printf 'VIDEO_TOOLS_BUILT %s\nBUILD_DIRECTORY %s\n' "$output" "$work"
