# Image to Text design notes (1.0.0, Oct 22, 2026)

## Concept: a highlighter on paper

The whole product is one job: a page goes in, text comes out, and you leave. So the app looks like the desk that job happens on. Surfaces are warm off-white paper, text is ink black, lists are ruled paper with hairlines, and every scan is shown as a sheet with a folded corner. There is one color, a yellow-green highlighter, and it means one of two things only: the live action on a screen (Scan on Home, the shutter, Read it, Continue) or recognized text you have selected (the tapped word, the selection while editing, the word in its source photo). Nothing else is highlighted, so the eye always lands on the next thing to do.

Night is dim paper, not black: a warm grey sheet under a reading lamp (#262420), soft cream ink (#E7E0D0) instead of white, the highlighter turned down (#B4CC3A), and page photos dimmed a little so a white page never glares. The camera and crop screens are a darkroom in both modes (dark ink surround, paper-colored controls) so the page is the brightest thing on screen.

Renders: `after/` holds the screens at 393x852 @3x, light and dark, reduced to 160 colors. They come from a throwaway web copy of the app (in-memory database seeded with five scans, a stubbed store with $4.99 weekly with 3 days free and $29.99 yearly, a still photo in place of the camera, recognition stubbed to never finish so the reading screen can be caught), the same way Pumping's renders were made. Fonts and layout match the app; the iOS switch, haptics, Dynamic Type and real Vision output are not visible in them (the web switch is the browser's teal; on iOS it is ink on paper).

## The system

