#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: smoke.sh dmg|app-store <artifact .dmg or .pkg> <folder with e2e_*.jpg> <out dir>" >&2
  exit 64
}

[ $# -eq 4 ] || usage
MODE=$1
ARTIFACT=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
PHOTOS=$(cd "$3" && pwd)
OUT=$4
case "$MODE" in dmg | app-store) ;; *) usage ;; esac

HERE=$(cd "$(dirname "$0")" && pwd)
PRODUCT="LibrePhotos Viewer"
BUNDLE_ID=com.librephotos.viewer
APP="/Applications/$PRODUCT.app"
EXE="$APP/Contents/MacOS/librephotos-viewer"
CONTAINER="$HOME/Library/Containers/$BUNDLE_ID"
if [ "$MODE" = app-store ]; then
  ROOT="$CONTAINER/Data/Library"
else
  ROOT="$HOME/Library"
fi
DATA="$ROOT/Application Support/$BUNDLE_ID"
CACHES="$ROOT/Caches/$BUNDLE_ID"
WEBKIT="$ROOT/WebKit/$BUNDLE_ID"
STARTUP_SECONDS=90
TAG="macos-$MODE-$(uname -m)"

mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/lpv-smoke.XXXXXX")
PROBE="$WORK/probe"
PICS="$WORK/pictures"
HEIC_DIR="$WORK/heic"
MARK="$WORK/started"
PID=""

step() { echo "- $*"; }

diagnostics() {
  echo "processes:"
  pgrep -fl "$PRODUCT.app" || true
  if [ -n "$PID" ] && [ -x "$PROBE" ]; then
    echo "windows of $PID:"
    "$PROBE" windows "$PID" || true
  fi
  echo "crash reports:"
  ls -t "$HOME/Library/Logs/DiagnosticReports" 2>/dev/null | grep -i librephotos | head -n 3 | while read -r report; do
    head -n 60 "$HOME/Library/Logs/DiagnosticReports/$report"
  done
  echo "unified log:"
  log show --last 5m --style compact --predicate "process == \"librephotos-viewer\" OR (subsystem == \"com.apple.sandbox.reporting\" AND eventMessage CONTAINS \"librephotos\")" 2>/dev/null | tail -n 60 || true
  echo "data:"
  find "$ROOT/Application Support/$BUNDLE_ID" "$ROOT/Caches/$BUNDLE_ID" -maxdepth 2 2>/dev/null | head -n 40 || true
}

fail() {
  echo "::error::$TAG smoke test failed: $*"
  diagnostics
  screenshot failure || true
  exit 1
}

wait_for() {
  local what=$1 seconds=$2
  shift 2
  local deadline=$((SECONDS + seconds))
  while [ $SECONDS -lt $deadline ]; do
    if "$@" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  fail "timed out after ${seconds}s waiting for $what"
}

app_pids() {
  pgrep -f "^$EXE" || true
}

one_process() {
  [ "$(app_pids | wc -l | tr -d ' ')" = 1 ]
}

window_title() {
  local titles
  titles=$("$PROBE" windows "$1" | cut -f3- | grep -v '^$' || true)
  if [ -z "$titles" ]; then
    titles=$(osascript -e "tell application \"System Events\" to get name of every window of (first process whose unix id is $1)" 2>/dev/null || true)
  fi
  echo "$titles"
}

shows() {
  window_title "$1" | grep -qxF "$2 - $PRODUCT" || window_title "$1" | tr ',' '\n' | sed 's/^ *//' | grep -qxF "$2 - $PRODUCT"
}

wait_title() {
  wait_for "window title \"$2 - $PRODUCT\" (pid $1, now: $(window_title "$1" | tr '\n' '|'))" "$STARTUP_SECONDS" shows "$1" "$2"
  step "pid $1 shows \"$2 - $PRODUCT\""
}

screenshot() {
  local name=$1
  sleep 3
  screencapture -x "$OUT/$TAG-$name-screen.png" 2>/dev/null || return 0
  if [ -n "$PID" ]; then
    local window
    window=$("$PROBE" windows "$PID" | head -n 1 | cut -f1)
    if [ -n "$window" ]; then
      screencapture -x -o -l"$window" "$OUT/$TAG-$name-window.png" 2>/dev/null || true
    fi
  fi
  step "saved $TAG-$name screenshots"
}

new_paths() {
  local roots=() root
  for root in "$HOME/Library" "$HOME/.cache" "$HOME/.local" "$HOME/.config" "$HOME/Pictures" "$HOME/Desktop" "$HOME/Documents" "$HOME/Downloads" /private/tmp; do
    [ -d "$root" ] && roots+=("$root")
  done
  find "${roots[@]}" \( -path "$HOME/Library/Developer" -o -path "$HOME/Library/Caches/com.apple.*" -o -path "$HOME/Library/Logs" -o -path "$WORK" \) -prune -o -newer "$MARK" -iname '*librephotos*' -print 2>/dev/null || true
}

