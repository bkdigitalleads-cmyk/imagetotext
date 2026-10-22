const sharp = require('sharp');

// Image to Text icon: a photo corner turning into a line of text, in the
// app's palette (paper, ink, one highlighter). Three options are drawn for
// docs/design/icon-options.png (`node icon.js options`); the chosen one is
// written to ../assets and the website (`node icon.js`).
//   strips  - a photo held by an album corner; its lower edge splits into
//             lines of text, the middle one under the highlighter
//   frame   - camera framing corners on ink, a highlighted line inside
//   dogear  - a page with a folded corner on highlighter: picture on top, lines below
// Chosen: frame (Brian, Oct 22, after the 60 px comparison: the strips'
// text lines disappear at home screen size). See docs/design/NOTES.md.
const CHOSEN = 'frame';

const PAPER = '#F4EFE4';
const SHEET = '#FBF8F1';
const INK = '#1D1B17';
const SOFT = '#8A8375';
const HIGHLIGHT = '#D4EE3C';
const PHOTO = '#9FB1A3';
const PHOTO_DARK = '#5E7466';

// A little landscape for "photo": hills and a sun, clipped to the photo.
const scene = (x, y, w, h) => `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${PHOTO}"/>
  <circle cx="${x + w * 0.74}" cy="${y + h * 0.3}" r="${h * 0.14}" fill="${SHEET}"/>
  <path d="M${x} ${y + h * 0.82} L${x + w * 0.3} ${y + h * 0.42} L${x + w * 0.52} ${y + h * 0.7} L${x + w * 0.66} ${y + h * 0.55} L${x + w} ${y + h * 0.9} V${y + h} H${x} Z" fill="${PHOTO_DARK}"/>`;

const art = {
  strips: () => {
    const x = 150, y = 140, w = 724;
    return `<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
    <rect width="1024" height="1024" fill="${PAPER}"/>
    <defs><clipPath id="p"><rect x="${x}" y="${y}" width="${w}" height="390"/></clipPath></defs>
    <g clip-path="url(#p)">${scene(x, y, w, 390)}</g>
    <!-- the photo's lower edge becomes lines of text -->
    <rect x="${x}" y="566" width="${w}" height="118" rx="12" fill="${HIGHLIGHT}"/>
    <rect x="${x + 46}" y="602" width="${w - 160}" height="46" rx="23" fill="${INK}"/>
    <rect x="${x}" y="726" width="${w * 0.84}" height="56" rx="28" fill="${INK}"/>
    <rect x="${x}" y="824" width="${w * 0.54}" height="56" rx="28" fill="${INK}"/>
    <!-- the album corner -->
    <path d="M${x - 46} ${y - 46} H${x + 210} L${x - 46} ${y + 210} Z" fill="${INK}"/>
  </svg>`;
  },
  frame: () => `<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
    <rect width="1024" height="1024" fill="${INK}"/>
    <path d="M190 360 V230 Q190 190 230 190 H360 M664 190 H794 Q834 190 834 230 V360 M834 664 V794 Q834 834 794 834 H664 M360 834 H230 Q190 834 190 794 V664" stroke="${SHEET}" stroke-width="56" fill="none" stroke-linecap="round"/>
    <rect x="270" y="430" width="484" height="92" rx="10" fill="${HIGHLIGHT}"/>
    <rect x="306" y="460" width="380" height="32" rx="16" fill="${INK}"/>
    <rect x="270" y="580" width="400" height="36" rx="18" fill="${SHEET}"/>
  </svg>`,
  dogear: () => `<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
    <rect width="1024" height="1024" fill="${HIGHLIGHT}"/>
    <defs><clipPath id="s"><path d="M232 150 H632 L792 310 V874 H232 Z"/></clipPath></defs>
    <path d="M232 150 H632 L792 310 V874 H232 Z" fill="${SHEET}"/>
    <g clip-path="url(#s)">${scene(232, 150, 560, 330)}</g>
    <path d="M632 150 V310 H792 Z" fill="${SOFT}"/>
    <rect x="292" y="560" width="440" height="38" rx="19" fill="${INK}"/>
    <rect x="292" y="650" width="400" height="38" rx="19" fill="${INK}"/>
    <rect x="292" y="740" width="260" height="38" rx="19" fill="${INK}"/>
  </svg>`,
};

