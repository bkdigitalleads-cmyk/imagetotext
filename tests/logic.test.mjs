// Unit checks for the pure logic: paragraph grouping, Clean up, the page
// model, the daily quota and the trial rules. Run with `npm test` (Node 22+
// strips the TypeScript types itself).
process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const P = await import('../modules/vision-ocr/src/paragraphs.ts');
const T = await import('../src/text.ts');
const Q = await import('../src/quota.ts');
const O = await import('../src/offer.ts');

// A page 1000 x 1400 px. Lines are 30 px tall with 12 px between them.
const W = 1000;
const H = 1400;
const line = (text, { x = 100, y, w = 760, h = 30, confidence = 1, alternatives = [], words } = {}) => ({
  text,
  confidence,
  alternatives,
  box: { x: x / W, y: y / H, width: w / W, height: h / H },
  words: words ?? [],
});
const ys = (i, start = 100) => start + i * 42;
const texts = (paras) => paras.map((p) => p.lines.map((l) => l.text));

// ---------- paragraphs ----------

test('paragraphs: a blank line of space starts a new paragraph', () => {
  const lines = [
    line('The meeting moved to', { y: ys(0) }),
    line('Thursday at ten.', { y: ys(1), w: 420 }),
    line('Bring the draft and', { y: ys(3) }),
    line('the budget sheet.', { y: ys(4), w: 380 }),
  ];
  assert.deepEqual(texts(P.groupParagraphs(lines, W, H)), [
    ['The meeting moved to', 'Thursday at ten.'],
    ['Bring the draft and', 'the budget sheet.'],
  ]);
});

test('paragraphs: a short last line ending a sentence closes the paragraph even with normal spacing', () => {
  const lines = [
    line('First paragraph runs across the', { y: ys(0) }),
    line('whole width and then ends here.', { y: ys(1), w: 300 }),
    line('Second one starts on the next line', { y: ys(2) }),
    line('with no extra space above it', { y: ys(3) }),
  ];
  assert.deepEqual(texts(P.groupParagraphs(lines, W, H)), [
    ['First paragraph runs across the', 'whole width and then ends here.'],
    ['Second one starts on the next line', 'with no extra space above it'],
  ]);
});

test('paragraphs: an indented first line starts a paragraph; the flush-left lines after it stay in it', () => {
  const lines = [
    line('Dear Sam, thanks for the notes', { x: 160, y: ys(0), w: 700 }),
    line('you sent over on Monday and the', { y: ys(1) }),
    line('photos too', { y: ys(2) }),
    line('I read them twice and I agree', { x: 160, y: ys(3), w: 700 }),
    line('with most of it', { y: ys(4) }),
  ];
  assert.deepEqual(texts(P.groupParagraphs(lines, W, H)), [
    ['Dear Sam, thanks for the notes', 'you sent over on Monday and the', 'photos too'],
    ['I read them twice and I agree', 'with most of it'],
  ]);
});

test('paragraphs: list items each stand alone; a heading in bigger letters is its own paragraph', () => {
  const lines = [
    line('Groceries', { y: 60, h: 52, w: 300 }),
    line('- eggs', { y: ys(1), w: 200 }),
    line('- oat milk', { y: ys(2), w: 260 }),
    line('2) bread', { y: ys(3), w: 220 }),
  ];
  assert.deepEqual(texts(P.groupParagraphs(lines, W, H)), [['Groceries'], ['- eggs'], ['- oat milk'], ['2) bread']]);
});

test('paragraphs: going back up the page (a second column) starts a paragraph; empty input is empty', () => {
  const lines = [
    line('left column one', { x: 60, y: ys(0), w: 400 }),
    line('left column two', { x: 60, y: ys(1), w: 400 }),
    line('right column one', { x: 540, y: ys(0), w: 400 }),
  ];
  assert.equal(P.groupParagraphs(lines, W, H).length, 2);
  assert.deepEqual(P.groupParagraphs([], W, H), []);
});