- Type: Zilla Slab (SIL OFL, `assets/fonts/OFL-ZillaSlab.txt`), SemiBold for headers, Medium for section heads and labels, both with tabular figures (`tabular` in `src/theme.ts`) on every count: free scans left, page numbers, dates, prices. The system font for everything else, and for the recognized text at a reading size (19/29 with 16 pt between paragraphs). Zilla Slab was picked over Bitter for its plainer, typewriter-like letters, which sit well next to scanned pages.
- Glyphs: `src/ui/Glyph.tsx`, drawn by hand on a 28 grid with lines that bow slightly and round ends: camera, picture, folder, copy, share, plus export, add page, pages, settings, trash, rotate, torch, grip, pencil, crop and the small ones. No icon pack.
- Corners, on purpose (`radius`): pills for the live action and toolbar, 18 pt trays and the three Home actions, nearly square paper (3 pt) for sheets and thumbnails, square full-bleed lists.
- Components (`src/ui/`, all new names, nothing from Pumping's bottle and pouch set): Tap (the only way something becomes tappable, always with a pressed state), LiveButton, InkButton, ToolButton, GlyphButton, WordButton, TopBar, Leaf (a page thumbnail with a folded corner), GhostLeaf, Count, Slip (the one-line notice), Tray (a sheet of paper sliding up), Rule, Mark (the highlighter box on a source photo), Group, Row, SwitchRow, CheckRow, DragList, and the drawings (PhotoToText, HandToType, OfflinePhone, CleanUpPair, TrialDays). Handwriting in drawings is generated pen strokes (`penLine`), not a font.

## Screens

- Home: the name, a settings glyph, then the three ways in. Scan is a large highlighter block (the live action); Photos and Files sit beside each other on paper. Under them, for free users, "2 of 3 free scans left today" in tabular figures. Then the history: Leaf thumbnail, first line, "Today, 2:41 pm · 1 page". Touch and hold to delete. Empty: a dashed ghost sheet and "Scans you make land here. The first one takes about two seconds."
- Camera: full screen, a page-shaped guide with drawn corners and the rest dimmed, "Fill the frame with the page.", close, a highlighter shutter, the torch. Auto-capture is off. The photo opens in crop with the crop already set to the guide.
- Crop: drag a corner or the whole box, rotate a quarter turn, back to the whole photo. Read it (or "Read 3 pages", or Next page; "Read all as they are" for a batch). Recognition runs on the full-resolution image.
- Reading: the page under a highlighter band sweeping down (a still band with Reduce Motion), "Reading page 1 of 3".
- Result: date and page count, the page strip with "Reorder pages" when there is more than one page, the Clean up switch with what it does, then the text. Unsure words get a faint dotted underline; tap any word and a tray shows the line it came from with the word under the highlighter, and "Fix the text". Edit turns each page into an editable field (selection in highlighter); an edited page offers "Use the text as read". The toolbar: Copy all ("Copied. 412 words."), Share, Export (marked Pro for free users), Add page.
- Batch: pages reorder by dragging the grip in the Pages tray (VoiceOver gets Move up and Move down); Export follows the order and combines the pages.
- Paywalls: the hero is a before and after of Clean up (two paper slips), not a feature grid. One headline by why it opened (the daily limit, export, Clean up, page 3 of a batch), one line, then the plans as plain radio rows and a highlighter Continue. Onboarding: Weekly first and preselected with "3 days free, then $4.99 a week" and "No payment now" when eligible, X after 3 seconds. In-app: "Yearly, best value" first and preselected, no trial wording. The 3.1.2(c) disclosure and links are always visible.
- Onboarding: three value screens (a photo held by an album corner turning into lines of text; a handwritten note and the same words typed, the first highlighted; a phone in airplane mode), then "Try it free for 3 days." with the length typed on a slip, then "We'll remind you the day before it ends." with three days and the second ringed in ink, then the paywall.
- Settings: Pro status or the Pro band, reading languages as ticks (English always on), keep the original photos, purchases and help, delete every scan.

## Build 2: reading accuracy (Oct 24)

Brian's build 1 test on a glossy cookbook page showed the engine reads well straight on, and badly at an angle and on 6 pt print. Build 2 changes how the page gets to Vision, not how it looks, apart from two places:

- Crop: when the page is found, the title says "Page found" and the crop is the page's own outline, drawn as a paper line with a ring on each corner over the dimmed photo. Drag a ring to fit the edge; the outline cannot be twisted. Rotate turns the outline with the photo; the crop glyph ("Use the whole photo") goes back to the plain rectangle, which is also what shows when no page is found. `after/04-crop` now shows this; `after/05-reading` shows the squared-up page.
- Result: one slip above a page's text when more than 10% of its words were hard to read: "Some words were hard to read. A closer, flatter photo usually fixes it." with Retake and Dismiss. It uses the toast's materials (ink-dark slip, paper text; cream slip with ink text on dim paper) but sits in the page, not over it, and appears once per page. `after/21-result-hard-to-read`.
- Camera: the hint is now "Fill the frame with the page, straight on." `after/03-camera`. Autofocus is continuous; tap anywhere on the preview to focus there, shown by a thin paper ring (not the highlighter: it is not the live action) that holds for the 3 seconds focus is held and then fades (no scale with Reduce Motion). A capture that measures blurry gets a paper slip over the preview, "That looks blurry. Hold still and tap the page to focus.", with Retake and Use anyway. `after/22-camera-blurry`.
- Result note, soft photo version: "Some words were hard to read, and the photo looks out of focus. Hold still and tap the page to focus." `after/21-result-hard-to-read` shows it.
- Lists: handwritten lists keep one item per line in reading order, each item its own paragraph.

Thresholds live in `src/accuracy.ts`: second pass under 0.6 confidence or under 1.2% of the image height, 2x, at most 40 lines; nudge above 10% unsure words; a found page is used at 0.6 confidence, covering 15% to 97% of the photo; blurry under a sharpness of 100; focus held 3 seconds. The paragraph gap (0.6 median line heights) is in `modules/vision-ocr/src/paragraphs.ts`.

## Icon

Four options in `icon-options.png`, each big and at 60 px on light and dark wallpaper, drawn by `store/icon.js` (`node icon.js options`; `node icon.js` writes `assets/` and the website images):

1. strips: a photo (a small landscape) held by a black album corner; its lower edge turns into lines of text, the first under the highlighter. The first pick; at 60 px its text lines thin out to almost nothing on a real home screen.
2. frame: camera framing corners in paper on an ink tile, a highlighted line and a paper line inside. Picked for a few hours on Oct 22, then rejected with strips: neither says "image to text".
3. dogear: a page with a folded corner on highlighter, picture on top and lines below. The corner is a page corner rather than a photo corner, and a full highlighter field spends the one accent on the background.
4. viewfinder (picked, Oct 22, Brian's concept): on an ink tile, four camera viewfinder corners in paper (stroke 34, arms 110, spanning x 120 to 904 and y 110 to 520) around a handwritten "Aa" (Caveat SemiBold, 420 px, tilted 4 degrees counterclockwise, like pen on paper), and below it a highlighter bar (radius 36, y 640 to 870, just wider than the word) with the same "Aa" typed in a heavy sans (Inter Black, 300 px) in paper. Handwriting in a camera frame on top, typed text on the highlighter below: the whole app in one tile. At 60 px both "Aa"s and the corners still read, on light and dark wallpaper.

The letters are drawn as outlines from the font files (opentype.js), so the icon renders the same on any machine. Caveat SemiBold (`assets/fonts/Caveat_600SemiBold.ttf`, license `assets/fonts/OFL-Caveat.txt`) is a static weight 600 instance of the variable Caveat from google/fonts ofl/caveat. Inter Black (`store/fonts/Inter_900Black.ttf`, license `store/fonts/OFL-Inter.txt`) is a static weight 900 instance of Inter from google/fonts ofl/inter; it is used only by the icon script and is not in the app. Neither license names a Reserved Font Name.

## Checklist

- [x] Concept and tokens in `src/theme.ts`; dim paper at night; photos dimmed at night.
- [x] One display font, bundled, OFL, with tabular figures on counts.
- [x] Drawn glyph set, own component kit, no Pumping styling reused.
- [x] Pressed states everywhere (Tap), haptics on capture (medium impact) and copy (success), selection ticks on reorder.
- [x] VoiceOver labels on every button, the drawings, history rows, the crop area, the reorder rows (with actions) and the toolbar; live region on the notice and the reading line.
- [x] Dynamic Type: body text scales; display and toolbar text cap at 1.3 to 1.5x so nothing clips. Designed for, not yet checked on a device.
- [x] Copy voice grep-checked: no Unlock, Premium, Seamless, Effortless, Welcome, Let's, exclamation marks or em dashes in user-facing text.
- [x] `after/*.png`: Home empty and with history, camera, crop, reading, result raw and cleaned, the word source tray, the export tray, batch and reorder, both paywalls, the free PDF preview, settings, all five onboarding steps; light and dark.
- [x] Icon options drawn; viewfinder picked (Brian's concept, it replaced strips and frame on Oct 22) and written to `assets/` and the website images.
