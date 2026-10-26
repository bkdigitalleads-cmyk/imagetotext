@AGENTS.md

# Image to Text (imagetotext)

App #11 in Brian's iOS app portfolio (seller bkdigitalleads-cmyk). Expo SDK 57, React Native, TypeScript, expo-sqlite, RevenueCat, expo-notifications (local only, one trial reminder), a local Expo Module for Apple Vision OCR (modules/vision-ocr, Swift). Engine forked from Pumping (main, Oct 22, 2026), which came from Odo 1.0.6.

- App Store name: "Image to Text: Handwriting OCR". Subtitle "Text Scanner, Copy & Export". Home screen name: "Image to Text". Bundle ID: com.bwk.imagetotext. Expo slug and scheme: imagetotext. GitHub: bkdigitalleads-cmyk/imagetotext.
- App Store app ID: 6825592626 (eas.json `ascAppId`). Expo project: bkdeveloper123/imagetotext, projectId a0104a65-0c22-44a1-9ac0-c8dd98f6a5cf (app.json `extra.eas.projectId`). RevenueCat public iOS key in app.json `extra.revenueCatApiKeyIos` (set up by Cowork). The app runs with purchases off if that key is ever missing or does not start with `appl_`.
- Not in the store yet. Version 1.0.0: build 1 merged (PR #1) and uploaded to TestFlight on Oct 22, 2026; build 2 (PR #2, merged) is the accuracy release (page detection and flattening, a second pass on small or unsure lines, the hard-to-read note); build 3 fixes reading order on turned and multi-column pages, Clean up on lists, invented fractions and the hard-to-read note, and adds hidden test tools for TestFlight (Settings, tap the version line 7 times); build 4 stops a second-pass data loss, keeps handwritten lines apart in Clean up, reads columns as whole strips, cuts lines glued across a gutter, and uses Vision's document reader on iOS 26 and later (line reading as the fallback). Build 5 reads exactly the Settings languages (Vision guesses only when more than one is picked) and shows the hard-to-read note only for low-confidence words that are not dictionary words (over 15% and at least 3).
- What it is: a utility, one job done fast. A photo of a page, whiteboard, receipt or handwritten note becomes text to copy, clean up and export. Camera, Photos and Files (images and PDFs) in; crop and rotate; Vision reads on the device; Result with Clean up, Copy all, Share, Export (.txt, .pdf, .md), Add page; history on Home. No accounts, no cloud, no network calls for OCR. Everything stays on the device.
- No brand word anywhere (app, store text, keywords, website): no product names of other companies' OCR or of Apple frameworks in user-facing text.

## How shipping works (read before every push)

- A push to `main` that touches app.json, eas.json, package*.json, App.tsx, index.ts, src/, assets/ or modules/ starts an EAS workflow (.eas/workflows/deploy.yml) once the Expo project is connected. It builds iOS in the cloud and uploads the build to App Store Connect / TestFlight. Every such push costs a paid build credit. (modules/ is in the filter because the Swift OCR module is app code; Pumping has no modules/.)
- Never merge to `main` without Brian. Work on a branch and open a PR.
- Pushes that only change Markdown files (CLAUDE.md, NOTES.md, README.md, store/metadata.md), store/icon.js or docs/ do not build.
- Version numbers are local (`appVersionSource: local`, no auto-increment). Before any push that builds: raise `ios.buildNumber` in app.json by 1, and raise `version` (for example 1.0.0 to 1.0.1) when it will become a new App Store release. A build number that was already used makes the upload fail.
- Before every commit: run `npx tsc --noEmit` and `npm test`, and fix every error.
- Batch the changes for one app into one push. Ask Brian before any push that builds, and say what is in it.
- Submitting for App Review, release dates, prices, In-App Events, the subtitle, keywords and screenshots all happen in App Store Connect. Brian and his Cowork session handle that side. Do not try to do it from here.

## Rules

- Brian handles every credential and sign-in. Never type, paste, print or store passwords, tokens or API keys. If git push asks for credentials, stop and tell Brian. The RevenueCat public key and the Expo projectId are filled in by Brian or Cowork.
- No spending (paid services, extra builds beyond what Brian approved) without Brian saying go.
- Never change the RevenueCat entitlement id `pro`, the product ids (itt_pro_weekly, itt_pro_yearly), the offering packages ($rc_weekly, $rc_annual) or the logic in src/purchases.ts (a copy of Pumping's) without Brian asking. Paying users must never lose Pro.
- After launch the SQLite schema must stay backward compatible: never drop or rename columns or tables. New columns go in through a new step in `migrate()` in src/db.ts (guarded by PRAGMA user_version), so they run on existing installs. Settings live as key/value rows; a new setting just gets a default in `parseSettings`. Image files are stored by name in the documents folder (scans/), never by full path. Existing scans must survive every update.
- Do not change the app name, subtitle, keywords or the rating-prompt triggers (first successful copy, later-day launch) without asking.
- Keep changes small. Fix what the task needs and tidy only the files you already touch. List anything else you notice in NOTES.md under "Noticed, not changed" instead of fixing it. No broad refactors, dependency upgrades or Expo SDK upgrades unless Brian asks.
- Copy voice: plain and short. No "Unlock", "Premium", "Seamless", "Effortless", "Welcome", "Let's", exclamation marks or em dashes in any user-facing text (app, PDFs, notifications, store text, website), and none in text Brian sends to other people.
- The highlighter color is for the live action on a screen and selected recognized text only. Everything else is ink on paper.
- plugins/withoutPushEntitlement.js stays last in app.json plugins. After touching plugins, check `npx expo config --type introspect` still shows `ios.entitlements` as `{}` and the camera and photo library usage strings in `ios.infoPlist`.
- The OCR runs only on the device. Never add a network OCR service or analytics.

## Logging (so Brian's Cowork session can follow along)

- With every commit, add an entry at the top of NOTES.md in the same commit: date, version/build, what changed and why, and how it was checked.

## Testing

- Type check: `npx tsc --noEmit`. Unit checks (reading order on every way a page comes in, paragraph grouping, Clean up, the safe fixes, the page model, exports, the second pass, the nudge, page outlines, the daily quota, trial and plan rules): `npm test`. Health check: `npx expo-doctor`. Bundle check: `npx expo export --platform ios`.
- The Swift module (modules/vision-ocr/ios) only compiles in Xcode or the EAS build; nothing here can type-check it. Keep changes to it small and read them twice.
- Simulator (needs Xcode): `npx expo start --ios`. The simulator has no camera; use Photos or Files. Purchases do not complete in the simulator.
- Real-device check: TestFlight build from the EAS workflow, on Brian's iPhone. Vision accuracy, the camera and haptics can only be judged there.
