# Image to Text, App Store metadata (1.0.2)

Everything here is pasted into App Store Connect by Brian and Cowork. No em dashes anywhere, no brand words, no "Unlock", "Premium", "Seamless", "Effortless", "Welcome", "Let's" or exclamation marks.

App record: ASC app id 6825592626 (eas.json `ascAppId`), bundle id com.bwk.imagetotext. Expo project bkdeveloper123/imagetotext, projectId a0104a65-0c22-44a1-9ac0-c8dd98f6a5cf.

## Name (30/30)
Image to Text: Handwriting OCR

Home screen name (app.json `name`): Image to Text

## Subtitle (27/30)
Text Scanner, Copy & Export

## Keywords (99/100)
photo,picture,scan,notes,document,pdf,transcribe,handwritten,live,camera,screenshot,reader,word,doc

(1.0.1, Brian, Nov 17.) Replaces the 1.0.0 list (photo,picture,scan,extract,convert,notes,document,pdf,whiteboard,receipt,camera,paste,recognition, 97/100, approved Oct 22). The words that left the English list are in the Spanish (Mexico) keywords below.

Rule: no word from the name or subtitle (image, to, text, handwriting, ocr, scanner, copy, export).

## Spanish (Mexico) locale

A second localization in App Store Connect, Spanish (Mexico), as set in App Store Connect for 1.0.1 (Brian, Nov 17). It has its own name and subtitle, in English, so the two listings together cover more words.

### Name (28/30)
OCR Scanner: Picture to Text

### Subtitle (30/30)
Transcribe Handwriting & Notes

### Keywords (100/100)
image,document,photo,scan,handwritten,pdf,convert,reader,whiteboard,receipt,cursive,live,letter,book

No keyword repeats a word from this locale's name or subtitle. Seven words are also in the English keywords (document, photo, scan, handwritten, pdf, reader, live).

### What's New (1.0.1)
Small fixes and improvements.

## More English listings for the US App Store (1.0.2)

Eight more localizations in App Store Connect, all in English, that the US App Store also indexes. Each one is its own listing: a search phrase only forms inside one listing, so every target phrase sits whole in one listing's name or subtitle, and the keywords add words that combine with that listing's own name and subtitle. en-US and es-MX above stay exactly as they are.

Description, promotional text, support and privacy links: copied from en-US. What's New (1.0.2), every listing including en-US and es-MX: Small fixes and improvements.

<!-- listings:start -->
| Locale | Name | Chars | Subtitle | Chars | Keywords | Bytes |
| --- | --- | --- | --- | --- | --- | --- |
| ar-SA | Handwriting to Text Converter | 29 | Scan Notes from Image & Photo | 29 | picture,pdf,ocr,cursive,screenshot,whiteboard,receipt,handwritten,extract,copy,camera,page,letter | 97 |
| fr-FR | Text Scanner: Scan Words OCR | 28 | Image & Handwriting Reader | 26 | photo,picture,notes,pdf,handwritten,cursive,screenshot,receipt,whiteboard,camera,copy,extract,book | 98 |
| ko | Scan Text: OCR Scanner App | 26 | Picture, Photo & Image Reader | 29 | handwriting,handwritten,notes,pdf,cursive,screenshot,whiteboard,receipt,camera,copy,extract,convert | 99 |
| pt-BR | Transcribe Handwritten Notes | 28 | Handwriting to Text Scanner | 27 | photo,picture,image,pdf,ocr,scan,cursive,screenshot,whiteboard,receipt,letter,camera,copy,study,book | 100 |
| ru | OCR: Image to Text Scanner | 26 | Scan Handwriting, Notes & PDF | 29 | photo,picture,handwritten,cursive,screenshot,whiteboard,receipt,letter,book,camera,copy,extract,page | 100 |
| vi | Photo to Text: OCR Scanner | 26 | Copy Words from Image & Notes | 29 | picture,handwriting,handwritten,pdf,scan,cursive,screenshot,whiteboard,receipt,camera,extract,export | 100 |
| zh-Hans | Notes Scanner: Handwriting OCR | 30 | Image & Picture to Text | 23 | photo,handwritten,pdf,scan,cursive,screenshot,whiteboard,receipt,letter,camera,copy,extract,convert | 99 |
| zh-Hant | Whiteboard & Receipt to Text | 28 | OCR Scanner for Photos & PDF | 28 | image,picture,handwriting,handwritten,notes,scan,cursive,screenshot,letter,book,camera,copy,extract | 99 |
<!-- listings:end -->

Rules for these eight (checked by `npm test`, tests/store.test.mjs, which reads the table above):
- Name and subtitle 30 characters at most; keywords 100 bytes at most, comma separated, no spaces.
- Inside one listing no word appears twice across name, subtitle and keywords, and no plural of a word that is already there ("photo" and "Photos", "word" and "Words").
- No other company's product names and no Apple feature names: never "live" (with "text" it reads as an Apple feature) and never "lens".
- Only what the app does: it turns a photo, an image or a PDF into text. "Transcribe" appears only next to handwriting or notes, so it never reads as audio. "Document" and "doc" are left out of every listing with "Scanner" or "Scan" in it, so no listing forms "document scanner" or "scan document": the app does not keep scanned documents.

Target phrases (daily US searches) and where each one sits whole:

