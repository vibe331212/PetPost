#!/bin/zsh
# Builds PetPost for the App Store and uploads it to App Store Connect (TestFlight).
# Needs: a paid Apple Developer account signed in to Xcode, and the app created in App Store Connect.
# Usage: ./upload-to-testflight.sh TEAM_ID      (find TEAM_ID at developer.apple.com > Account > Membership)
set -euo pipefail
TEAM="${1:?Give your 10-character Apple Team ID, like: ./upload-to-testflight.sh ABCDE12345}"
cd "$(dirname "$0")"
rm -rf build/PetPost.xcarchive build/export

echo "Building PetPost for the App Store..."
xcodebuild -project PetPost.xcodeproj -scheme PetPost -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/PetPost.xcarchive \
  DEVELOPMENT_TEAM="$TEAM" -allowProvisioningUpdates archive | grep -E "error:|ARCHIVE (SUCCEEDED|FAILED)"

echo "Uploading to App Store Connect..."
OPTS="$(mktemp -t petpost-export).plist"
cp ExportOptions.plist "$OPTS"
/usr/libexec/PlistBuddy -c "Add :teamID string $TEAM" "$OPTS"
xcodebuild -exportArchive -archivePath build/PetPost.xcarchive -exportOptionsPlist "$OPTS" \
  -exportPath build/export -allowProvisioningUpdates | grep -E "error:|EXPORT (SUCCEEDED|FAILED)|Upload"
echo "Done. In about 10 to 30 minutes the build shows up in App Store Connect > TestFlight."
