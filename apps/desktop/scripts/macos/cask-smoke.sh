#!/usr/bin/env bash
set -euo pipefail

[ $# -eq 2 ] || { echo "usage: cask-smoke.sh <dmg> <version>" >&2; exit 64; }
DMG=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
VERSION=$2
HERE=$(cd "$(dirname "$0")" && pwd)
APP="/Applications/LibrePhotos Viewer.app"
BUNDLE_ID=com.librephotos.viewer
TAP=local/lpv-smoke
export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_ANALYTICS=1 HOMEBREW_NO_INSTALL_CLEANUP=1

fail() {
  echo "::error::cask smoke test failed: $*"
  exit 1
}

step() { echo "- $*"; }

[ -d "$APP" ] && fail "$APP exists before the test"
LEFT=$(ls -d "$HOME/Library/Application Support/$BUNDLE_ID" "$HOME/Library/Caches/$BUNDLE_ID" "$HOME/Library/WebKit/$BUNDLE_ID" 2>/dev/null || true)
[ -n "$LEFT" ] || fail "no data left behind by the smoke test to zap"
step "data left behind by the app: $(echo "$LEFT" | tr '\n' ' ')"

brew tap-new --no-git "$TAP" >/dev/null
CASKS="$(brew --repository)/Library/Taps/${TAP%/*}/homebrew-${TAP#*/}/Casks"
mkdir -p "$CASKS"
node "$HERE/config.mjs" cask --version "$VERSION" --sha256 "$(shasum -a 256 "$DMG" | cut -d' ' -f1)" --url "file://$DMG" --out "$CASKS/librephotos-viewer.rb"
brew install --cask "$TAP/librephotos-viewer"
[ -x "$APP/Contents/MacOS/librephotos-viewer" ] || fail "brew did not install $APP"
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")" = "$BUNDLE_ID" ] || fail "brew installed something else"
step "brew install --cask put $(basename "$APP") into /Applications"

brew uninstall --zap --cask "$TAP/librephotos-viewer"
[ -d "$APP" ] && fail "brew uninstall left $APP"
REMAINING=$(find "$HOME/Library" -maxdepth 2 -iname "*$BUNDLE_ID*" -not -path "$HOME/Library/Logs/*" 2>/dev/null || true)
[ -z "$REMAINING" ] || fail "brew uninstall --zap left: $REMAINING"
step "brew uninstall --zap removed the app and every folder it wrote"
brew untap "$TAP" >/dev/null
step "cask smoke test passed"
