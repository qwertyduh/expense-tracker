# EAS cloud build setup (iOS + Android)

Supabase vars come from EAS environments (not a local .env). Run these yourself; they write to your Expo account.

## 1. Login / project
```
npx eas-cli login
npx eas-cli whoami
npx eas-cli init     # only if the projectId in app.json (extra.eas.projectId) is not yours/missing
```
app.json already has `extra.eas.projectId = dc9f3318-...`; confirm it belongs to your account (`eas project:info`).

## 2. Environment variables (both are EXPO_PUBLIC_*, so plaintext is correct; they are inlined into the app bundle)
```
for ENV in development preview production; do
  npx eas-cli env:create --environment $ENV --name EXPO_PUBLIC_SUPABASE_URL --value "https://<ref>.supabase.co" --visibility plaintext
  npx eas-cli env:create --environment $ENV --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<anon key>" --visibility plaintext
done
npx eas-cli env:list --environment production
```
Use a separate Supabase project per environment if you want isolation. Never put the service-role key in EXPO_PUBLIC_*.

## 3. Credentials
iOS (Apple Developer account, team 722APWTJ34, bundle id com.buildqwertyduh.expensetracker):
```
npx eas-cli credentials -p ios     # distribution cert + provisioning profile (let EAS manage)
```
- The widget extension target (@bacons/apple-targets, targets/widget) needs its own bundle id/profile; EAS creates it during the first interactive iOS build.
- Push: an APNs key (.p8) is uploaded via `eas credentials -p ios` (Push Notifications). The aps-environment entitlement is added by expo-notifications.
- Internal (preview/development) iOS builds need registered devices: `npx eas-cli device:create`.
- Live Activities (NSSupportsLiveActivities) work without extra capability setup.

Android:
```
npx eas-cli credentials -p android   # let EAS generate the upload keystore
```
- FCM: create a Firebase project, add an Android app with package `com.buildqwertyduh.expensetracker`, download `google-services.json`, then either
  - keep it out of git and upload as a file env var:
    `npx eas-cli env:create --environment <env> --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --visibility secret`
    and then add `"android": {"googleServicesFile": "./google-services.json"}` to app.json using `process.env.GOOGLE_SERVICES_JSON` (needs an app.config.js; not done yet), or
  - commit it and add `android.googleServicesFile` to app.json.
- Upload the FCM V1 service-account key via `eas credentials -p android` -> Push Notifications (FCM V1).

## 4. Builds
```
npx eas-cli build -p android --profile preview      # installable APK
npx eas-cli build -p ios     --profile preview      # internal ad-hoc
npx eas-cli build -p all     --profile production   # AAB + App Store IPA
npx eas-cli build -p android --profile development  # dev client
npx eas-cli build -p ios     --profile development
npx eas-cli submit -p ios --profile production      # optional
npx eas-cli submit -p android --profile production  # first upload to Play must be manual
```

## Blockers / notes found in audit
1. Android push will not work (and, with expo-notifications, `getExpoPushTokenAsync` fails on Android) without google-services.json + FCM V1 key. Builds still succeed without it. Needs your Firebase project.
2. EAS env vars must exist for the profile's environment before building, otherwise the app is built with undefined Supabase URL/key (accounts then show "not configured"; the rest of the app still works). `.env` is now gitignored, so it is never uploaded; only `.env.example` is committed. RESOLVED in repo, env vars still need creating by you.
3. ios/ and android/ are gitignored (/ios, /android), so EAS runs prebuild from app.json + plugins. Good; do not commit them. Custom plugin plugins/with-payment-accessibility-service.js and templates are tracked and used at prebuild.
4. patches/react-native+0.86.3.patch is applied by `postinstall: patch-package` (patch-package is a dependency); runs on EAS install. Keep the patch in git (it is tracked). Patch must match the installed react-native version exactly.
5. `expo-doctor`: 20/21 pass; only failure is patch-level SDK 57 version drift (expo, expo-router, expo-sqlite, etc.). Not blocking; fix with `npx expo install --check` (changes package.json/lock, left to you).
6. targets/widget/expo-target.config.js used a remote icon URL; it now uses the local ../../assets/images/icon.png (1024x1024). RESOLVED. Entitlements are empty (no App Group), so no App Group capability is needed unless the widget and app should share data.
7. Android signing/Play: the Accessibility-service payment capture feature may trigger Play Console policy review for production publication.
8. iOS `buildReactNativeFromSource: true` makes iOS builds much slower (consider a larger resource class: `"ios": {"resourceClass": "large"}`); left unchanged.
9. EAS CLI `>= 23.0.0` and `appVersionSource: remote` require `eas build:version:set` on first production build if you already have store builds.
