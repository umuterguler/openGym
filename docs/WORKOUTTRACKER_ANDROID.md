# OpenGym WorkoutTracker for Android

`workoutTracker` is a permanent personal installation, separate from the official app and from
`OpenGymTest`:

| Install | Package | Build |
| --- | --- | --- |
| Official OpenGym | `ch.duartesantos.opengym` | Existing sideload / Play / F-Droid variants |
| OpenGymTest | `ch.duartesantos.opengym.test` | Existing sideload debug variant |
| OpenGym WorkoutTracker | `ch.duartesantos.opengym.workouttracker` | `sideloadWorkoutTracker` only |

The `workoutTracker` release-like build type reuses the existing Android source tree, channel flavor,
plugins and web bundle. Its `.workouttracker` application ID suffix gives it an independent Android
data sandbox. Its label and deep-link scheme are also edition-specific. No `workoutTracker` debug
variant exists; development continues through the separate `.test` package.
It reports the `personal` update channel, so it does not offer official OpenGym APK self-updates;
personal releases are built from an explicitly approved commit and installed manually.

## Signing key and recovery

The release key is permanent. Android accepts an in-place update only when the package ID matches,
the new `versionCode` is greater, and the APK is signed by the same key. Losing or replacing the key
means this package cannot receive an ordinary in-place update; the user would have to preserve data
with a supported OpenGym backup, uninstall the app, and install a differently signed package. Do not
do that as a routine update.

The local key is created at:

```text
~/.config/opengym/workouttracker/release-key.jks
~/.config/opengym/workouttracker/signing.properties
```

Both are mode `0600` (directory `0700`) and ignored by Git. Keep an encrypted off-computer backup of
both files in a password manager or encrypted removable storage. Keep the backup password and the
Android keystore password in a secure password manager; do not put either in the repository, chat,
shell history, or an ordinary cloud folder. After restoring, preserve the same file paths or set
`WORKOUTTRACKER_SIGNING_PROPERTIES` to the restored properties file. Confirm the restored
certificate fingerprint matches the installed APK before making updates:

```sh
keytool -list -v -keystore ~/.config/opengym/workouttracker/release-key.jks -alias workouttracker
```

This machine also keeps an AES-256 encrypted recovery archive at
`~/Library/Application Support/OpenGym/WorkoutTracker/signing-backup.tar.gz.enc`; its random
recovery password is stored in the macOS login Keychain under service `OpenGym WorkoutTracker Key
Backup`. This is a local recovery copy, not an offsite backup. Before relying on this app as the only
copy of workout data, copy the encrypted archive to encrypted removable storage or a password-vault
file store, and preserve the recovery password in that vault. The SHA-256 signing certificate
fingerprint is `8c72e4355bb0e4fdcf3e7c6023f2af5880f2db4142a4d4346172fa09e2cb1c59`; verify it on a
restored computer before building.

To recover on a Mac after saving the archive and its recovery password securely, decrypt/extract it
into `~/.config/opengym/`:

```sh
mkdir -p ~/.config/opengym
RECOVERY_PASSWORD="$(security find-generic-password -a "$USER" -s 'OpenGym WorkoutTracker Key Backup' -w)"
openssl enc -d -aes-256-cbc -pbkdf2 \
  -in "$HOME/Library/Application Support/OpenGym/WorkoutTracker/signing-backup.tar.gz.enc" \
  -pass env:RECOVERY_PASSWORD | tar -xzf - -C ~/.config/opengym
unset RECOVERY_PASSWORD
chmod 700 ~/.config/opengym ~/.config/opengym/workouttracker
chmod 600 ~/.config/opengym/workouttracker/release-key.jks ~/.config/opengym/workouttracker/signing.properties
```

The archive contains `workouttracker/release-key.jks` and `workouttracker/signing.properties`.
On a different computer, edit only `storeFile` in `signing.properties` to point to the restored JKS;
never regenerate or replace the key. The local Mac can retrieve the archive password from Keychain;
on another computer, retrieve it from the separate password-vault entry where the user saved it.

For optional GitHub Actions signing, store the same key as a base64 repository secret
`WORKOUTTRACKER_KEYSTORE_BASE64`, and store `WORKOUTTRACKER_STORE_PASSWORD`,
`WORKOUTTRACKER_KEY_ALIAS`, and `WORKOUTTRACKER_KEY_PASSWORD` as Actions secrets. Never generate a
new CI key. Do not enable CI signing until the encrypted backup and vault recovery have been
verified.

## Build, inspect and install

Development continues on `feature/form-video-tracking` with `OpenGymTest`. Do not install a
WorkoutTracker debug build; there is intentionally no such build variant. When a reviewed source
commit is approved for a personal release, check it out explicitly and run:

```sh
./scripts/build-workouttracker-apk.sh <newVersionCode>
```

The APK is produced at:

```text
frontend/android/app/build/outputs/apk/sideload/workoutTracker/app-sideload-workoutTracker.apk
```

Before installing, verify the application ID, label and signature with Android SDK Build Tools:

```sh
aapt dump badging frontend/android/app/build/outputs/apk/sideload/workoutTracker/app-sideload-workoutTracker.apk | head -1
apksigner verify --print-certs frontend/android/app/build/outputs/apk/sideload/workoutTracker/app-sideload-workoutTracker.apk
```

Install as an update with Android Studio or:

```sh
adb install -r frontend/android/app/build/outputs/apk/sideload/workoutTracker/app-sideload-workoutTracker.apk
```

`-r` preserves the app's private data only for a valid same-package, same-signer update. Never use
`adb uninstall`, `pm clear`, or a different key for updates. Increment `versionCode` in
`workoutTrackerVersionCode` each time, always greater than the installed version; the initial value
is 32. Keep the application ID and key unchanged. Verify routines, settings, workouts and videos
after each update. Keep a current in-app
OpenGym backup before a release that changes local media/data handling.

Pass a `versionCode` greater than the app already installed. The script builds from the currently
checked-out commit; it does not promote or publish it.
Record the approved commit hash and APK SHA-256 alongside each personal installation.

## Optional GitHub Actions build

`.github/workflows/workouttracker-apk.yml` is manual-only (`workflow_dispatch`). It builds an APK
artifact from a commit/tag explicitly entered by the maintainer. It does not run on development
pushes, publish a GitHub release, or install on a device. Set the signing secrets above before
using it. Download the artifact from that workflow run and use the same `adb install -r` procedure.

## Data migration

Android does not share private data across application IDs. WorkoutTracker starts with its own
database and private media. To move data, create an OpenGym backup in the source installation and
explicitly import it in WorkoutTracker. Include/copy video media through the app's supported backup
and restore flow. Do not copy private app directories or access another package's sandbox.

## First-device verification checklist

1. Confirm all three package IDs are installed independently.
2. Launch WorkoutTracker and create/save a routine.
3. Record a set video, trim and save it; verify playback and Gallery export.
4. Open History and the previous-video view, then close/relaunch and confirm the routine/video remain.
5. Install a later APK signed with the same key and a higher `versionCode`; verify the data remains.

The first install does not validate upgrade preservation. That requires a later same-key APK with a
higher version code; preserve test data between the two installations.