| Phrase | Searches | Listing |
| --- | --- | --- |
| transcribe | 1222 | pt-BR name (next to handwritten notes); es-MX subtitle |
| image to text | 1141 | ru name; en-US name |
| handwriting to text | 621 | ar-SA name; pt-BR subtitle |
| text scanner | 516 | fr-FR name; ru name; pt-BR subtitle; en-US subtitle |
| ocr | 432 | fr-FR, ko, ru, vi, zh-Hans and zh-Hant names or subtitles |
| scan text | 398 | ko name |
| ocr scanner | 393 | ko name; vi name; zh-Hant subtitle; es-MX name |
| picture to text | 141 | zh-Hans subtitle; es-MX name |
| handwritten notes | 94 | pt-BR name |

Changes from Brian's draft:
- vi name "Photo to Text Scanner OCR" became "Photo to Text: OCR Scanner": the same words, with "ocr scanner" now whole.
- Keywords written per listing from the word list, leaving out every word already in that listing and its plural ("word" is out where the name has "Words", "photo" where the subtitle has "Photos", "convert" in ar-SA next to "Converter").

## Promotional text (156/170)
Point the camera at a page, a whiteboard or a handwritten note and get text you can copy, clean up and export. It reads on your iPhone. Nothing is uploaded.

## Description
Image to Text turns a photo of a page, a whiteboard, a receipt or a handwritten note into text you can copy, clean up and export. It reads on your iPhone, works offline, and nothing leaves the phone.

ONE JOB, DONE FAST
• Scan with the camera, or pick photos or files (images and PDFs)
• Crop and rotate before it reads, then get the text in about two seconds
• Reads printed text and handwriting

TEXT YOU CAN USE
• Copy all with one tap, or share the text to any app
• Clean up joins the broken lines from the page into real paragraphs and fixes double spaces
• Edit anything right in the app
• Tap a word to see where it was on the page; words that were hard to read get a faint underline

PAGES AND FILES
• Put several pages in one document and drag them into order
• Export as plain text (.txt), PDF or Markdown (.md)
• Every scan is kept in a list on the phone, with its first line and the date

PRIVATE BY DESIGN
• Text recognition runs on the device
• No account, no sign-in, no uploads
• Works in airplane mode

IMAGE TO TEXT PRO
Free: 3 scans a day, copy and share. Pro adds unlimited scans, Clean up, export files and documents with any number of pages. Choose weekly (with a free trial for new subscribers) or yearly.

Terms of Use (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
Privacy Policy: https://bkdigitalleads-cmyk.github.io/imagetotext/privacy.html

## What's New (1.0.1)
Small fixes and improvements.

1.0.0 had: First version. Scan a page, a note or a whiteboard and get text you can copy, clean up and export, all on your iPhone.

## Category
Primary: Productivity. Secondary: Utilities.

## Age rating
4+. No objectionable content, no user-generated content shared with others, no web access.

## App Privacy (nutrition label)
Data Not Collected. Photos and text stay in the app's storage on the device and are never uploaded. RevenueCat validates purchases with an anonymous app user id and purchase history; answer the purchase questions the same way as for Pumping and Odo.

## Pricing and RevenueCat
- Subscription group "Image to Text Pro" (ASC id 22502283).
- `itt_pro_weekly` (ASC id 6825592734): auto-renewing weekly, $4.99/week, 3-day free trial (introductory offer). RevenueCat package `$rc_weekly`. Preselected on the onboarding paywall, listed first there.
- `itt_pro_yearly` (ASC id 6825592850): auto-renewing yearly, $29.99/year, no trial. RevenueCat package `$rc_annual`. Preselected and listed first on the in-app paywall as "Yearly, best value".
- No lifetime product.
- RevenueCat: entitlement `pro`, offering `default` with the two packages above. Public iOS key in app.json `extra.revenueCatApiKeyIos`.
- Prices and trial text in the app always come from StoreKit.

## App Review note (paste into ASC, Notes)
Image to Text reads the text in a photo on the device, using the system's on-device text recognition. There is no account or sign-in, and no image or text is sent anywhere.

On first launch you see three short intro screens. If the Apple ID can still get the free trial, two screens explain the trial and the reminder; the reminder screen can ask for notification permission, used only for one local reminder the day before a free trial ends. Then the paywall opens. The close button (X, top right) appears after 3 seconds. Tap it to use the app for free.

Free use: 3 scans a day (a scan is one page read), copy and share the text, and documents of up to 2 pages. The paywall opens when the daily limit is reached, when Export is used (free users can preview the PDF, marked SAMPLE), when Clean up is switched on, and when a third page is added to a document. Restore purchases is on the paywall and in Settings.

To test: tap Scan and photograph any printed or handwritten page (or tap Photos and pick a photo of text), tap Read it, then Copy all.

## Screenshot plan (iPhone 6.9" and 6.5", 6 shots; Brian captures from a TestFlight build)
1. Hero: the Result screen with a page of text and the toolbar: "Any page becomes text you can copy"
2. Handwriting: a handwritten note on the left of the frame and the recognized text: "Reads handwriting, not just print"
3. Clean up, before and after: the same page with the switch off and on: "One switch fixes the line breaks"
4. Batch to PDF: the page strip of a 3-page document and the Export tray: "Many pages, one PDF"
5. Offline and private: airplane mode on in the status bar, a scan in progress: "Reads on your iPhone. Nothing is uploaded"
6. History: Home with a few scans: "Every scan, kept on your phone"
