#!/bin/bash
# Unit tests on the simulator. REPLAY=1 runs only the hosted replay tests
# (they present real scenes and take a while); the default run skips them.
set -euo pipefail
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
cd "$(dirname "$0")/.."
mkdir -p build
xcodegen generate
SIM="${SIM_NAME:-iPhone 17 Pro}"
ARGS=(-project ActualGameplay.xcodeproj -scheme ActualGameplay
      -destination "platform=iOS Simulator,name=$SIM,OS=26.5"
      -derivedDataPath build/dd CODE_SIGNING_ALLOWED=NO)
if [ "${REPLAY:-0}" = "1" ]; then
  ARGS+=(-only-testing:ActualGameplayTests/ReplayTests)
else
  ARGS+=(-skip-testing:ActualGameplayTests/ReplayTests)
fi
if ! xcodebuild test "${ARGS[@]}" > build/last-test.log 2>&1; then
  grep -E "error:|Failing tests|failed \(|TEST FAILED|\*\* TEST" build/last-test.log | head -40
  exit 1
fi
grep -E "Executed [0-9]+ tests?" build/last-test.log | tail -1