test('orderLines: pieces of one row go left to right and merge across a small gap; columns keep Vision order', () => {
  const right = line('world', { x: 330, y: 100, w: 150, words: [{ start: 0, end: 5, box: { x: 0.33, y: 0.07, width: 0.15, height: 0.02 } }] });
  const left = line('hello', { x: 100, y: 102, w: 200, words: [{ start: 0, end: 5, box: { x: 0.1, y: 0.07, width: 0.2, height: 0.02 } }] });
  const out = P.orderLines([right, left], W, H);
  assert.equal(out.length, 1);
  assert.equal(out[0].text, 'hello world');
  assert.deepEqual(out[0].words.map((w) => [w.start, w.end]), [[0, 5], [6, 11]]);
  // Far apart on one row (a receipt: item ... price) stays two lines, left first.
  const price = line('4.50', { x: 800, y: 300, w: 80 });
  const item = line('Coffee', { x: 100, y: 300, w: 120 });
  assert.deepEqual(P.orderLines([price, item], W, H).map((l) => l.text), ['Coffee', '4.50']);
  // Different rows are never reordered.
  const a = line('second column top', { x: 540, y: 100, w: 400 });
  const b = line('first column bottom', { x: 60, y: 600, w: 400 });
  assert.deepEqual(P.orderLines([a, b], W, H).map((l) => l.text), ['second column top', 'first column bottom']);
});

// ---------- Clean up ----------

test('clean up: joins broken lines into paragraphs and keeps paragraphs apart', () => {
  const raw = 'The quick brown\nfox jumps over\nthe lazy dog.\n\nA second\nparagraph.';
  assert.equal(T.cleanText(raw), 'The quick brown fox jumps over the lazy dog.\n\nA second paragraph.');
});

test('clean up: fixes double spaces, tabs, stray spaces before commas and periods, and trailing spaces', () => {
  assert.equal(T.cleanText('Hello  ,   world .\tAgain   here  '), 'Hello, world. Again here');
  assert.equal(T.cleanText('Price 4 .50'), 'Price 4 .50'); // a period inside a number is left alone
});

test('clean up: rejoins a word cut with a hyphen at a line end, keeps real hyphens', () => {
  assert.equal(T.cleanText('an infor-\nmation sheet'), 'an information sheet');
  assert.equal(T.cleanText('a well-known\nfact'), 'a well-known fact');
  assert.equal(T.cleanText('Pre-\nOrder'), 'Pre- Order'); // capital after: not a cut word
});

test('clean up: list items keep their own lines; extra blank lines collapse; Windows line ends', () => {
  assert.equal(T.cleanText('To do:\n- call Ana\n- book room\nfor Friday\n\n\n\nDone.'), 'To do:\n- call Ana\n- book room for Friday\n\nDone.');
  assert.equal(T.cleanText('one\r\ntwo\r\n\r\nthree'), 'one two\n\nthree');
});

test('clean up: running it twice changes nothing; empty stays empty', () => {
  const samples = ['a  b\nc-\nd\n\n- x\n- y', 'Hello , world .\n\n\nNext   one', '', '   \n  '];
  for (const s of samples) assert.equal(T.cleanText(T.cleanText(s)), T.cleanText(s));
  assert.equal(T.cleanText('  \n \n'), '');
});

// ---------- the page model ----------

const page = () => [
  [line('Call the  plumber', { y: 100 }), line('before Fri-', { y: 142 }), line('day noon , please', { y: 184 })],
  [line('Keys under the mat.', { y: 300 })],
];

test('page model: raw text is exactly the recognized lines, paragraphs a blank line apart', () => {
  const paras = page();
  assert.equal(T.modelText(T.buildRuns(paras, false)), T.rawText(paras));
  assert.equal(T.rawText(paras), 'Call the  plumber\nbefore Fri-\nday noon , please\n\nKeys under the mat.');
});

test('page model: with Clean up it matches cleanText of the raw text', () => {
  const paras = page();
  const clean = T.modelText(T.buildRuns(paras, true));
  assert.equal(clean, T.cleanText(T.rawText(paras)));
  assert.equal(clean, 'Call the plumber before Friday noon, please\n\nKeys under the mat.');
});

