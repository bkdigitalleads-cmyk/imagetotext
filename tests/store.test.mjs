// Checks for the App Store listings in store/metadata.md: the eight English
// listings added in 1.0.2 for the US App Store (ar-SA, fr-FR, ko, pt-BR, ru,
// vi, zh-Hans, zh-Hant) keep Apple's limits and the keyword rules, and the
// en-US and es-MX listings stay as they were. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const md = readFileSync(new URL('../store/metadata.md', import.meta.url), 'utf8');

/** The table between the listings markers, one object per row. */
function listings() {
  const block = md.split('<!-- listings:start -->')[1]?.split('<!-- listings:end -->')[0];
  assert.ok(block, 'the listings table is in store/metadata.md');
  return block
    .trim()
    .split('\n')
    .slice(2) // header and divider
    .map((row) => {
      const [locale, name, nameChars, subtitle, subtitleChars, keywords, keywordBytes] = row
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());
      return { locale, name, nameChars: Number(nameChars), subtitle, subtitleChars: Number(subtitleChars), keywords, keywordBytes: Number(keywordBytes) };
    });
}

/** The line under a heading such as "## Keywords (99/100)". */
const under = (heading) => md.split('\n')[md.split('\n').findIndex((l) => l.startsWith(heading)) + 1]?.trim();

const words = (s) => (s.toLowerCase().match(/[a-z]+/g) ?? []);
/** The same word, or one is the plural of the other. */
const related = (a, b) => a === b || a + 's' === b || b + 's' === a || a + 'es' === b || b + 'es' === a || (a.endsWith('y') && a.slice(0, -1) + 'ies' === b) || (b.endsWith('y') && b.slice(0, -1) + 'ies' === a);

const NEW_LOCALES = ['ar-SA', 'fr-FR', 'ko', 'pt-BR', 'ru', 'vi', 'zh-Hans', 'zh-Hant'];

test('store: the eight new listings are there, once each', () => {
  assert.deepEqual(listings().map((l) => l.locale), NEW_LOCALES);
});

test('store: names and subtitles 30 characters at most, keywords 100 bytes, comma separated, no spaces', () => {
  for (const l of listings()) {
    assert.ok(l.name.length <= 30, `${l.locale} name is ${l.name.length}`);
    assert.ok(l.subtitle.length <= 30, `${l.locale} subtitle is ${l.subtitle.length}`);
    assert.ok(Buffer.byteLength(l.keywords, 'utf8') <= 100, `${l.locale} keywords are ${Buffer.byteLength(l.keywords, 'utf8')} bytes`);
    assert.ok(!/\s/.test(l.keywords), `${l.locale} keywords have a space`);
    assert.ok(l.keywords.split(',').every((k) => /^[a-z]+$/.test(k)), `${l.locale} keywords are single lowercase words`);
    // The counts written in the table are the real ones.
    assert.equal(l.nameChars, l.name.length, `${l.locale} name count`);
    assert.equal(l.subtitleChars, l.subtitle.length, `${l.locale} subtitle count`);
    assert.equal(l.keywordBytes, Buffer.byteLength(l.keywords, 'utf8'), `${l.locale} keyword bytes`);
  }
});

test('store: inside one listing no word repeats across name, subtitle and keywords, plurals included', () => {
  for (const l of listings()) {
    const all = [...words(l.name), ...words(l.subtitle), ...l.keywords.split(',')];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) assert.ok(!related(all[i], all[j]), `${l.locale}: "${all[i]}" and "${all[j]}"`);
  }
});

test('store: no Apple feature or other brand names, nothing the app does not do', () => {
  for (const l of listings()) {
    const all = [...words(l.name), ...words(l.subtitle), ...l.keywords.split(',')];
    for (const banned of ['live', 'lens', 'translate', 'translator', 'audio', 'voice', 'speech'])
      assert.ok(!all.includes(banned), `${l.locale} has "${banned}"`);
    // Not a document scanner: no "document" or "doc" in a listing that scans.
    if (all.some((w) => w === 'scan' || w === 'scanner')) assert.ok(!all.includes('document') && !all.includes('doc'), `${l.locale}: document scanner`);
    // "Transcribe" only next to handwriting or notes, so it never reads as audio.
    assert.ok(!l.keywords.split(',').includes('transcribe'), `${l.locale}: transcribe in keywords`);
    for (const field of [l.name, l.subtitle])
      if (/transcribe/i.test(field)) assert.ok(/handwrit|notes/i.test(field), `${l.locale}: "${field}"`);
  }
});

test('store: every target phrase sits whole in a name or subtitle', () => {
  const fields = [
    ...listings().flatMap((l) => [l.name, l.subtitle]),
    under('## Name ('),
    under('## Subtitle ('),
    under('### Name ('),
    under('### Subtitle ('),
  ].map((f) => words(f).join(' '));
  for (const phrase of ['transcribe', 'image to text', 'handwriting to text', 'text scanner', 'ocr', 'scan text', 'ocr scanner', 'picture to text', 'handwritten notes'])
    assert.ok(fields.some((f) => ` ${f} `.includes(` ${phrase} `)), `"${phrase}" is not whole in any name or subtitle`);
});

test('store: en-US and es-MX stay exactly as they were in 1.0.1', () => {
  assert.equal(under('## Name ('), 'Image to Text: Handwriting OCR');
  assert.equal(under('## Subtitle ('), 'Text Scanner, Copy & Export');
  assert.equal(under('## Keywords ('), 'photo,picture,scan,notes,document,pdf,transcribe,handwritten,live,camera,screenshot,reader,word,doc');
  assert.equal(under('### Name ('), 'OCR Scanner: Picture to Text');
  assert.equal(under('### Subtitle ('), 'Transcribe Handwriting & Notes');
  assert.equal(under('### Keywords ('), 'image,document,photo,scan,handwritten,pdf,convert,reader,whiteboard,receipt,cursive,live,letter,book');
});

test('store: no em dashes in the store text', () => {
  assert.ok(!md.includes('\u2014'));
});
