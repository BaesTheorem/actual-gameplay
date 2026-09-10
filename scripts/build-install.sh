#!/bin/bash
# Signed device build + wireless install to the paired iPhone.
# Usage: scripts/build-install.sh [--build-only] [UDID]
# The UDID defaults to IOS_DEVICE_UDID from Config/device.env (gitignored).
# --build-only signs the app and stops, for callers that install themselves
# (the sideload refresher does).
set -euo pipefail
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
cd "$(dirname "$0")/.."
INSTALL=1
if [ "${1:-}" = "--build-only" ]; then INSTALL=0; shift; fi
if [ -f Config/device.env ]; then set -a; . Config/device.env; set +a; fi
UDID="${1:-${IOS_DEVICE_UDID:-}}"
[ "$INSTALL" = 0 ] || [ -n "$UDID" ] || { echo "no device UDID: pass one or set IOS_DEVICE_UDID in Config/device.env" >&2; exit 2; }
[ -f Config/Signing.xcconfig ] || { echo "Config/Signing.xcconfig missing: copy Signing.example.xcconfig and set your team" >&2; exit 2; }

mkdir -p build
xcodegen generate
APP=build/dd/Build/Products/Release-iphoneos/ActualGameplay.app
# A stale product skips codesign and ships the old embedded profile; start clean.
rm -rf "$APP"
if ! xcodebuild -project ActualGameplay.xcodeproj -scheme ActualGameplay \
    -destination 'generic/platform=iOS' -derivedDataPath build/dd \
    -configuration Release -allowProvisioningUpdates build > build/last-build.log 2>&1; then
  grep -E "error:|BUILD FAILED" build/last-build.log | head -40
  exit 1
fi
echo "BUILD SUCCEEDED"
echo "profile expires: $(security cms -D -i "$APP/embedded.mobileprovision" | plutil -extract ExpirationDate raw -o - -)"
[ "$INSTALL" = 1 ] || exit 0
xcrun devicectl device install app --device "$UDID" "$APP"
