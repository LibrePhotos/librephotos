#!/usr/bin/env bash
set -euo pipefail

[ $# -ge 2 ] || { echo "usage: package-app-store.sh <app> <out.pkg> [installer identity]" >&2; exit 64; }
APP=$1
PKG=$2
IDENTITY=${3:-}
BUNDLE_ID=com.librephotos.viewer

fail() {
  echo "::error::App Store package: $*"
  exit 1
}

[ -d "$APP" ] || fail "no app at $APP"
SIGN=()
if [ -n "$IDENTITY" ]; then
  SIGN=(--sign "$IDENTITY")
fi
mkdir -p "$(dirname "$PKG")"
rm -f "$PKG"
productbuild --component "$APP" /Applications ${SIGN[@]+"${SIGN[@]}"} "$PKG"
echo "- productbuild wrote $PKG ($(du -h "$PKG" | cut -f1))"

echo "pkgutil --check-signature:"
if pkgutil --check-signature "$PKG"; then
  [ -n "$IDENTITY" ] || fail "an unsigned build has a signature"
else
  [ -z "$IDENTITY" ] || fail "the package is not signed with $IDENTITY"
  echo "  (no signature: the installer certificate is not configured)"
fi

EXPANDED=$(mktemp -d)/expanded
pkgutil --expand "$PKG" "$EXPANDED"
grep -q "id=\"$BUNDLE_ID\"" "$EXPANDED/Distribution" || fail "the Distribution does not reference $BUNDLE_ID"
grep -q 'hostArchitectures="arm64,x86_64"\|hostArchitectures="x86_64,arm64"' "$EXPANDED/Distribution" || fail "the Distribution is not for both architectures"
COMPONENT=$(find "$EXPANDED" -maxdepth 1 -name '*.pkg' | head -n 1)
grep -q 'install-location="/Applications"' "$COMPONENT/PackageInfo" || fail "the component does not install into /Applications"
grep -q "identifier=\"$BUNDLE_ID\"" "$COMPONENT/PackageInfo" || fail "the component is not $BUNDLE_ID"
PAYLOAD=$(pkgutil --payload-files "$PKG" 2>/dev/null || (cd "$COMPONENT" && gunzip -c Payload | cpio -t 2>/dev/null))
echo "$PAYLOAD" | grep -q 'LibrePhotos Viewer.app/Contents/MacOS/librephotos-viewer$' || fail "the payload has no app executable"
echo "$PAYLOAD" | grep -q 'LibrePhotos Viewer.app/Contents/_CodeSignature/CodeResources$' || fail "the payload has an unsigned app"
echo "- product archive: $BUNDLE_ID for arm64 and x86_64, installs into /Applications, $(echo "$PAYLOAD" | wc -l | tr -d ' ') payload entries"
