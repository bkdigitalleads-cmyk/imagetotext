// Unit checks for the pure logic: paragraph grouping, Clean up, the page
// model, the safe fixes, the second pass, the nudge, page outlines, the
// daily quota and the trial rules. Run with `npm test` (Node 22+
// strips the TypeScript types itself).
process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const P = await import('../modules/vision-ocr/src/paragraphs.ts');
const T = await import('../src/text.ts');
const Q = await import('../src/quota.ts');
const O = await import('../src/offer.ts');
const A = await import('../src/accuracy.ts');

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

test('orderLines: pieces of one row go left to right and merge across a small gap; separate rows stay apart', () => {
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

// ---------- safe fixes (build 2) ----------

test('fixes: a lone I or l before a unit in capitals, or before -INCH, is the number 1', () => {
  assert.equal(T.fixLine('I TABLESPOON OLIVE OIL'), '1 TABLESPOON OLIVE OIL');
  assert.equal(T.fixLine('l CUP chicken stock'), '1 CUP chicken stock');
  assert.equal(T.fixLine('2 (I-INCH-THICK) STEAKS'), '2 (1-INCH-THICK) STEAKS');
  assert.equal(T.fixLine('I-INCH-THICK'), '1-INCH-THICK');
  assert.equal(T.fixLine('I ½ CUPS FLOUR'), '1 ½ CUPS FLOUR');
  assert.equal(T.fixLine('I 3/4 TEASPOONS SALT'), '1 3/4 TEASPOONS SALT');
  assert.equal(T.fixLine('I¼ POUNDS'), '1¼ POUNDS');
});

test('fixes: nothing changes where I is a word', () => {
  assert.equal(T.fixLine('I think I can'), 'I think I can');
  assert.equal(T.fixLine('I CAN SEE IT'), 'I CAN SEE IT');
  assert.equal(T.fixLine('I cup my hands'), 'I cup my hands'); // a unit in lowercase is not enough
  assert.equal(T.fixLine('Item I'), 'Item I');
  assert.equal(T.fixLine('INCH BY INCH'), 'INCH BY INCH');
  assert.equal(T.fixLine('Il faut'), 'Il faut');
});

test('fixes: pieced fractions become one fraction character; a % or a plain 3/4 is left alone', () => {
  assert.equal(T.normalizeFractions('1\u20442 cup'), '½ cup');
  assert.equal(T.normalizeFractions('¹/₂ tsp and ³⁄₄ cup'), '½ tsp and ¾ cup');
  assert.equal(T.normalizeFractions('5\u204416'), '5/16'); // no single character: plain digits
  assert.equal(T.normalizeFractions('3/4 cup'), '3/4 cup');
  assert.equal(T.normalizeFractions('%4 cup'), '%4 cup');
  assert.equal(T.normalizeFractions('%% cup'), '%% cup');
  assert.equal(T.normalizeFractions('11\u20442'), '11/2'); // never guesses a mixed number
  assert.equal(T.fixLine('  1\u20444  CUP  '), '  ¼  CUP  '); // spacing kept
});

test('fixes: the page model applies them in raw and cleaned text, and edits are never touched', () => {
  const paras = [[line('I TABLESPOON 1\u20442 tsp', { y: 100 })]];
  assert.equal(T.modelText(T.buildRuns(paras, false)), '1 TABLESPOON ½ tsp');
  assert.equal(T.modelText(T.buildRuns(paras, true)), '1 TABLESPOON ½ tsp');
  assert.equal(T.rawText(paras), '1 TABLESPOON ½ tsp');
  assert.equal(T.cleanText('I TABLESPOON'), 'I TABLESPOON'); // cleanText is also used on the person's own edits
});

// ---------- second pass (build 2) ----------

test('second pass: picks low-confidence and small lines, least sure first when capped, in line order', () => {
  const lines = [
    line('fine and big', { y: 100, h: 40, confidence: 1 }),
    line('unsure', { y: 200, confidence: 0.5 }),
    line('tiny print', { y: 300, h: 12, confidence: 1 }), // 12/1400 = 0.86% of the height
    line('very unsure', { y: 400, confidence: 0.3 }),
    line('   ', { y: 500, confidence: 0.1 }),
  ];
  assert.deepEqual(A.pickSecondPass(lines), [1, 2, 3]);
  assert.deepEqual(A.pickSecondPass(lines, 2), [1, 3]); // the two least confident
  assert.deepEqual(A.pickSecondPass(lines, 0), []);
  assert.equal(A.SECOND_PASS_CONFIDENCE, 0.6);
  assert.equal(A.SECOND_PASS_MAX_LINES, 40);
  const many = Array.from({ length: 60 }, (_, i) => line(`line ${i}`, { y: i * 20, confidence: 0.2 }));
  assert.equal(A.pickSecondPass(many).length, 40);
});

test('second pass: a more confident reading replaces the text and words, the line box stays', () => {
  const l = line('%4 CUP', { y: 100, confidence: 0.3, alternatives: ['%4 CUR'] });
  const words = [{ start: 0, end: 1, box: { x: 0.1, y: 0.07, width: 0.02, height: 0.02 } }];
  const merged = A.mergeSecondPass([l, l], [
    { index: 0, text: '¾ CUP', confidence: 0.9, words, alternatives: [] },
    { index: 1, text: 'x CUP', confidence: 0.2, words, alternatives: [] }, // less sure: kept as it was
  ]);
  assert.equal(merged[0].text, '¾ CUP');
  assert.equal(merged[0].confidence, 0.9);
  assert.deepEqual(merged[0].box, l.box);
  assert.deepEqual(merged[0].words, words);
  assert.equal(merged[1].text, '%4 CUP');
  // Empty readings and unknown indexes are ignored.
  assert.deepEqual(A.mergeSecondPass([l], [{ index: 0, text: ' ', confidence: 1, words: [], alternatives: [] }, { index: 5, text: 'x', confidence: 1, words: [], alternatives: [] }]), [l]);
});

// ---------- the nudge (build 2) ----------

test('nudge: shows when more than 10% of the words are on unsure lines', () => {
  const good = Array.from({ length: 9 }, (_, i) => line('one two three four five', { y: i * 50, confidence: 0.9 }));
  assert.equal(A.shouldNudge([...good, line('six seven eight nine ten', { y: 600, confidence: 0.5 })]), false); // exactly 10%
  assert.equal(A.shouldNudge([...good, line('six seven eight nine ten eleven', { y: 600, confidence: 0.5 })]), true);
  assert.equal(A.shouldNudge([]), false);
  assert.equal(A.unsureShare([line('- , .', { y: 0, confidence: 0.1 }), line('word', { y: 50, confidence: 0.9 })]), 0); // punctuation is not a word
});

// ---------- page outlines (build 2) ----------

const pt = (x, y) => ({ x, y });

test('outline: corners in any order come back top-left, top-right, bottom-right, bottom-left', () => {
  const q = A.orderQuad([pt(900, 1200), pt(100, 150), pt(120, 1180), pt(880, 130)]);
  assert.deepEqual(q, [pt(100, 150), pt(880, 130), pt(900, 1200), pt(120, 1180)]);
  assert.equal(A.isConvex(q), true);
  assert.equal(A.isConvex([pt(0, 0), pt(10, 10), pt(10, 0), pt(0, 10)]), false); // a bow tie
  assert.equal(A.quadArea([pt(0, 0), pt(10, 0), pt(10, 5), pt(0, 5)]), 50);
});

test('outline: a found page is used only when confident, big enough, and not the whole photo', () => {
  const size = { width: 1000, height: 1500 };
  const page = [pt(100, 150), pt(880, 130), pt(900, 1300), pt(120, 1320)];
  assert.equal(A.usablePage({ found: true, confidence: 0.9, quad: page }, size), true);
  assert.equal(A.usablePage({ found: true, confidence: 0.4, quad: page }, size), false);
  assert.equal(A.usablePage({ found: false, confidence: 0.9, quad: page }, size), false);
  assert.equal(A.usablePage({ found: true, confidence: 0.9, quad: [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)] }, size), false); // too small
  assert.equal(A.usablePage({ found: true, confidence: 0.9, quad: [pt(0, 0), pt(1000, 0), pt(1000, 1500), pt(0, 1500)] }, size), false); // the whole photo
});

test('outline: a quarter turn and back gives the same corners', () => {
  const size = { width: 1000, height: 1500 };
  const q = A.orderQuad([pt(100, 150), pt(880, 130), pt(900, 1300), pt(120, 1320)]);
  const once = A.turnQuad(q, size); // now on a 1500 x 1000 image
  assert.deepEqual(once[0], pt(180, 120)); // the old bottom-left is the new top-left
  assert.deepEqual(A.unturnQuad(once, size, 1), q);
  let t = q;
  let s = size;
  for (let k = 0; k < 3; k++) {
    t = A.turnQuad(t, s);
    s = { width: s.height, height: s.width };
  }
  assert.deepEqual(A.unturnQuad(t, size, 3), q);
  assert.deepEqual(A.unturnQuad(q, size, 0), q);
  assert.deepEqual(A.clampQuad([pt(-5, 10), pt(1010, 0), pt(990, 1600), pt(0, 1500)], size)[2], pt(990, 1500));
});

// ---------- handwriting line order (build 2) ----------

// Brian's handwritten list from the build 1 test, one item per line, left
// aligned. The second item was cut from his report ("..."), so a stand-in
// is used for it. Boxes are written the way Vision returns them: fractions
// with the origin at the BOTTOM left, and in Vision's order for this page,
// bottom line first. Handwriting: line heights and gaps are uneven.
const DASH_LIST = [
  '- Pick up dry cleaning Tuesday after 5',
  '- Call plumber about the kitchen sink',
  '- Eggs, bread, ground beef',
  '- Rent due 11/1, $2,450',
  '- Meeting w/ Sam moved to 3:30pm',
  "- Don't forget passport renewal",
];
const visionList = () => {
  // top of each line in top-left fractions, and its height: uneven on purpose
  const rows = [
    [0.12, 0.034], [0.178, 0.029], [0.236, 0.037], [0.302, 0.031], [0.356, 0.035], [0.421, 0.03],
  ];
  return DASH_LIST.map((text, i) => {
    const [top, h] = rows[i];
    const width = 0.4 + (text.length % 7) * 0.05;
    const x = 0.08 + (i % 3) * 0.004; // left aligned, a hand's wobble
    return { text, confidence: 0.8, alternatives: [], words: [], box: { x, y: 1 - top - h, width, height: h } }; // bottom-left origin
  }).reverse(); // Vision's order: bottom to top
};

test('handwriting: Vision boxes flipped to top-left, the dash list comes out as six lines top to bottom', () => {
  const fromVision = visionList().map((l) => ({ ...l, box: P.flipVisionBox(l.box) }));
  // Every flipped box sits where the page has it (the Swift module does the same flip).
  assert.ok(Math.abs(fromVision[5].box.y - 0.12) < 1e-9);
  const ordered = P.orderLines(fromVision, 3024, 4032);
  assert.deepEqual(ordered.map((l) => l.text), DASH_LIST);
  const paras = P.groupParagraphs(ordered, 3024, 4032);
  assert.equal(paras.length, 6); // every list item is its own paragraph
  const groups = paras.map((p) => p.lines);
  // Never joined to the line before, raw or cleaned up.
  assert.deepEqual(T.modelText(T.buildRuns(groups, false)).split(/\n+/), DASH_LIST);
  assert.deepEqual(T.modelText(T.buildRuns(groups, true)).split(/\n+/), DASH_LIST);
});

test('handwriting: list markers include dashes with or without a space, bullets, checkboxes, numbers', () => {
  for (const t of ['- Eggs', '-Eggs', '\u2013 Eggs', '\u2022 Eggs', '* Eggs', '[ ] Eggs', '[x] Eggs', '\u2610 Eggs', '1. Eggs', '2) Eggs', 'a) Eggs'])
    assert.equal(P.LIST_MARKER.test(t), true, t);
  for (const t of ['-5 degrees', 'Eggs - bread', '1.5 cups', 'well-known']) assert.equal(P.LIST_MARKER.test(t), false, t);
  assert.equal(P.LIST_MARKER.source, T.LIST_MARKER.source); // the two copies never drift
  assert.equal(T.cleanText('Shopping\n-Eggs\n-Bread\nand butter'), 'Shopping\n-Eggs\n-Bread and butter');
});

test('handwriting: the paragraph gap is relative to the page median line height (under 0.6 joins)', () => {
  assert.equal(P.PARAGRAPH_GAP, 0.6);
  // Large handwriting: 60 px lines. A 30 px gap (0.5) is the same paragraph, a 40 px gap (0.67) is not.
  const big = (gap) => [line('first line of a note that runs on', { y: 100, h: 60 }), line('and keeps going here', { y: 160 + gap, h: 60 })];
  assert.equal(P.groupParagraphs(big(30), W, H).length, 1);
  assert.equal(P.groupParagraphs(big(40), W, H).length, 2);
});

test('handwriting: a line written on a slant that Vision splits in two comes out as one line', () => {
  // "Leaving for Bedford Hills" climbs to the right; "on 6:40 train" continues it a little higher.
  const a = line('Leaving for Bedford Hills', { x: 100, y: 520, w: 470, h: 60 });
  const b = line('on 6:40 train', { x: 590, y: 480, w: 260, h: 60 });
  const below = line('Back by Sunday', { x: 100, y: 640, w: 300, h: 60 });
  const out = P.orderLines([below, b, a], W, H);
  assert.deepEqual(out.map((l) => l.text), ['Leaving for Bedford Hills on 6:40 train', 'Back by Sunday']);
});

test('reading order: two columns of running text are read one after the other; a receipt stays in rows', () => {
  const col = (x, i, text) => line(text, { x, y: 100 + i * 42, w: 380 });
  const lines = [col(560, 0, 'right one'), col(60, 0, 'left one'), col(560, 1, 'right two'), col(60, 1, 'left two'), col(60, 2, 'left three')];
  // Columns that share rows look like a table, so give the right column its own rhythm.
  lines[0].box.y += 20 / H;
  lines[2].box.y += 20 / H;
  assert.deepEqual(P.orderLines(lines, W, H).map((l) => l.text), ['left one', 'left two', 'left three', 'right one', 'right two']);
  const receipt = [line('9.49', { x: 800, y: 100, w: 80 }), line('AA batteries', { x: 100, y: 100, w: 240 }), line('3.25', { x: 800, y: 142, w: 80 }), line('Picture wire', { x: 100, y: 142, w: 240 })];
  assert.deepEqual(P.orderLines(receipt, W, H).map((l) => l.text), ['AA batteries', '9.49', 'Picture wire', '3.25']);
});

// ---------- focus and blur (build 2) ----------

test('focus: a tap on the preview maps to the camera point, center to center, corners to corners', () => {
  const view = { width: 393, height: 852 }; // narrower than the 3:4 photo: cropped at the sides
  assert.deepEqual(A.focusPoint({ x: 196.5, y: 426 }, view), { x: 0.5, y: 0.5 });
  const topLeftShown = A.focusPoint({ x: 0, y: 0 }, view);
  assert.equal(topLeftShown.x, 0); // top of the screen is the camera's left
  assert.ok(topLeftShown.y < 1 && topLeftShown.y > 0.5); // left edge of the screen is cropped photo, toward the camera's bottom
  assert.deepEqual(A.focusPoint({ x: 393, y: 852 }, { width: 393, height: 524 }), { x: 1, y: 0 }); // exactly 3:4: no crop
  assert.equal(A.FOCUS_HOLD_SECONDS, 3);
});

test('blur: below the threshold is blurry; unknown or zero is not', () => {
  assert.equal(A.isBlurry(A.BLUR_THRESHOLD - 1), true);
  assert.equal(A.isBlurry(A.BLUR_THRESHOLD), false);
  assert.equal(A.isBlurry(null), false);
  assert.equal(A.isBlurry(undefined), false);
  assert.equal(A.isBlurry(0), false);
});
