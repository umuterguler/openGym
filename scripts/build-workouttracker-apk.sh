#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
signing_properties="${WORKOUTTRACKER_SIGNING_PROPERTIES:-$HOME/.config/opengym/workouttracker/signing.properties}"
version_code="${1:?Usage: ./scripts/build-workouttracker-apk.sh <newVersionCode>}"
if ! [[ "$version_code" =~ ^[1-9][0-9]*$ ]]; then
  echo "Version code must be a positive integer." >&2
  exit 2
fi

if [[ ! -r "$signing_properties" ]]; then
  echo "WorkoutTracker signing properties not found: $signing_properties" >&2
  echo "See docs/WORKOUTTRACKER_ANDROID.md for initial setup and recovery." >&2
  exit 2
fi

# Use the supported local JDK for this Android build without changing the user's global Java.
if [[ -x /usr/libexec/java_home ]]; then
  JAVA_HOME="$(/usr/libexec/java_home -v 21)"
  export JAVA_HOME
  PATH="$JAVA_HOME/bin:$PATH"
  export PATH
fi

cd "$repo_root/frontend"
npm ci
npm run build:mobile
cd android
./gradlew --no-daemon -PworkoutTrackerVersionCode="$version_code" assembleSideloadWorkoutTracker

apk="$repo_root/frontend/android/app/build/outputs/apk/sideload/workoutTracker/app-sideload-workoutTracker.apk"
if [[ ! -f "$apk" ]]; then
  echo "Expected APK was not produced at: $apk" >&2
  exit 3
fi

sdk_root="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -n "$sdk_root" && -x "$sdk_root/build-tools/36.0.0/aapt" ]]; then
  aapt="$sdk_root/build-tools/36.0.0/aapt"
else
  aapt="$(command -v aapt || true)"
fi
if [[ -z "$aapt" || ! -x "$aapt" ]]; then
  echo "Android aapt was not found; install Android Build Tools 36.0.0 to verify the APK." >&2
  exit 4
fi
badging="$("$aapt" dump badging "$apk")"
grep -F "package: name='ch.duartesantos.opengym.workouttracker' versionCode='$version_code'" <<<"$badging" >/dev/null || {
  echo "APK package/version identity does not match the requested WorkoutTracker build." >&2
  exit 5
}
grep -F "application-label:'OpenGym WorkoutTracker'" <<<"$badging" >/dev/null || {
  echo "APK display name is incorrect." >&2
  exit 6
}

echo "WorkoutTracker APK: $apk"
echo "Package: ch.duartesantos.opengym.workouttracker"
echo "Signature verification:"
apksigner="${aapt%/aapt}/apksigner"
if [[ ! -x "$apksigner" ]]; then apksigner="$(command -v apksigner || true)"; fi
if [[ -z "$apksigner" || ! -x "$apksigner" ]]; then
  echo "Android apksigner was not found; install Android Build Tools 36.0.0." >&2
  exit 7
fi
"$apksigner" verify --print-certs "$apk"
