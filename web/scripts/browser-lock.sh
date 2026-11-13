#!/bin/bash
# Run one command that starts a headless browser, and let only one such command run at a time.
#
#   web/scripts/browser-lock.sh python3 web/scripts/shots.py go= shot=home
#   web/scripts/browser-lock.sh node tools/painted/render.mjs --only=rock
#
# The screenshot tool and the art renderer each start a Chromium, and this machine has room
# for one. Two people working in this repo at once would otherwise start two. The lock is a
# directory, because mkdir either makes it or fails, with nothing in between. A lock older
# than 15 minutes belongs to a run that died, so it is taken over.
set -u
LOCK="${TMPDIR:-/tmp}/actual-gameplay-browser.lock"
while ! mkdir "$LOCK" 2>/dev/null; do
  if [ -d "$LOCK" ] && [ -n "$(find "$LOCK" -maxdepth 0 -mmin +15 2>/dev/null)" ]; then
    rmdir "$LOCK" 2>/dev/null
    continue
  fi
  sleep 3
done
trap 'rmdir "$LOCK" 2>/dev/null' EXIT
"$@"
