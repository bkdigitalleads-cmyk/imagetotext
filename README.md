# imagetotext

Image to Text: Handwriting OCR for iPhone. Take a photo of a page, a whiteboard, a receipt or a handwritten note and get text you can copy, clean up and export (.txt, PDF, Markdown). It reads on the device with Apple's Vision framework, works offline, and nothing leaves the phone.

Expo SDK 57, React Native, TypeScript, expo-sqlite, RevenueCat, and a local Expo Module in modules/vision-ocr (Swift) for text recognition and PDF page rendering. See CLAUDE.md for how shipping works and NOTES.md for the change log.

```
npm install
npx tsc --noEmit
npm test
npx expo start --ios
```

Website (GitHub Pages, from docs/): https://bkdigitalleads-cmyk.github.io/imagetotext/
