#!/bin/sh
set -eu

label=com.librephotos.server
data="$HOME/Library/Application Support/LibrePhotos"
agent="$HOME/Library/LaunchAgents/$label.plist"
app=""
delete_data=0

usage() {
  echo "usage: uninstall.sh [--delete-data] [--app=/path/to/LibrePhotos Server.app]"
  echo "Removes LibrePhotos Server, its older copies next to it and its login item."
  echo "The library in $data stays unless --delete-data is given."
}

for argument in "$@"; do
  case "$argument" in
    --delete-data) delete_data=1 ;;
    --app=*) app=${argument#--app=} ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$app" ]; then
  app=$(cd "$(dirname "$0")/../.." && pwd)
fi
case "$app" in
  *.app) ;;
  *)
    echo "uninstall.sh: $app is not an app" >&2
    exit 2
    ;;
esac

running() {
  pgrep -f -- "$app/Contents/Resources/librephotos/librephotos" || true
}

pids=$(running)
if [ -n "$pids" ]; then
  echo "Quitting LibrePhotos Server"
  kill -TERM $pids 2>/dev/null || true
  waited=0
  while [ -n "$(running)" ] && [ "$waited" -lt 60 ]; do
    sleep 1
    waited=$((waited + 1))
  done
  leftovers=$(running)
  if [ -n "$leftovers" ]; then
    kill -KILL $leftovers 2>/dev/null || true
  fi
fi

if [ -e "$agent" ]; then
  launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || true
  rm -f "$agent"
  echo "Removed the login item $agent"
fi

for folder in "$app"-*; do
  if [ -e "$folder" ]; then
    rm -rf "$folder"
    echo "Removed $folder"
  fi
done
rm -rf "$app"
echo "Removed $app"

if [ "$delete_data" = 1 ]; then
  rm -rf "$data"
  echo "Deleted the library in $data"
else
  echo "Kept the library in $data"
fi