lpc_count() {
  find "$CACHES/thumbs" -name '*.lpc' 2>/dev/null | wc -l | tr -d ' '
}

plist_value() {
  /usr/libexec/PlistBuddy -c "Print :$2" "$1" 2>/dev/null
}

stop_app() {
  local pid=$1
  kill -TERM "$pid" 2>/dev/null || true
  local deadline=$((SECONDS + 30))
  while kill -0 "$pid" 2>/dev/null && [ $SECONDS -lt $deadline ]; do sleep 1; done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || true
  fi
  step "stopped pid $pid"
}

entitlements_json() {
  local xml
  xml=$(codesign -d --entitlements - --xml "$APP" 2>/dev/null || true)
  if [ -z "$xml" ]; then
    echo '{}'
  else
    echo "$xml" | plutil -convert json -o - - 2>/dev/null || echo '{}'
  fi
}

has_entitlement() {
  entitlements_json | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get(sys.argv[1]) is True else 1)' "$1"
}

[ -d "$APP" ] && fail "$APP exists before the test; run this on a clean runner"
[ -e "$DATA" ] && fail "$DATA exists before the test; run this on a clean runner"

step "compiling the probe"
swiftc -O "$HERE/probe.swift" -o "$PROBE"
step "screen capture access for this runner: $("$PROBE" screen-access)"

mkdir -p "$PICS" "$HEIC_DIR"
cp "$PHOTOS"/e2e_01.jpg "$PHOTOS"/e2e_02.jpg "$PHOTOS"/e2e_03.jpg "$PICS/"
if ! sips -s format heic "$PHOTOS/e2e_04.jpg" --out "$HEIC_DIR/e2e_04.heic" >/dev/null 2>&1; then
  fail "sips could not write a HEIC on this runner"
fi
step "made $(sips -g format "$HEIC_DIR/e2e_04.heic" | tail -n 1 | sed 's/^ *//') with sips"
folder_state() { find "$PICS" "$HEIC_DIR" -exec stat -f "%N %z %m" {} + | sort; }
PICS_BEFORE=$(folder_state)
OPEN_WITH=("$PICS/e2e_01.jpg" "$HEIC_DIR/e2e_04.heic" public.jpeg public.png public.tiff public.heif public.avif org.webmproject.webp com.adobe.raw-image com.canon.cr2-raw-image com.canon.cr3-raw-image com.nikon.raw-image com.sony.arw-raw-image)
DEFAULTS_BEFORE=$("$PROBE" handlers "$BUNDLE_ID" "${OPEN_WITH[@]}" | cut -f1,3 || true)

if [ "$MODE" = dmg ]; then
  MOUNT="$WORK/mount"
  mkdir -p "$MOUNT"
  hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$MOUNT" "$ARTIFACT" >/dev/null
  [ -d "$MOUNT/$PRODUCT.app" ] || fail "the disk image has no $PRODUCT.app"
  [ "$(readlink "$MOUNT/Applications")" = /Applications ] || fail "the disk image has no Applications link"
  step "mounted $(basename "$ARTIFACT"): $(ls "$MOUNT" | tr '\n' ' ')"
  ditto "$MOUNT/$PRODUCT.app" "$APP"
  hdiutil detach "$MOUNT" >/dev/null
  step "copied $PRODUCT.app to /Applications and ejected the disk image"
else
  echo "pkgutil --check-signature:"
  pkgutil --check-signature "$ARTIFACT" || true
  sudo installer -pkg "$ARTIFACT" -target / | sed 's/^/  /'
  [ -d "$APP" ] || fail "installer did not put $PRODUCT.app into /Applications"
  pkgutil --pkg-info "$BUNDLE_ID" | sed 's/^/  /' || fail "no installer receipt for $BUNDLE_ID"
  step "installed $(basename "$ARTIFACT") with installer into /Applications"
fi

codesign --verify --strict --verbose=2 "$APP" 2>&1 | sed 's/^/  /' || fail "codesign --verify rejects the app"
SIGNATURE=$(codesign -dv "$APP" 2>&1)
step "signature: $(echo "$SIGNATURE" | grep -E '^(Identifier|CodeDirectory|Signature|TeamIdentifier)' | tr '\n' ';')"
case "$SIGNATURE" in *flags=*runtime*) ;; *) fail "the app is not signed with the hardened runtime" ;; esac
ARCHS=$(lipo -archs "$EXE")
case " $ARCHS " in *" x86_64 "*) ;; *) fail "no x86_64 slice: $ARCHS" ;; esac
case " $ARCHS " in *" arm64 "*) ;; *) fail "no arm64 slice: $ARCHS" ;; esac
step "universal binary: $ARCHS, running on $(uname -m)"
echo "spctl (Gatekeeper):"
spctl --assess --type execute --verbose=4 "$APP" 2>&1 | sed 's/^/  /' || true

