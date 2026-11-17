#!/bin/sh
set -eu
umask 077

if [ "$#" -ne 7 ]; then
  exit 2
fi

TARGET_APP=$1
ARCHIVE=$2
UPDATE_DIR=$3
PARENT_PID=$4
EXPECTED_VERSION=$5
EXPECTED_SHA=$6
EXPECTED_SIZE=$7

case "$TARGET_APP" in
  */Kivuno.app) ;;
  *) exit 2 ;;
esac
case "$PARENT_PID" in
  ''|*[!0-9]*) exit 2 ;;
esac
case "$EXPECTED_VERSION" in
  ''|*[!0-9.]*) exit 2 ;;
esac
case "$EXPECTED_SHA" in
  *[!a-fA-F0-9]*|'') exit 2 ;;
esac
case "$EXPECTED_SIZE" in
  ''|*[!0-9]*) exit 2 ;;
esac

while /bin/kill -0 "$PARENT_PID" 2>/dev/null; do
  /bin/sleep 1
done

PARENT_DIR=${TARGET_APP%/*}
open_installed_app() {
  if [ "$(/usr/bin/id -u)" = '0' ]; then
    CONSOLE_UID=$(/usr/bin/stat -f '%u' /dev/console) || return 1
    case "$CONSOLE_UID" in
      ''|*[!0-9]*|0) return 1 ;;
    esac
    /bin/launchctl asuser "$CONSOLE_UID" /usr/bin/sudo -H -u "#$CONSOLE_UID" /usr/bin/open -a "$TARGET_APP"
  else
    /usr/bin/open -a "$TARGET_APP"
  fi
}

WORK_DIR=$(/usr/bin/mktemp -d "$PARENT_DIR/.kivuno-update.XXXXXXXX") || {
  open_installed_app >/dev/null 2>&1 || true
  exit 1
}

restore_and_open() {
  if [ -d "$WORK_DIR/previous.app" ] && [ ! -e "$TARGET_APP" ]; then
    /bin/mv "$WORK_DIR/previous.app" "$TARGET_APP" || true
  fi
  /bin/rm -rf "$WORK_DIR" "$UPDATE_DIR"
  if [ -d "$TARGET_APP" ]; then
    open_installed_app >/dev/null 2>&1 || true
  fi
}

fail_update() {
  restore_and_open
  exit 1
}

trap 'restore_and_open; exit 1' HUP INT TERM

if [ ! -f "$ARCHIVE" ] || [ -L "$TARGET_APP" ] || [ ! -d "$TARGET_APP" ]; then
  fail_update
fi
ACTUAL_SIZE=$(/usr/bin/stat -f '%z' "$ARCHIVE") || fail_update
ACTUAL_SHA=$(/usr/bin/shasum -a 256 "$ARCHIVE") || fail_update
ACTUAL_SHA=${ACTUAL_SHA%% *}
if [ "$ACTUAL_SIZE" != "$EXPECTED_SIZE" ] || [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
  fail_update
fi

/usr/bin/ditto -x -k "$ARCHIVE" "$WORK_DIR" || fail_update
NEW_APP="$WORK_DIR/Kivuno.app"
if [ ! -d "$NEW_APP" ] || [ -L "$NEW_APP" ]; then
  fail_update
fi
INFO_PLIST="$NEW_APP/Contents/Info.plist"
BUNDLE_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$INFO_PLIST") || fail_update
BUNDLE_VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INFO_PLIST") || fail_update
if [ "$BUNDLE_ID" != 'club.nosleep.relay' ] || [ "$BUNDLE_VERSION" != "$EXPECTED_VERSION" ]; then
  fail_update
fi

/bin/mv "$TARGET_APP" "$WORK_DIR/previous.app" || fail_update
if ! /bin/mv "$NEW_APP" "$TARGET_APP"; then
  /bin/mv "$WORK_DIR/previous.app" "$TARGET_APP" || true
  fail_update
fi

/bin/rm -rf "$WORK_DIR"
/bin/rm -rf "$UPDATE_DIR"
trap - HUP INT TERM
open_installed_app