test('page model: words get their own boxes from Vision, and unsure words are marked', () => {
  const l = line('pick up milk', {
    y: 100,
    alternatives: ['pick up silk'],
    words: [
      { start: 0, end: 4, box: { x: 0.1, y: 0.1, width: 0.1, height: 0.02 } },
      { start: 5, end: 7, box: { x: 0.21, y: 0.1, width: 0.05, height: 0.02 } },
      { start: 8, end: 12, box: { x: 0.27, y: 0.1, width: 0.1, height: 0.02 } },
    ],
  });
  const runs = T.buildRuns([[l]], true);
  assert.deepEqual(runs.map((r) => r.text), ['pick', 'up', 'milk']);
  assert.deepEqual(runs.map((r) => r.unsure), [false, false, true]);
  assert.equal(runs[2].box.x, 0.27);
  // A whole line read with low confidence is unsure throughout; punctuation never is.
  assert.equal(T.isUnsure('anything', { confidence: 0.3, alternatives: [] }), true);
  assert.equal(T.isUnsure('...', { confidence: 0.3, alternatives: [] }), false);
  assert.equal(T.isUnsure('Milk,', { confidence: 1, alternatives: ['milk'] }), false);
});

// ---------- counts and names ----------

test('words and the copy line: punctuation alone is not a word; 1 word, 1,204 words', () => {
  assert.equal(T.countWords('Hello, world - again 42 !'), 4);
  assert.equal(T.copiedLine(1), 'Copied. 1 word.');
  assert.equal(T.copiedLine(412), 'Copied. 412 words.');
  assert.equal(T.copiedLine(1204), 'Copied. 1,204 words.');
});

test('titles and file names come from the first line with letters', () => {
  assert.equal(T.firstLine('\n  ---\n  Meeting notes  \nsecond'), 'Meeting notes');
  assert.equal(T.fileBaseName('Q3: plan / budget?\nmore', '2026-10-22'), 'Q3 plan budget');
  assert.equal(T.fileBaseName('...', '2026-10-22'), 'Scan 2026-10-22');
  assert.ok(T.fileBaseName('word '.repeat(30), '2026-10-22').length <= 48);
});

test('exports: .txt joins pages; .md escapes formatting but keeps lists and puts a rule between pages', () => {
  assert.equal(T.toTxt(['one', '  ', 'two']), 'one\n\ntwo\n');
  assert.equal(T.mdEscape('# not a heading\n* item\n- item\n2 * 3 = 6\nsnake_case\n---'), '\\# not a heading\n* item\n- item\n2 \\* 3 = 6\nsnake\\_case\n\\---');
  assert.equal(T.toMarkdown(['a', 'b']), 'a\n\n---\n\nb\n');
});