PLIST="$APP/Contents/Info.plist"
[ "$(plist_value "$PLIST" CFBundleIdentifier)" = "$BUNDLE_ID" ] || fail "CFBundleIdentifier is not $BUNDLE_ID"
[ "$(plist_value "$PLIST" LSApplicationCategoryType)" = public.app-category.photography ] || fail "no Photography category"
[ "$(plist_value "$PLIST" ITSAppUsesNonExemptEncryption)" = false ] || fail "ITSAppUsesNonExemptEncryption is not false"
[ "$(plist_value "$PLIST" LSMinimumSystemVersion)" = 12.0 ] || fail "LSMinimumSystemVersion is not 12.0"
TYPES=$(plutil -extract CFBundleDocumentTypes json -o - "$PLIST")
for uti in public.jpeg public.png public.heic public.heif public.avif public.tiff public.camera-raw-image; do
  echo "$TYPES" | grep -q "\"$uti\"" || fail "CFBundleDocumentTypes does not claim $uti"
done
step "Info.plist: $BUNDLE_ID $(plist_value "$PLIST" CFBundleShortVersionString) ($(plist_value "$PLIST" CFBundleVersion)), Photography, export compliance set, $(plutil -extract CFBundleDocumentTypes raw "$PLIST") document types"

NOTICES="$APP/Contents/Resources/THIRD-PARTY-NOTICES.txt"
[ -f "$NOTICES" ] || fail "the app has no $NOTICES"
grep -q 'decoded by ImageIO' "$NOTICES" || fail "the notices do not name ImageIO as the HEIC decoder"
grep -q 'Windows Imaging Component' "$NOTICES" && fail "the Mac app ships the Windows notices"
grep -qE '^objc2-foundation [0-9.]+ \(Rust crate\)' "$NOTICES" || fail "the notices miss the macOS-only crate objc2-foundation"
grep -qE '^windows [0-9.]+ \(Rust crate\)' "$NOTICES" && fail "the notices list the Windows-only crate windows"
step "third-party notices in the app: $(grep -E '^Components \(' "$NOTICES"), macOS codec line, objc2-foundation listed, no Windows-only crates"

ENTITLEMENTS=$(entitlements_json)
echo "entitlements: $ENTITLEMENTS"
if [ "$MODE" = app-store ]; then
  for key in com.apple.security.app-sandbox com.apple.security.network.client com.apple.security.files.user-selected.read-write com.apple.security.files.bookmarks.app-scope com.apple.security.assets.pictures.read-write; do
    has_entitlement "$key" || fail "the App Store build lacks $key"
  done
  has_entitlement com.apple.security.get-task-allow && fail "the App Store build allows debugging"
  step "entitlements: sandbox, network client, user-selected files, app-scoped bookmarks, Pictures"
else
  has_entitlement com.apple.security.app-sandbox && fail "the direct download is sandboxed"
  step "entitlements: none (hardened runtime, not sandboxed)"
fi

LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
"$LSREGISTER" -f "$APP"
echo "LaunchServices database: $("$LSREGISTER" -dump 2>/dev/null | grep -c "$BUNDLE_ID" || true) lines mention $BUNDLE_ID"
HANDLERS=$("$PROBE" handlers "$BUNDLE_ID" "${OPEN_WITH[@]}") || fail "LaunchServices does not offer the app for every type: $HANDLERS"
echo "$HANDLERS" | sed "s/^/  /"
DEFAULTS_AFTER=$(echo "$HANDLERS" | cut -f1,3)
TAKEN=$(diff <(echo "$DEFAULTS_BEFORE") <(echo "$DEFAULTS_AFTER") | grep "^<" | grep -v "default=(none)$" || true)
[ -z "$TAKEN" ] || fail "installing changed the default app for: $TAKEN"
step "LaunchServices offers the app under Open With for every type; every type that had a default app before keeps it"

touch "$MARK"
sleep 1
open -a "$APP" "$PICS/e2e_01.jpg"
wait_for "the app to start" 60 one_process
PID=$(app_pids)
step "cold start: open -a with e2e_01.jpg started pid $PID"
wait_title "$PID" e2e_01.jpg
SANDBOX=$("$PROBE" sandboxed "$PID")
if [ "$MODE" = app-store ]; then
  [ "$SANDBOX" = sandboxed ] || fail "pid $PID is $SANDBOX"
else
  [ "$SANDBOX" = "not sandboxed" ] || fail "pid $PID is $SANDBOX"
fi
step "the kernel says pid $PID is $SANDBOX"
screenshot viewer