async function writeChosen() {
  const full = Buffer.from(art[CHOSEN]());
  // App Store icon: no transparency.
  await sharp(full).flatten({ background: PAPER }).resize(1024, 1024).png().toFile('../assets/icon.png');
  await sharp(full).resize(1024, 1024).png().toFile('../assets/android-icon-foreground.png');
  const field = { strips: PAPER, frame: INK, dogear: HIGHLIGHT }[CHOSEN];
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: field } }).png().toFile('../assets/android-icon-background.png');
  await sharp(full).resize(1024, 1024).grayscale().png().toFile('../assets/android-icon-monochrome.png');
  await sharp(full).resize(48, 48).png().toFile('../assets/favicon.png');
  await sharp(full).resize(512, 512).png().toFile('../assets/splash-icon.png');
  // The website (docs/): the logo next to the name, the iOS home screen icon, and the share card.
  const mask = Buffer.from('<svg width="512" height="512"><rect width="512" height="512" rx="114" fill="#fff"/></svg>');
  await sharp(full).resize(512, 512).composite([{ input: mask, blend: 'dest-in' }]).png().toFile('../docs/icon-512.png');
  await sharp(full).resize(180, 180).png().toFile('../docs/apple-touch-icon.png');
  const icon = await sharp(full).resize(360, 360).composite([{ input: Buffer.from('<svg width="360" height="360"><rect width="360" height="360" rx="80" fill="#fff"/></svg>'), blend: 'dest-in' }]).png().toBuffer();
  const card = Buffer.from(`<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="630" fill="${PAPER}"/>
    <text x="500" y="290" font-family="Zilla Slab, Georgia, serif" font-weight="600" font-size="76" fill="${INK}">Image to Text</text>
    <rect x="496" y="330" width="560" height="62" fill="${HIGHLIGHT}"/>
    <text x="510" y="376" font-family="Helvetica, Arial, sans-serif" font-size="38" fill="${INK}">Handwriting OCR for iPhone</text>
    <text x="500" y="456" font-family="Helvetica, Arial, sans-serif" font-size="30" fill="${SOFT}">On the device. No account. Works offline.</text></svg>`);
  await sharp(card).composite([{ input: icon, left: 90, top: 135 }]).png().toFile('../docs/og-image.png');
  console.log('icons written:', CHOSEN);
}

/** Each option big, then at 60x60 as it would sit on a home screen, on light and dark wallpaper. */
async function writeOptions() {
  const names = Object.keys(art);
  const W = 1500;
  const H = 820;
  const tiles = [];
  for (const [i, n] of names.entries()) {
    const big = await sharp(Buffer.from(art[n]())).resize(380, 380).png().toBuffer();
    const mask = Buffer.from('<svg width="380" height="380"><rect width="380" height="380" rx="86" fill="#fff"/></svg>');
    const bigRounded = await sharp(big).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    const small = await sharp(Buffer.from(art[n]())).resize(60, 60).png().toBuffer();
    const smallMask = Buffer.from('<svg width="60" height="60"><rect width="60" height="60" rx="13.5" fill="#fff"/></svg>');
    const smallRounded = await sharp(small).composite([{ input: smallMask, blend: 'dest-in' }]).png().toBuffer();
    const x = 60 + i * 480;
    tiles.push({ input: bigRounded, left: x, top: 90 });
    tiles.push({ input: smallRounded, left: x + 70, top: 560 });
    tiles.push({ input: smallRounded, left: x + 250, top: 560 });
  }
  const labels = names
    .map((n, i) => {
      const x = 60 + i * 480 + 190;
      const pick = n === CHOSEN ? ' (picked)' : '';
      return `<text x="${x}" y="56" font-family="Georgia" font-size="34" text-anchor="middle" fill="${INK}">${i + 1}. ${n}${pick}</text>
        <text x="${x - 90}" y="660" font-family="Helvetica" font-size="20" text-anchor="middle" fill="#57524A">60 px, light</text>
        <text x="${x + 90}" y="660" font-family="Helvetica" font-size="20" text-anchor="middle" fill="#57524A">60 px, dark</text>`;
    })
    .join('');
  const base = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="${PAPER}"/>
    ${names.map((_, i) => `<rect x="${60 + i * 480 + 20}" y="520" width="140" height="160" fill="#E3DFD6"/><rect x="${60 + i * 480 + 210}" y="520" width="140" height="160" fill="#111"/>`).join('')}
    ${labels}
    <text x="${W / 2}" y="770" font-family="Helvetica" font-size="22" text-anchor="middle" fill="#57524A">Image to Text app icon options. The 60 px tiles are the real home screen size.</text>
  </svg>`);
  await sharp(base).composite(tiles).png().toFile('../docs/design/icon-options.png');
  console.log('options written');
}

(process.argv[2] === 'options' ? writeOptions() : writeChosen()).catch((e) => {
  console.error(e);
  process.exit(1);
});