test('moveItem: moves a page and clamps out-of-range targets', () => {
  assert.deepEqual(T.moveItem(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(T.moveItem(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  assert.deepEqual(T.moveItem(['a', 'b', 'c'], 1, 9), ['a', 'c', 'b']);
  assert.deepEqual(T.moveItem(['a', 'b'], 5, 0), ['a', 'b']);
});

// ---------- the daily quota ----------

test('quota: 3 free recognitions a day, counted on the local calendar day', () => {
  const today = Q.dayKey(new Date(2026, 10, 1, 23, 30).getTime()); // Nov 1, the day DST ends
  assert.equal(today, '2026-11-01');
  let rec = Q.parseQuota(null);
  assert.equal(Q.remainingToday(rec, today, false), 3);
  rec = Q.consume(rec, today, 2);
  assert.equal(Q.remainingToday(rec, today, false), 1);
  rec = Q.consume(rec, today, 1);
  assert.equal(Q.remainingToday(rec, today, false), 0);
  rec = Q.consume(rec, today, 1);
  assert.equal(Q.remainingToday(rec, today, false), 0); // never negative
  // The next day starts over.
  assert.equal(Q.remainingToday(rec, '2026-11-02', false), 3);
  assert.deepEqual(Q.consume(rec, '2026-11-02', 1), { day: '2026-11-02', used: 1 });
  // Pro has no limit.
  assert.equal(Q.remainingToday(rec, today, true), Infinity);
});

test('quota: unreadable or odd stored records start fresh', () => {
  assert.deepEqual(Q.parseQuota('not json'), { day: '', used: 0 });
  assert.deepEqual(Q.parseQuota('{"day":"2026-10-22","used":-4}'), { day: '2026-10-22', used: 0 });
  assert.deepEqual(Q.parseQuota('{"day":"2026-10-22","used":"2"}'), { day: '2026-10-22', used: 2 });
});

test('quota: batches of 2 pages free; the gate says which paywall to show', () => {
  assert.equal(Q.gateNewPage({ isPro: false, pages: 0, remaining: 3 }), 'ok');
  assert.equal(Q.gateNewPage({ isPro: false, pages: 1, remaining: 1 }), 'ok');
  assert.equal(Q.gateNewPage({ isPro: false, pages: 2, remaining: 3 }), 'batch'); // page 3 of a batch
  assert.equal(Q.gateNewPage({ isPro: false, pages: 0, remaining: 0 }), 'limit');
  assert.equal(Q.gateNewPage({ isPro: true, pages: 40, remaining: 0 }), 'ok');
  assert.equal(Q.pagesAllowed({ isPro: false, pages: 0, remaining: 3 }), 2);
  assert.equal(Q.pagesAllowed({ isPro: false, pages: 1, remaining: 3 }), 1);
  assert.equal(Q.pagesAllowed({ isPro: false, pages: 0, remaining: 1 }), 1);
  assert.equal(Q.pagesAllowed({ isPro: false, pages: 3, remaining: 3 }), 0);
  assert.equal(Q.pagesAllowed({ isPro: true, pages: 3, remaining: 0 }), Infinity);
});

// ---------- trial and plans ----------

const trial3 = { price: 0, periodNumberOfUnits: 3, periodUnit: 'DAY' };

test('trial: "3 days free" only for a free intro offer this Apple ID can still get', () => {
  assert.equal(O.trialLabelFrom(trial3, true), '3 days free');
  assert.equal(O.trialLabelFrom(trial3, false), null);
  assert.equal(O.trialLabelFrom({ ...trial3, price: 0.99 }, true), null); // a paid intro is not a free trial
  assert.equal(O.trialLabelFrom(null, true), null);
  assert.equal(O.trialLabelFrom({ price: 0, periodNumberOfUnits: 1, periodUnit: 'WEEK' }, true), '1 week free');
  assert.equal(O.trialLength(trial3), '3 days');
});

test('trial reminder: a day before the trial ends; sandbox-short or unknown ends fall back to 2 days out', () => {
  const now = new Date(2026, 9, 22, 12, 0).getTime();
  const DAY = 86_400_000;
  assert.equal(O.trialReminderAt(now + 3 * DAY, now), now + 2 * DAY);
  assert.equal(O.trialReminderAt(now + 5 * 60_000, now), now + 2 * DAY);
  assert.equal(O.trialReminderAt(null, now), now + 2 * DAY);
});

test('plans: weekly preselected on the onboarding paywall, yearly in the app, whatever the store returns', () => {
  assert.equal(O.preselect(['WEEKLY', 'ANNUAL'], true), 'WEEKLY');
  assert.equal(O.preselect(['WEEKLY', 'ANNUAL'], false), 'ANNUAL');
  assert.equal(O.preselect(['ANNUAL'], true), 'ANNUAL');
  assert.equal(O.preselect(['WEEKLY'], false), 'WEEKLY');
  assert.equal(O.preselect([], false), null);
  assert.deepEqual(O.planOrder(false), ['ANNUAL', 'WEEKLY']);
  assert.equal(O.yearlySavingPct(4.99, 29.99), 88);
  assert.equal(O.yearlySavingPct(0.5, 29.99), null);
});