open -a "$APP" "$PICS/e2e_02.jpg"
wait_title "$PID" e2e_02.jpg
one_process || fail "a second process is running: $(app_pids | tr '\n' ' ')"
[ "$(app_pids)" = "$PID" ] || fail "the running viewer was replaced"
open -b "$BUNDLE_ID" "$PICS/e2e_03.jpg"
wait_title "$PID" e2e_03.jpg
one_process || fail "a second process is running after open -b"
step "running instance: open -a and open -b delivered e2e_02.jpg and e2e_03.jpg to pid $PID, no second process"

BEFORE_HEIC=$(lpc_count)
open -a "$APP" "$HEIC_DIR/e2e_04.heic"
wait_title "$PID" e2e_04.heic
heic_cached() { [ "$(lpc_count)" -gt "$BEFORE_HEIC" ]; }
wait_for "a thumbnail of the HEIC in $CACHES/thumbs" 60 heic_cached
step "HEIC decoded by ImageIO: e2e_04.heic shown and its thumbnail cached ($BEFORE_HEIC -> $(lpc_count) thumbnails)"
screenshot heic

wait_for "$DATA/local.db" 30 test -f "$DATA/local.db"
step "data: $(ls "$DATA" | tr '\n' ' ')in $DATA; thumbnails in $CACHES/thumbs; web data $([ -d "$WEBKIT" ] && echo "in $WEBKIT" || echo "not written yet")"
if [ "$MODE" = app-store ]; then
  [ -f "$CONTAINER/.com.apple.containermanagerd.metadata.plist" ] || fail "$CONTAINER is not a sandbox container"
  [ -e "$HOME/Library/Application Support/$BUNDLE_ID" ] && fail "the sandboxed app wrote $HOME/Library/Application Support/$BUNDLE_ID"
  OUTSIDE=$(new_paths | grep -v -e "^$CONTAINER" -e "^$HOME/Library/Application Scripts/$BUNDLE_ID\$" || true)
  [ -z "$OUTSIDE" ] || fail "the sandboxed app wrote outside its container: $OUTSIDE"
  step "sandbox: everything is under $CONTAINER; nothing new named after the app anywhere else in ~/Library, the home folders or /tmp"
else
  [ -e "$CONTAINER" ] && fail "the direct download created a sandbox container"
  UNLISTED=$(new_paths | grep -v -e "^$HOME/Library/Application Support/$BUNDLE_ID" -e "^$HOME/Library/Caches/$BUNDLE_ID" -e "^$HOME/Library/WebKit/$BUNDLE_ID" -e "^$HOME/Library/HTTPStorages/$BUNDLE_ID" -e "^$HOME/Library/Preferences/$BUNDLE_ID.plist" -e "^$HOME/Library/Saved Application State/$BUNDLE_ID.savedState" || true)
  [ -z "$UNLISTED" ] || fail "the app wrote where the docs and the cask's zap list do not say: $UNLISTED"
  step "no sandbox container; everything the app wrote is in the documented folders: $(new_paths | sed "s|^$HOME/Library/||" | cut -d/ -f1-2 | sort -u | tr '\n' ' ')"
fi
AFTER=$(folder_state)
[ "$AFTER" = "$PICS_BEFORE" ] || fail "viewing changed the picture folders: $(diff <(echo "$PICS_BEFORE") <(echo "$AFTER"))"
step "the picture folders are unchanged"

stop_app "$PID"
PID=""

if [ "$MODE" = dmg ]; then
  "$LSREGISTER" -u "$APP" || true
  rm -rf "$APP"
else
  sudo rm -rf "$APP"
  sudo pkgutil --forget "$BUNDLE_ID" >/dev/null
fi
[ -d "$APP" ] && fail "$APP is still there"
step "uninstalled: removed $APP"
echo "left behind (the app's data; macOS does not remove it with the app):"
for path in "$HOME/Library/Application Support/$BUNDLE_ID" "$HOME/Library/Caches/$BUNDLE_ID" "$HOME/Library/WebKit/$BUNDLE_ID" "$HOME/Library/HTTPStorages/$BUNDLE_ID" "$HOME/Library/Preferences/$BUNDLE_ID.plist" "$HOME/Library/Saved Application State/$BUNDLE_ID.savedState" "$CONTAINER" "$HOME/Library/Application Scripts/$BUNDLE_ID"; do
  if [ -e "$path" ]; then
    echo "  $path ($(du -sh "$path" 2>/dev/null | cut -f1))"
  fi
done

if [ "$MODE" = app-store ]; then
  if rm -rf "$CONTAINER" 2>/dev/null && [ ! -e "$CONTAINER" ]; then
    step "removed the container $CONTAINER"
  else
    echo "::warning::could not remove $CONTAINER from a script; Finder or the App Store removes it"
  fi
fi
rm -rf "$WORK"
step "$TAG smoke test passed"
