// Unit checks for the pure logic: reading order, paragraph grouping, Clean
// up, the page model, the safe fixes, the second pass, the nudge, page
// outlines, the daily quota and the trial rules. Brian's real outputs from
// his TestFlight passes are fixtures here (build 3). Run with `npm test` (Node 22+
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
/**
 * A line from its four corners in pixels (top-left, top-right, bottom-right,
 * bottom-left) on an image `iw` x `ih`, the way the Swift module returns it:
 * an upright box around it and the corners, both as top-left fractions,
 * kept inside the image.
 */
const fromCorners = (text, pts, { iw = W, ih = H, confidence = 1, alternatives = [], ...rest } = {}) => {
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const fx = pts.map((p) => clamp(p[0] / iw));
  const fy = pts.map((p) => clamp(p[1] / ih));
  const x = Math.min(...fx);
  const y = Math.min(...fy);
  return {
    text,
    confidence,
    alternatives,
    words: [],
    box: { x, y, width: Math.max(...fx) - x, height: Math.max(...fy) - y },
    corners: [0, 1, 2, 3].flatMap((i) => [fx[i], fy[i]]),
    ...rest,
  };
};
/** A line `length` px long and `h` tall whose left end's middle is (x, y), running at `deg` (negative climbs to the right). */
const slab = (text, { x, y, length, h, deg, ...opts }) => {
  const a = (deg * Math.PI) / 180;
  const [ux, uy] = [Math.cos(a), Math.sin(a)];
  const [nx, ny] = [-uy, ux]; // across the line, pointing down the page
  const tl = [x - (nx * h) / 2, y - (ny * h) / 2];
  const bl = [x + (nx * h) / 2, y + (ny * h) / 2];
  return fromCorners(text, [tl, [tl[0] + ux * length, tl[1] + uy * length], [bl[0] + ux * length, bl[1] + uy * length], bl], opts);
};
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

// A cookbook page's body text (written for these checks): two paragraphs of
// wrapped lines, every line running to the column's edge but the last.
const COOKBOOK = [
  ['Pat the steaks dry with paper towels and season', 'both sides well with salt and pepper. Let them', 'sit on the counter for twenty minutes so they', 'cook evenly.'],
  ['Heat the oil in a heavy skillet until it shimmers,', 'then lay the steaks in and leave them alone for', 'four minutes. Turn once and baste with butter', 'for the last minute.'],
];
const COOKBOOK_CLEAN =
  'Pat the steaks dry with paper towels and season both sides well with salt and pepper. Let them sit on the counter for twenty minutes so they cook evenly.\n\n' +
  'Heat the oil in a heavy skillet until it shimmers, then lay the steaks in and leave them alone for four minutes. Turn once and baste with butter for the last minute.';
/** Printed lines, 30 px tall, 16 px per letter, one paragraph after another with a blank line of space between. */
const printed = (paras, { x = 100, pitch = 42, letter = 16 } = {}) => {
  let y = 100;
  return paras.flatMap((p) => {
    const out = p.map((t) => {
      const l = line(t, { x, y, w: t.length * letter });
      y += pitch;
      return l;
    });
    y += pitch;
    return out;
  });
};

test('clean up: a cookbook body joins into its two paragraphs (the lines ran out of room)', () => {
  assert.equal(T.cleanText(COOKBOOK.map((p) => p.join('\n')).join('\n\n')), COOKBOOK_CLEAN);
  const lines = printed(COOKBOOK);
  const paras = P.groupParagraphs(P.orderLines(lines, W, H), W, H).map((p) => p.lines);
  assert.equal(paras.length, 2);
  assert.equal(T.modelText(T.buildRuns(paras, true)), COOKBOOK_CLEAN);
  assert.equal(T.modelText(T.buildRuns(paras, false)), COOKBOOK.map((p) => p.join('\n')).join('\n\n'));
});

// Brian's trip-up sheet, handwritten: a line each, uneven sizes. Clean up
// used to run them all together.
const TRIP_UP = [
  'THE QUICK BROWN FOX',
  'the quick brown fox jumps',
  '915-555-0142, brian.k@example.com',
  '3/4 cup, 1 1/2 tsp, 350F',
  'bring the red blue folder',
  'coffe $4.50',
  'bagel $2.25',
  'total $6.75',
];
const tripUpLines = () => {
  const sizes = [[520, 52], [560, 38], [760, 34], [600, 42], [590, 40], [300, 44], [290, 36], [300, 41]]; // capitals tallest, as written
  let y = 120;
  return TRIP_UP.map((t, i) => {
    const [w, h] = sizes[i];
    const l = line(t, { x: 90 + ((i * 7) % 11), y, w, h, confidence: 1 });
    y += h + 14;
    return l;
  });
};

test('clean up: the trip-up sheet keeps every line on its own, raw and cleaned up', () => {
  const ordered = P.orderLines(tripUpLines(), W, H);
  assert.deepEqual(ordered.map((l) => l.text), TRIP_UP);
  const paras = P.groupParagraphs(ordered, W, H).map((p) => p.lines);
  // Recognized text gets the safe fixes ("3/4" read as one token is "¾"); nothing else changes.
  const fixed = TRIP_UP.map(T.fixLine);
  assert.equal(fixed[3], '¾ cup, 1 ½ tsp, 350F');
  assert.deepEqual(T.modelText(T.buildRuns(paras, true)).split(/\n+/), fixed);
  assert.deepEqual(T.modelText(T.buildRuns(paras, false)).split(/\n+/), fixed);
  assert.deepEqual(T.cleanText(TRIP_UP.join('\n')).split('\n'), TRIP_UP);
  // Build 4: the sheet counts as handwriting, so Clean up never joins its lines at all.
  assert.equal(P.isHandwritten(ordered, W, H), true);
  assert.deepEqual(T.modelText(T.buildRuns(paras, true, { handwritten: true })).split(/\n+/), fixed);
});

test('clean up: a price list stays three lines', () => {
  const prices = ['coffe $4.50', 'bagel $2.25', 'total $6.75'];
  assert.equal(T.cleanText(prices.join('\n')), prices.join('\n'));
  const lines = prices.map((t, i) => line(t, { y: ys(i), w: 300 }));
  const paras = P.groupParagraphs(lines, W, H).map((p) => p.lines);
  assert.deepEqual(T.modelText(T.buildRuns(paras, true)).split(/\n+/), prices);
});

test('clean up: fixes double spaces, tabs, stray spaces before commas and periods, and trailing spaces', () => {
  assert.equal(T.cleanText('Hello  ,   world .\tAgain   here  '), 'Hello, world. Again here');
  assert.equal(T.cleanText('Price 4 .50'), 'Price 4 .50'); // a period inside a number is left alone
});

test('clean up: a word cut with a hyphen loses it only when the halves make one word', () => {
  assert.equal(T.joinPair('a handful of water-', 'cress'), 'a handful of watercress');
  assert.equal(T.joinPair('an infor-', 'mation sheet'), 'an information sheet');
  assert.equal(T.joinPair('a well-', 'known fact'), 'a well-known fact'); // a word that takes a hyphen keeps it
  assert.equal(T.joinPair('self-', 'made'), 'self-made');
  assert.equal(T.joinPair('Pre-', 'Order'), 'Pre-Order'); // capital after: the hyphen stays
  assert.equal(T.joinPair('pages 10-', '12'), 'pages 10- 12'); // not a cut word at all
  const raw = 'Toss the leaves with a big handful of water-\ncress and a squeeze of lemon, then add the well-\nknown trio of salt, pepper and good olive oil.';
  assert.equal(T.cleanText(raw), 'Toss the leaves with a big handful of watercress and a squeeze of lemon, then add the well-known trio of salt, pepper and good olive oil.');
});

test('clean up: list items keep their own lines; extra blank lines collapse; Windows line ends', () => {
  assert.equal(T.cleanText('To do:\n- call Ana\n- book room\nfor Friday\n\n\n\nDone.'), 'To do:\n- call Ana\n- book room for Friday\n\nDone.');
  assert.equal(T.cleanText('one\r\ntwo\r\n\r\nthree'), 'one\ntwo\n\nthree'); // short lines stay lines
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

test('page model: Clean up joins lines that fill the line box width, single spaces, hyphen rule', () => {
  // The page model measures the real line boxes; cleanText (for the person's own edits) counts letters.
  const paras = page();
  assert.equal(T.modelText(T.buildRuns(paras, true)), 'Call the plumber before Friday noon, please\n\nKeys under the mat.');
  const book = P.groupParagraphs(printed(COOKBOOK), W, H).map((p) => p.lines);
  assert.equal(T.modelText(T.buildRuns(book, true)), T.cleanText(T.rawText(book)));
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
  // Never a digit next to a fraction: these stay visibly odd rather than become a wrong number.
  assert.equal(T.fixLine('I ½ CUPS FLOUR'), 'I ½ CUPS FLOUR');
  assert.equal(T.fixLine('I 3/4 TEASPOONS SALT'), 'I ¾ TEASPOONS SALT');
  assert.equal(T.fixLine('I¼ POUNDS'), 'I¼ POUNDS');
  assert.equal(T.fixLine('l¼ TEASPOON'), 'l¼ TEASPOON');
});

test('fixes: nothing changes where I is a word', () => {
  assert.equal(T.fixLine('I think I can'), 'I think I can');
  assert.equal(T.fixLine('I CAN SEE IT'), 'I CAN SEE IT');
  assert.equal(T.fixLine('I cup my hands'), 'I cup my hands'); // a unit in lowercase is not enough
  assert.equal(T.fixLine('Item I'), 'Item I');
  assert.equal(T.fixLine('INCH BY INCH'), 'INCH BY INCH');
  assert.equal(T.fixLine('Il faut'), 'Il faut');
});

test('fixes: only a fraction Vision read as one token becomes a fraction character; nothing is built from pieces', () => {
  assert.equal(T.fractionToken('1/2'), '½');
  assert.equal(T.fractionToken('3\u20444'), '¾'); // fraction slash
  assert.equal(T.fractionToken('¹/₂'), '½');
  assert.equal(T.fractionToken('(1/4)'), '(¼)');
  assert.equal(T.fractionToken('1/2,'), '½,');
  assert.equal(T.fractionToken('5/16'), '5/16'); // no single character: left as read
  assert.equal(T.fractionToken('11/2'), '11/2'); // never guesses a mixed number
  assert.equal(T.fractionToken('1/1\u20442'), '1/1\u20442'); // pieces: left as read
  assert.equal(T.fractionToken('1½'), '1½');
  assert.equal(T.fixLine('%4 cup'), '%4 cup');
  assert.equal(T.fixLine('10/12/2026'), '10/12/2026'); // a date is not a fraction
  assert.equal(T.fixLine('  1\u20444  CUP  '), '  ¼  CUP  '); // spacing kept
});

// Brian's angled cookbook shot from build 2 (the photo was the same; only the
// reading of the fractions changed). On the page: "1 1/2 to 2 minutes",
// "1/4 TEASPOON", "3/4 POUND", "1/2 POUND". Build 2 showed "1/½", "1¼",
// "4 POUND" and "2 POUND". The last two are Vision missing the fraction;
// nothing can bring it back, and they must not get worse. The first two
// were build 2 building a fraction from pieces, which is gone.
test('fixes: the four cookbook fraction lines are never given an invented number', () => {
  // What Vision returns, as one token or in pieces, and what the app shows.
  const cases = [
    ['1 1/2 to 2 minutes', '1 ½ to 2 minutes'], // the digit was its own word on the page: kept
    ['1/1\u20442 to 2 minutes', '1/1/2 to 2 minutes'], // pieces: plain slashes, never "1/½" (build 4: never drawn as a neat fraction)
    ['11/2 to 2 minutes', '11/2 to 2 minutes'],
    ['1/4 TEASPOON', '¼ TEASPOON'],
    ['l¼ TEASPOON', 'l¼ TEASPOON'], // never "1¼"
    ['I¼ TEASPOON', 'I¼ TEASPOON'],
    ['3/4 POUND', '¾ POUND'],
    ['4 POUND', '4 POUND'], // Vision missed the fraction: left alone
    ['1/2 POUND', '½ POUND'],
    ['2 POUND', '2 POUND'],
  ];
  for (const [vision, shown] of cases) {
    assert.equal(T.fixLine(vision), shown, vision);
    const paras = [[line(vision, { y: 100 })]];
    assert.equal(T.modelText(T.buildRuns(paras, false)), shown, vision);
    assert.equal(T.modelText(T.buildRuns(paras, true)), shown, vision);
  }
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
  assert.equal(merged[0].firstConfidence, 0.3); // the first look is remembered for the hard-to-read note
  assert.equal(merged[1].text, '%4 CUP');
  // A line's corners survive a second reading (they place it on a turned page).
  const turned = { ...l, corners: [0.1, 0.07, 0.3, 0.06, 0.3, 0.08, 0.1, 0.09] };
  assert.deepEqual(A.mergeSecondPass([turned], [{ index: 0, text: '¾ CUP', confidence: 0.9, words, alternatives: [] }])[0].corners, turned.corners);
  // Empty readings and unknown indexes are ignored.
  assert.deepEqual(A.mergeSecondPass([l], [{ index: 0, text: ' ', confidence: 1, words: [], alternatives: [] }, { index: 5, text: 'x', confidence: 1, words: [], alternatives: [] }]), [l]);
});

// ---------- the nudge (build 2) ----------

test('nudge: over 15% of the counted words unsure AND at least 3 of them; markers, numbers, single letters not counted', () => {
  assert.equal(A.NUDGE_UNSURE_SHARE, 0.15);
  assert.equal(A.NUDGE_MIN_UNSURE, 3);
  // 20 counted words on lines read at 0.5; `k` of them garbled (not in the dictionary).
  const page = (k) =>
    Array.from({ length: 4 }, (_, i) => ({ ...line('alpha bravo charlie delta echo', { y: i * 50, confidence: 0.5 }), unknown: [0, 1, 2, 3, 4].filter((j) => i * 5 + j < k) }));
  assert.equal(A.shouldNudge(page(3)), false); // exactly 15%
  assert.equal(A.shouldNudge(page(4)), true);
  const two = [{ ...line('two odd wurds hree', { y: 0, confidence: 0.5 }), unknown: [2, 3] }];
  assert.equal(A.nudgeCounts(two).share, 0.5);
  assert.equal(A.shouldNudge(two), false); // half, but only 2
  assert.equal(A.shouldNudge([]), false);
  // Low confidence alone is not enough, and neither is an unknown word Vision was sure of.
  assert.equal(A.shouldNudge([{ ...line('qwz vbn mkl pty', { y: 0, confidence: 1 }), unknown: [0, 1, 2, 3] }]), false);
  assert.equal(A.shouldNudge([line('every word here is fine and right', { y: 0, confidence: 0.3 })]), false);
  // What counts: markers, single characters, numbers and punctuation are left out.
  assert.equal(A.nudgeWordKind('-', false), 'skip');
  assert.equal(A.nudgeWordKind('a)', false), 'skip');
  assert.equal(A.nudgeWordKind('[x]', false), 'skip');
  assert.equal(A.nudgeWordKind('$4.50', false), 'skip');
  assert.equal(A.nudgeWordKind('915-555-0142,', false), 'skip');
  assert.equal(A.nudgeWordKind('Milk', false), 'word');
  assert.equal(A.nudgeWordKind("Ana's", false), 'word');
  assert.equal(A.nudgeWordKind('well-known', false), 'word');
  assert.equal(A.nudgeWordKind('brian.k@example.com', false), 'word');
  assert.equal(A.nudgeWordKind('buon', true), 'odd');
  assert.equal(A.nudgeWordKind('2z', false), 'odd');
  assert.equal(A.nudgeWordKind('8B', false), 'odd');
});

// Build 4 showed the note on almost every handwritten scan, clean ones too.
// Brian's sharp, flat Groceries list (every word right) must not get it;
// the trip-up sheet and the New Scientist spread must.
test('nudge: no note on the clean Groceries list or a This Week list; a note on the trip-up sheet and the magazine spread', () => {
  // Handwriting is often read at 0.5 at the first look even when every word is right.
  const hand = (texts, unknown = {}) => texts.map((t, i) => ({ ...line(t, { y: i * 60, confidence: 1 }), firstConfidence: 0.5, unknown: unknown[i] ?? [] }));
  const groceries = hand(['Groceries', '- Milk', '- Eggs', '- Coffee', '- Apples', '- Bread', '- Olive Oil']);
  assert.equal(A.shouldNudge(groceries), false);
  assert.equal(A.nudgeCounts(groceries).unsure, 0);
  const week = hand(['This Week', 'Mon - dentist 3pm', 'Tue - call Sam', 'Wed - gym', "Thu - Ana's party", 'Fri - pay rent']);
  assert.equal(A.shouldNudge(week), false); // "3pm" alone is not enough
  // The trip-up sheet as build 2 and 3 read it, the garbled lines at 0.5 (dictionary flags as the phone would).
  const tripUp = [
    { ...line('THE QUICK BROWN FOX', { y: 0 }) },
    { ...line('the quick buon fox jumps', { y: 60, confidence: 0.5 }), unknown: [2] },
    { ...line('1100 55 2z 8B 2z 6b', { y: 120, confidence: 0.5 }), unknown: [] },
    { ...line('915-555-01423 brian. H@exampe.com', { y: 180, confidence: 0.5 }), unknown: [1] },
    { ...line('34 cuP, 12 tsp, 350°F', { y: 240, confidence: 0.5 }), unknown: [1, 3] },
    { ...line('bring the red blue folder', { y: 300 }) },
    { ...line('coffe $4.50', { y: 360 }), unknown: [0] },
    { ...line('bagel $2.25', { y: 420 }) },
    { ...line('total $6.75', { y: 480 }) },
  ];
  const t = A.nudgeCounts(tripUp);
  assert.equal(t.unsure, 9);
  assert.equal(A.shouldNudge(tripUp), true);
  // The magazine spread shot at an angle with no crop: half the lines read at 0.5, most of those with a word or two misread.
  const misread = {
    1: [[2, 'acurate'], [4, 'Albcrt']],
    3: [[2, 'clocK'], [4, 'tbe']],
    5: [[3, 'grouud'], [5, 'ycars.']],
    7: [[2, 'pasa'], [4, 'Iittle']],
    9: [[1, 'aud'], [4, 'tbat']],
    11: [[2, 'tbe'], [3, 'teain']],
    13: [[1, 'nuinbers'], [3, 'witb']],
    15: [[1, 'tbeory'], [5, 'slivcr,']],
    17: [[3, 'centnry'], [4, 'cxperiments.']],
  };
  const magazine = MAG_ORDER.map((text, i) => {
    const words = text.split(' ');
    const bad = (misread[i] ?? []).filter(([k]) => k < words.length);
    for (const [k, w] of bad) words[k] = w;
    return { ...line(words.join(' '), { y: i * 50, confidence: 1 }), ...(i % 2 === 1 ? { firstConfidence: 0.5 } : {}), unknown: bad.map(([k]) => k) };
  });
  const m = A.nudgeCounts(magazine);
  assert.ok(m.share > 0.15 && m.unsure >= 3, JSON.stringify(m));
  assert.equal(A.shouldNudge(magazine), true);
  // The same spread read cleanly (build 3's ISS result) gets no note, even with the same low first look.
  assert.equal(A.shouldNudge(MAG_ORDER.map((text, i) => ({ ...line(text, { y: i * 50 }), ...(i % 2 === 1 ? { firstConfidence: 0.5 } : {}), unknown: [] }))), false);
});

// ---------- reading languages (build 5) ----------

// Brian's build 4 test: a neat handwritten "- Pay electric bill" came out
// as "- Pay electric ط ا) ا" on one scan in four. Vision was guessing the
// language and picked Arabic from a few strokes.
test('languages: Vision guesses the language only when more than one is picked; English alone by default', () => {
  assert.deepEqual(A.readingLanguages(['en-US']), ['en-US']);
  assert.deepEqual(A.readingLanguages(['fr-FR']), ['fr-FR', 'en-US']);
  assert.equal(A.autoDetectLanguage(['en-US']), false);
  assert.equal(A.autoDetectLanguage([]), false);
  assert.equal(A.autoDetectLanguage(['en-US', 'fr-FR']), true);
  assert.equal(A.autoDetectLanguage(['fr-FR']), true); // French and English
  assert.equal(A.latinOnly(A.readingLanguages(['en-US', 'de-DE', 'vi-VT'])), true);
  assert.equal(A.latinOnly(A.readingLanguages(['ar-SA'])), false);
  assert.equal(A.latinOnly(A.readingLanguages(['zh-Hans'])), false);
});

/** Latin letters, digits, punctuation, symbols ($, °, ½) and spaces only. */
const LATIN_TEXT = /^[\p{Script=Latin}0-9\p{P}\p{S}\p{No}\s]*$/u;

test('languages: with a Latin-only list the output never holds another alphabet', () => {
  const latin = A.latinOnly(A.readingLanguages(['en-US']));
  const lines = [
    line('Groceries', { y: 100 }),
    line('- Pay electric ط ا) ا', { y: 160 }), // confident, but the wrong alphabet
    line('- Call Ana', { y: 220 }),
    line('- Café at 3', { y: 280 }), // Latin with an accent is fine
    line('- Rent ٣ due', { y: 340 }), // an Arabic-Indic digit
  ];
  assert.equal(A.offScript(lines[1].text), true);
  assert.equal(A.offScript(lines[3].text), false);
  assert.equal(A.offScript('½ cup, 350°F, $4.50, brian.k@example.com'), false);
  // The line goes to the second pass, read again without guessing.
  assert.deepEqual(A.pickSecondPass(lines, undefined, { latinOnly: latin }), [1, 4]);
  assert.deepEqual(A.pickSecondPass(lines), []); // other lists: as before
  const again = [
    { index: 1, text: '- Pay electric bill', confidence: 0.5, words: [], alternatives: [] }, // less confident, but right: used
    { index: 4, text: '- Rent ٣ due', confidence: 1, words: [], alternatives: [] }, // still wrong
  ];
  let out = A.mergeSecondPass(lines, again, { latinOnly: latin });
  assert.equal(out[1].text, '- Pay electric bill');
  // A reading with another alphabet never replaces a clean line.
  assert.equal(A.mergeSecondPass([lines[0]], [{ index: 0, text: 'Groceriesط', confidence: 1, words: [], alternatives: [] }], { latinOnly: latin })[0].text, 'Groceries');
  // Whatever is left is shown as "?", one for one, so word positions hold.
  out = out.map((l) => (A.offScript(l.text) ? { ...l, text: A.maskOffScript(l.text) } : l));
  assert.equal(out[4].text, '- Rent ? due');
  assert.equal(A.maskOffScript('- Pay electric ط ا) ا'), '- Pay electric ? ?) ?');
  assert.equal(A.maskOffScript('- Pay electric ط ا) ا').length, '- Pay electric ط ا) ا'.length);
  for (const l of out) assert.match(l.text, LATIN_TEXT, l.text);
  const paras = P.groupParagraphs(out, W, H).map((p) => p.lines);
  for (const clean of [false, true]) assert.match(T.modelText(T.buildRuns(paras, clean)), LATIN_TEXT);
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

test('outline: with no page found, the handles start 6% in from each edge, or on the camera guide', () => {
  const size = { width: 1000, height: 1500 };
  assert.equal(A.GUESS_INSET, 0.06);
  assert.deepEqual(A.guessQuad(size), [pt(60, 90), pt(940, 90), pt(940, 1410), pt(60, 1410)]);
  assert.deepEqual(A.guessQuad(size, { x: 40, y: 100, width: 900, height: 1200 }), [pt(40, 100), pt(940, 100), pt(940, 1300), pt(40, 1300)]);
  assert.equal(A.isConvex(A.guessQuad(size)), true);
  // A confident outline over the whole photo (a screenshot, a scan) keeps the whole photo.
  const all = [pt(0, 0), pt(1000, 0), pt(1000, 1500), pt(0, 1500)];
  assert.equal(A.wholePhoto({ found: true, confidence: 0.9, quad: all }, size), true);
  assert.equal(A.wholePhoto({ found: true, confidence: 0.9, quad: [pt(100, 150), pt(880, 130), pt(900, 1300), pt(120, 1320)] }, size), false);
  assert.equal(A.wholePhoto({ found: false, confidence: 0, quad: null }, size), false);
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
  // Large handwriting, uneven: 52, 60 and 70 px lines (median 60). A 30 px gap (0.5) is the same paragraph, a 40 px gap (0.67) is not.
  const big = (gap) => [
    line('first line of a note that runs on', { y: 100, h: 52 }),
    line('and keeps going here a bit more', { y: 152 + 30, h: 60 }),
    line('until the very end of it', { y: 182 + 60 + gap, h: 70 }),
  ];
  assert.equal(P.looksPrinted([52, 60, 70]), false);
  assert.equal(P.groupParagraphs(big(30), W, H).length, 1);
  assert.equal(P.groupParagraphs(big(40), W, H).length, 2);
});

// Brian's cookbook ingredient list from build 2: print, so a blank line
// between every item was wrong; and "and blanched" (wrapped, indented to
// the text) belongs to its item.
test('print: a list keeps its items together without blank lines; an indented continuation stays with its item', () => {
  assert.equal(P.PARAGRAPH_GAP_PRINT, 1.0);
  assert.equal(P.looksPrinted([30, 31, 29, 30, 33]), true); // within 15%
  const items = [
    line('Kosher salt', { x: 100, y: 100, w: 180 }),
    line('Freshly ground black pepper', { x: 100, y: 152, w: 420 }), // a 22 px gap: 0.73 of the line height
    line('4 POUND haricots verts, stems removed', { x: 100, y: 204, w: 600 }),
    line('and blanched', { x: 230, y: 256, w: 200 }),
    line('2 TABLESPOONS olive oil', { x: 100, y: 308, w: 380 }),
  ];
  const paras = P.groupParagraphs(P.orderLines(items, W, H), W, H).map((p) => p.lines);
  assert.equal(T.modelText(T.buildRuns(paras, false)), 'Kosher salt\nFreshly ground black pepper\n4 POUND haricots verts, stems removed\nand blanched\n2 TABLESPOONS olive oil');
  assert.equal(T.modelText(T.buildRuns(paras, true)), 'Kosher salt\nFreshly ground black pepper\n4 POUND haricots verts, stems removed and blanched\n2 TABLESPOONS olive oil');
  // A full line of space between two printed lines still starts a new paragraph.
  assert.equal(P.groupParagraphs([line('A first paragraph line', { y: 100, w: 380 }), line('A second one', { y: 160, w: 200 })], W, H).length, 2);
});

// Brian's handwritten note from build 2: one line written climbing about
// 20 degrees ("Leaving for Bedford Hills on 6:40 train") came out as
// "Leavin", another line, then "Bedford Hills on 6:40 trai.". Vision gives
// each piece's corners; collinear pieces are one line again before ordering.
test('handwriting: a line written on a slant that Vision splits in two comes out as one line, in its place', () => {
  const level = (text, y, w) => slab(text, { x: 100, y, length: w, h: 46, deg: 0 });
  const first = slab('Leaving for', { x: 100, y: 700, length: 300, h: 50, deg: -20 });
  // The second piece starts 30 px further along the same slant.
  const a = (-20 * Math.PI) / 180;
  const second = slab('Bedford Hills on 6:40 train', { x: 100 + 330 * Math.cos(a), y: 700 + 330 * Math.sin(a), length: 470, h: 50, deg: -20 });
  const lines = [
    level('Back by Sunday', 850, 420),
    second,
    level('Pick up Sam at 3', 400, 460),
    level('Monday Oct 23', 200, 430),
    first,
    level('Feed the cat twice a day', 950, 600),
    level('Call the bank about the card', 300, 640),
  ];
  assert.deepEqual(P.orderLines(lines, W, H).map((l) => l.text), [
    'Monday Oct 23',
    'Call the bank about the card',
    'Pick up Sam at 3',
    'Leaving for Bedford Hills on 6:40 train',
    'Back by Sunday',
    'Feed the cat twice a day',
  ]);
  // Without corners (pages read before build 3) nothing is joined across a slant, and nothing breaks.
  const old = lines.map(({ corners, ...l }) => l);
  assert.equal(P.orderLines(old, W, H).length, 7);
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

// ---------- a magazine spread, every way in (build 3) ----------

// Brian's New Scientist spread from build 2, rebuilt as geometry: a title
// across three columns, the article in three columns, the footer, and on
// the left edge of the photo the cut-off ends of the facing page's lines.
// Build 2 put the body before the title, read a column backwards and kept
// the scraps. Text after the first lines is a stand-in for the article.
const MAG_TITLE = 'Einstein put to the test on the ISS';
const MAG_COLUMNS = [
  ['PHYSICISTS are lining up the', 'most accurate test yet of Albert', "Einstein's ideas about gravity.", 'A clock on the space station', 'will be compared with clocks', 'on the ground for two years.'],
  ['The idea is simple enough. Time', 'should pass a little faster', 'higher up, where gravity is', 'weaker, and the size of that', 'shift is what the team wants', 'to pin down.'],
  ['If the numbers disagree with', 'the theory by even a sliver,', 'it would be the first crack', 'in a century of experiments.', 'Launch is planned for 2025.'],
];
const MAG_FOOTER = '25 November 2023 | New Scientist | 17';
const MAG_SCRAPS = ['d altering and making specific', 'others are', 'iting and prime editing', "Ils' repair mechanisms"];
const MAG_ORDER = [MAG_TITLE, ...MAG_COLUMNS.flat(), MAG_FOOTER];

/**
 * The spread as Vision would return it for one way in. The page (2400 x
 * 3200 in its own pixels) is scaled by `scale`, turned `deg` about its
 * center and centered `shift` px right of the image's center; `scraps` adds
 * the facing page's line ends cut by the left edge of the image. Lines come
 * back shuffled, never in reading order.
 */
function spread({ iw, ih, scale = 1, deg = 0, shift = 0, scraps = false }) {
  const a = (deg * Math.PI) / 180;
  const [cos, sin] = [Math.cos(a), Math.sin(a)];
  const at = ([x, y]) => {
    const dx = (x - 1200) * scale;
    const dy = (y - 1600) * scale;
    return [iw / 2 + shift + dx * cos - dy * sin, ih / 2 + dx * sin + dy * cos];
  };
  const rect = (text, x, y, w, h) => fromCorners(text, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(at), { iw, ih });
  const lines = [rect(MAG_TITLE, 300, 300, 1800, 90)];
  MAG_COLUMNS.forEach((col, c) =>
    col.forEach((t, i) => lines.push(rect(t, 300 + c * 760, 520 + i * 60, i === col.length - 1 ? 420 : 680 - (i % 3) * 30, 40)))
  );
  lines.push(rect(MAG_FOOTER, 300, 2900, 900, 34));
  if (scraps) {
    // Along the same slant, starting off the image and ending 230 px in.
    MAG_SCRAPS.forEach((t, i) => {
      const y = ih * 0.3 + i * 70 * scale;
      const len = 420;
      lines.push(slab(t, { x: 230 - len * cos, y: y - len * sin, length: len, h: 40 * scale, deg, iw, ih }));
    });
  }
  // Vision's order: shuffled.
  return lines.map((l, i) => ({ l, k: (i * 7919) % 101 })).sort((p, q) => p.k - q.k).map((p) => p.l);
}

// Every way a page comes in. The Swift module turns every image upright in
// pixels and returns top-left boxes and corners for all of them, so the
// TypeScript side sees the same kind of input; what differs is the angle,
// the scraps, and whether a crop was set.
const WAYS_IN = [
  { name: 'camera, page found (flattened)', iw: 2400, ih: 3200, cropped: true },
  { name: 'camera, no page found, guess untouched', iw: 3024, ih: 4032, scale: 0.8, deg: 15, shift: 150, scraps: true, cropped: false },
  { name: 'camera, no page found, corners dragged', iw: 2600, ih: 3400, scale: 0.9, deg: 15, shift: 40, cropped: true },
  { name: 'photo import, untouched', iw: 3024, ih: 4032, scale: 0.8, deg: -12, shift: 150, scraps: true, cropped: false },
  { name: 'file import (image), untouched', iw: 4032, ih: 3024, scale: 0.7, deg: 8, shift: 300, scraps: true, cropped: false },
  { name: 'PDF page', iw: 1700, ih: 2267, scale: 0.7, cropped: false },
];

test('magazine spread: title, then the three columns in order, then the footer, for every way in', () => {
  for (const way of WAYS_IN) {
    const lines = spread(way);
    const ordered = P.readingOrder(lines, way.iw, way.ih, { cropped: way.cropped });
    assert.deepEqual(ordered.map((l) => l.text), MAG_ORDER, way.name);
    // Paragraphs: the title alone, the footer alone, and never a column run backwards.
    const paras = P.groupParagraphs(ordered, way.iw, way.ih).map((p) => p.lines.map((l) => l.text));
    assert.deepEqual(paras[0], [MAG_TITLE], way.name);
    assert.deepEqual(paras[paras.length - 1], [MAG_FOOTER], way.name);
    assert.deepEqual(paras[1].slice(0, 3), ['PHYSICISTS are lining up the', 'most accurate test yet of Albert', "Einstein's ideas about gravity."], way.name);
  }
});

test('magazine spread: the facing page scraps go only when no crop was set; the article never loses a line', () => {
  const way = WAYS_IN[1];
  const lines = spread(way);
  assert.equal(lines.length, MAG_ORDER.length + MAG_SCRAPS.length);
  for (const t of MAG_SCRAPS) assert.ok(lines.find((l) => l.text === t).box.x <= 0.01, t); // cut by the photo's edge
  const kept = P.dropEdgeFragments(lines, way.iw, way.ih).map((l) => l.text);
  for (const t of MAG_SCRAPS) assert.equal(kept.includes(t), false, t);
  assert.equal(kept.length, MAG_ORDER.length);
  // With a crop set, nothing is dropped (whatever touches the edge is what the person chose).
  const withCrop = P.readingOrder(lines, way.iw, way.ih, { cropped: true }).map((l) => l.text);
  for (const t of MAG_SCRAPS) assert.equal(withCrop.includes(t), true, t);
  // A page whose own text runs to the edge (a tight crop of one column) keeps every line.
  const tight = MAG_COLUMNS[0].map((t, i) => line(t, { x: 0, y: ys(i), w: 990 }));
  assert.equal(P.dropEdgeFragments(tight, W, H).length, tight.length);
});

test('reading order: a page turned more than 5 degrees is read along its text, under that along the image', () => {
  assert.equal(P.SKEW_MIN_DEGREES, 5);
  const turned = spread({ iw: 3024, ih: 4032, scale: 0.8, deg: 15 });
  assert.ok(Math.abs(P.pageAngle(turned, 3024, 4032) - (15 * Math.PI) / 180) < 0.01);
  assert.equal(P.pageAngle(spread({ iw: 3024, ih: 4032, scale: 0.8, deg: 3 }), 3024, 4032), 0);
  assert.equal(P.pageAngle([line('no corners on this one', { y: 100 })], W, H), 0);
  // Control: the same turned page measured along the image (no corners) does not come out in order.
  const flat = turned.map(({ corners, ...l }) => l);
  assert.notDeepEqual(P.orderLines(flat, 3024, 4032).map((l) => l.text), MAG_ORDER);
  assert.deepEqual(P.orderLines(turned, 3024, 4032).map((l) => l.text), MAG_ORDER);
});

// ---------- build 4: never lose a word ----------

const tokens = (lines) => lines.reduce((t, l) => t + (l.text.match(/\S+/g) ?? []).length, 0);
/**
 * Words with boxes for a line of text drawn from (x, y) in pixels: `letter`
 * px per character, one `letter` per space, and `extra` px more after the
 * token at index `after` (a gutter, or a handwritten gap).
 */
const withWords = (text, { x, y, h = 30, letter = 16, iw = W, ih = H, after = -1, extra = 0, ...opts }) => {
  const words = [];
  let px = x;
  for (const m of text.matchAll(/\S+/g)) {
    const start = m.index;
    const k = words.length;
    words.push({ start, end: start + m[0].length, box: { x: px / iw, y: y / ih, width: (m[0].length * letter) / iw, height: h / ih } });
    px += (m[0].length + 1) * letter + (k === after ? extra : 0);
  }
  const width = px - letter - x;
  return { text, confidence: 1, alternatives: [], words, box: { x: x / iw, y: y / ih, width: width / iw, height: h / ih }, ...opts };
};

// Brian's trip-up sheet on build 3 (page found and flattened): "fox jumps"
// vanished, leaving "the quick brown". Vision can return the two halves of
// a handwritten line as separate boxes, or as one; neither may lose words.
test('never lose a word: "fox jumps" as its own box beside "the quick brown" is kept, page found or not', () => {
  const rows = tripUpLines();
  const i = rows.findIndex((l) => l.text === 'the quick brown fox jumps');
  const row = rows[i];
  const left = { ...row, text: 'the quick brown', box: { ...row.box, width: 330 / W } };
  const right = { ...row, text: 'fox jumps', box: { ...row.box, x: row.box.x + 400 / W, width: 200 / W } };
  const lines = [...rows.slice(0, i), right, left, ...rows.slice(i + 1)];
  for (const cropped of [true, false]) {
    const out = P.readingOrder(lines, W, H, { cropped });
    assert.equal(tokens(out), tokens(lines), `cropped ${cropped}`);
    const text = out.map((l) => l.text).join('\n');
    assert.ok(text.includes('the quick brown'), text);
    assert.ok(text.includes('fox jumps'), text);
    assert.ok(text.indexOf('the quick brown') < text.indexOf('fox jumps'));
  }
  // A line touching the photo's edge is never dropped when a page was found or a crop set.
  const edge = [...lines, line('jumps over the lazy dog', { x: 0, y: 900, w: 300 })];
  assert.equal(P.readingOrder(edge, W, H, { cropped: true }).length, P.orderLines(edge, W, H).length);
});

test('never lose a word: a second reading with fewer words, or a number run into a fraction, is ignored', () => {
  const first = line('the quick buon fox jumps', { y: 100, confidence: 0.5 });
  const shorter = { index: 0, text: 'the quick brown', confidence: 1, words: [], alternatives: [] };
  assert.equal(A.mergeSecondPass([first], [shorter])[0].text, 'the quick buon fox jumps');
  const better = { index: 0, text: 'the quick brown fox jumps', confidence: 1, words: [], alternatives: [] };
  assert.equal(A.mergeSecondPass([first], [better])[0].text, 'the quick brown fox jumps');
  const half = line('½ inch thick', { y: 100, confidence: 0.5 });
  assert.equal(A.mergeSecondPass([half], [{ index: 0, text: '1½ inch thick', confidence: 1, words: [], alternatives: [] }])[0].text, '½ inch thick');
  assert.equal(A.mergeSecondPass([half], [{ index: 0, text: '11/2 inch thick', confidence: 1, words: [], alternatives: [] }])[0].text, '½ inch thick');
});

test('never lose a word: only scraps touching the edge AND cut mid-word go, each one reported', () => {
  const body = Array.from({ length: 6 }, (_, i) => line(`A full line of the article number ${i}`, { x: 300, y: ys(i), w: 600 }));
  const scraps = [
    line('iting and prime editing', { x: 0, y: ys(0), w: 200 }),
    line('others are', { x: 0, y: ys(1), w: 120 }),
    line('Whole Word At Edge.', { x: 0, y: ys(2), w: 210 }), // touches the edge but is not cut
  ];
  const dropped = [];
  const kept = P.dropEdgeFragments([...body, ...scraps], W, H, (l) => dropped.push(l.text));
  assert.deepEqual(dropped.sort(), ['iting and prime editing', 'others are']);
  assert.ok(kept.some((l) => l.text === 'Whole Word At Edge.'));
  assert.equal(tokens(kept) + dropped.reduce((t, d) => t + d.split(' ').length, 0), tokens([...body, ...scraps]));
});

// ---------- build 4: Clean up keeps handwritten lines ----------

// Brian's trip-up sheet with Clean up on, build 3: lines 2 to 5 ran into one
// paragraph ("the quick brown 1100 55 2z 8B 2z 6b 915-555-01423 brian.
// H@exampe.com 34 cuP, 12 tsp, 350°F") because they are long. Handwriting
// never joins, except a word split by a hyphen.
const SHEET_B3 = ['the quick brown', '1100 55 2z 8B 2z 6b', '915-555-01423 brian. H@exampe.com', '34 cuP, 12 tsp, 350°F'];
test('clean up: handwritten lines never join, however long; a word split by a hyphen still does', () => {
  // Long lines (all over 85% of the widest), heights uneven: handwriting.
  const sizes = [[640, 52], [700, 38], [760, 44], [700, 34]];
  let y = 200;
  const lines = SHEET_B3.map((t, i) => {
    const l = line(t, { x: 100 + i * 6, y, w: sizes[i][0], h: sizes[i][1] });
    y += sizes[i][1] + 10;
    return l;
  });
  assert.equal(P.isHandwritten(lines, W, H), true);
  const paras = P.groupParagraphs(lines, W, H).map((p) => p.lines);
  assert.deepEqual(T.modelText(T.buildRuns(paras, true, { handwritten: true })).split(/\n+/), SHEET_B3);
  // The same lines as print would join (the width rule), which is why the handwriting test matters.
  assert.equal(T.joinPlan(sizes.map((s) => s[0]), SHEET_B3, 0).some(Boolean), true);
  assert.deepEqual(T.joinPlan(sizes.map((s) => s[0]), SHEET_B3, 0, [], { handwritten: true }), [false, false, false]);
  assert.deepEqual(T.joinPlan([700, 300], ['we picked a bunch of water-', 'cress by the creek'], 0, [], { handwritten: true }), [true]);
  // Print keeps the build 3 rule; the cookbook body still joins.
  assert.equal(P.isHandwritten(printed(COOKBOOK), W, H), false);
});

// ---------- build 4: columns ----------

/** Columns of lines: `cols` is [x, width, [[text, y], ...]] in pixels. */
const columns = (cols, opts = {}) => cols.flatMap(([x, w, rows]) => rows.map(([t, y, h = 30]) => withWords(t, { x, y, h, letter: Math.min(16, w / Math.max(8, t.length)), ...opts })));

// The Anemones article from Brian's New Scientist page: column 1 read right,
// but columns 2 and 3 and the red pull quote came out in chunks
// ("...Modepalli and his", then "When the team bleached ... it was", then
// back to "colleagues filmed them..."). The pull quote sits across the
// gutter between columns 2 and 3 with space around it. Stand-in text.
const ANEMONE_1 = ['Sea anemones can grow back', 'a whole body from a sliver,', 'and a team in India wanted', 'to know how they manage it.', 'They cut dozens of them up', 'and watched what happened.', 'Every piece grew a mouth', 'within a week or so of it.'];
const ANEMONE_2_TOP = ['The animals were kept in', 'warm tanks at the lab, and', 'Modepalli and his'];
const ANEMONE_2_BOTTOM = ['colleagues filmed them', 'day and night for a month', 'to see the order of events.'];
const ANEMONE_3_TOP = ['When the team bleached', 'some of the animals first,', 'it was'];
const ANEMONE_3_BOTTOM = ['much slower to heal, which', 'points to the algae living', 'inside their tissue.'];
const ANEMONE_QUOTE = '"Every piece grew a new mouth"';
const anemones = () => {
  const at = (list, y0) => list.map((t, i) => [t, y0 + i * 48]);
  const lines = columns([
    [100, 560, at(ANEMONE_1, 300)],
    [720, 560, [...at(ANEMONE_2_TOP, 300), ...at(ANEMONE_2_BOTTOM, 720)]],
    [1340, 560, [...at(ANEMONE_3_TOP, 300), ...at(ANEMONE_3_BOTTOM, 720)]],
  ], { iw: 2000, ih: 1400 });
  // The pull quote, bigger, across the gutter between columns 2 and 3, centered right of it.
  lines.push(withWords(ANEMONE_QUOTE, { x: 1000, y: 560, h: 60, letter: 30, iw: 2000, ih: 1400 }));
  return lines.reverse();
};

test('columns: the Anemones article reads column by column; the pull quote never makes it jump', () => {
  const out = P.readingOrder(anemones(), 2000, 1400, { cropped: true }).map((l) => l.text);
  const col2 = [...ANEMONE_2_TOP, ...ANEMONE_2_BOTTOM];
  const col3 = [...ANEMONE_3_TOP, ...ANEMONE_3_BOTTOM];
  assert.deepEqual(out.slice(0, ANEMONE_1.length), ANEMONE_1);
  assert.deepEqual(out.filter((t) => col2.includes(t)), col2);
  assert.deepEqual(out.filter((t) => col3.includes(t)), col3);
  // Column 2 is read in full before column 3 starts, and the quote sits in column 3 in its place.
  assert.ok(out.indexOf(col2[col2.length - 1]) < out.indexOf(col3[0]), out.join(' | '));
  assert.ok(out.indexOf(ANEMONE_3_TOP[2]) < out.indexOf(ANEMONE_QUOTE) && out.indexOf(ANEMONE_QUOTE) < out.indexOf(ANEMONE_3_BOTTOM[0]), out.join(' | '));
  assert.equal(tokens(P.readingOrder(anemones(), 2000, 1400, { cropped: true })), tokens(anemones()));
});

// TIME's "Into the Breach" spread: Vision itself returned lines straight
// across the gutter ("worked around the clock in Brussels, she hoped for
// lead the European Commission. (The Commis-"), and page 2 came out as
// alternating one-line fragments. Stand-in text around Brian's line.
const TIME_LEFT = ['When the call came, she had', 'worked around the clock in', 'Brussels, she hoped for', 'a quiet week, and instead', 'she was asked to come and', 'help write the new rules.'];
const TIME_RIGHT = ['lead the European Commission.', '(The Commis- sion is the', 'bloc\'s executive arm, and', 'its president sets the tone', 'for nearly everything else', 'the union does each year.'];
const timeSpread = () => {
  const lines = [];
  TIME_LEFT.forEach((t, i) => {
    const y = 300 + i * 50;
    const r = TIME_RIGHT[i];
    if (i % 3 !== 2) {
      // Glued: one Vision line across the gutter, a wide gap between the two halves.
      const n = t.split(' ').length;
      lines.push(withWords(`${t} ${r}`, { x: 100, y, after: n - 1, extra: 560 - (t.length + 1) * 14 + 60, letter: 14 }));
    } else {
      lines.push(withWords(t, { x: 100, y, letter: 14 }));
      lines.push(withWords(r, { x: 720, y, letter: 14 }));
    }
  });
  return lines;
};

test('columns: lines Vision glued across the TIME gutter are cut apart; each column reads in full', () => {
  const glued = timeSpread();
  assert.ok(glued.some((l) => l.text.startsWith('worked around the clock in lead the European')) || glued.some((l) => l.text.includes('lead the European')));
  const split = P.splitAtGutters(glued, W, H);
  assert.equal(tokens(split), tokens(glued));
  assert.ok(split.every((l) => !(TIME_LEFT.some((t) => l.text.startsWith(t)) && TIME_RIGHT.some((t) => l.text.endsWith(t)))), split.map((l) => l.text).join(' | '));
  const out = P.readingOrder(glued, W, H, { cropped: true }).map((l) => l.text);
  assert.deepEqual(out, [...TIME_LEFT, ...TIME_RIGHT]);
  // A receipt's wide gaps before the prices are not a gutter.
  const receipt = ['Coffee 4.50', 'Bagel 2.25', 'Total 6.75'].map((t, i) => withWords(t, { x: 100, y: 300 + i * 50, after: 0, extra: 500 }));
  assert.deepEqual(P.splitAtGutters(receipt, W, H).map((l) => l.text), ['Coffee 4.50', 'Bagel 2.25', 'Total 6.75']);
});

// The ISS article as build 3 read it on the phone (perfect): title,
// standfirst, byline, column 1, column 2, the photo caption, column 3.
test('columns: the ISS article keeps its build 3 order with standfirst, byline and caption, every way in', () => {
  const extra = (way) => {
    const lines = spread({ ...way, scraps: false }).filter((l) => !MAG_COLUMNS[2].includes(l.text));
    return lines;
  };
  void extra;
  const iw = 2400;
  const ih = 3200;
  const rect = (t, x, y, w, h) => fromCorners(t, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], { iw, ih });
  const lines = [
    rect(MAG_TITLE, 300, 300, 1800, 90),
    rect('Clocks in orbit will be compared with clocks on the ground', 300, 420, 1800, 46),
    rect('Alex Wilkins', 300, 500, 400, 34),
    ...MAG_COLUMNS[0].map((t, i) => rect(t, 300, 580 + i * 60, 680 - (i % 3) * 30, 40)),
    ...MAG_COLUMNS[1].map((t, i) => rect(t, 1060, 580 + i * 60, 680 - (i % 3) * 30, 40)),
    rect('The space station, where', 1820, 900, 600, 30),
    rect('the clock will fly', 1820, 945, 400, 30),
    ...MAG_COLUMNS[2].map((t, i) => rect(t, 1820, 1020 + i * 60, 560 - (i % 3) * 30, 40)),
    rect(MAG_FOOTER, 300, 2900, 900, 34),
  ];
  const expected = [
    MAG_TITLE,
    'Clocks in orbit will be compared with clocks on the ground',
    'Alex Wilkins',
    ...MAG_COLUMNS[0],
    ...MAG_COLUMNS[1],
    'The space station, where',
    'the clock will fly',
    ...MAG_COLUMNS[2],
    MAG_FOOTER,
  ];
  const shuffled = lines.map((l, i) => ({ l, k: (i * 7919) % 101 })).sort((a, b) => a.k - b.k).map((p) => p.l);
  assert.deepEqual(P.readingOrder(shuffled, iw, ih, { cropped: true }).map((l) => l.text), expected);
});

test('never lose a word: reading order keeps every word on every fixture', () => {
  const cases = [
    ['dash list', visionList().map((l) => ({ ...l, box: P.flipVisionBox(l.box) })), 3024, 4032],
    ['trip-up sheet', tripUpLines(), W, H],
    ['cookbook', printed(COOKBOOK), W, H],
    ['anemones', anemones(), 2000, 1400],
    ['TIME', timeSpread(), W, H],
    ...WAYS_IN.map((way) => [way.name, spread({ ...way, scraps: false }), way.iw, way.ih]),
  ];
  for (const [name, lines, iw, ih] of cases) {
    assert.equal(tokens(P.orderLines(lines, iw, ih)), tokens(lines), name);
    assert.equal(tokens(P.readingOrder(lines, iw, ih, { cropped: true })), tokens(lines), name);
  }
});

// ---------- build 4: fractions in small type ----------

// Brian's "grilled vegetables" page (cookbook p.166): "1/2 inch thick" set
// as a small raised 1, a slash and a small lowered 2. Build 3 showed
// "1½ inch thick" twice, "2 inch thick" twice, and "½ inch thick" once.
test('fixes: grilled vegetables, a fraction in small type never becomes a mixed number like 1½', () => {
  const cases = [
    // [what Vision returned, confidence, what is shown, whether the number is underlined]
    ['Cut the eggplant 11⁄2 inch thick', 0.5, 'Cut the eggplant 11/2 inch thick', true], // visibly odd, never drawn as 1½
    ['Cut the squash 1¹/₂ inch thick', 0.5, 'Cut the squash 11/2 inch thick', true],
    ['Cut the onions ¹⁄₂ inch thick', 1, 'Cut the onions ½ inch thick', false],
    ['Cut the zucchini 2 inch thick', 1, 'Cut the zucchini 2 inch thick', false], // Vision lost the fraction: left alone
    ['Cut the peppers 1½ inch thick', 0.5, 'Cut the peppers 1½ inch thick', true], // Vision's own reading, flagged
  ];
  for (const [vision, confidence, shown, flagged] of cases) {
    const runs = T.buildRuns([[line(vision, { y: 100, confidence })]], false);
    assert.equal(T.modelText(runs), shown, vision);
    const number = runs.find((r) => T.isFractionLike(r.text) || /\d/.test(r.text));
    assert.equal(number.unsure, flagged, vision);
    // The app never adds a "1½" that Vision did not return.
    if (!/\d[½¼¾]/.test(vision)) assert.equal(/\d[½¼¾⅓⅔⅛⅜⅝⅞]/.test(T.modelText(T.buildRuns([[line(vision, { y: 100, confidence })]], true))), false, vision);
  }
  // Only an explicit space makes a mixed number.
  assert.equal(T.fixLine('1 1/2 inch thick'), '1 ½ inch thick');
  assert.equal(T.fixLine('11/2 inch thick'), '11/2 inch thick');
});

// ---------- build 4: the slanted line, from its words ----------

test('handwriting: the slanted line joins from its words when Vision gives it a level box', () => {
  // "Bedford Hills on 6:40 train" climbs 20 degrees; Vision's box and corners are level (an upright box around it).
  const a = (-20 * Math.PI) / 180;
  const words = [];
  const text = 'Bedford Hills on 6:40 train';
  let along = 0;
  for (const m of text.matchAll(/\S+/g)) {
    const len = m[0].length * 18;
    const cx = 330 + (along + len / 2) * Math.cos(a);
    const cy = 700 + (along + len / 2) * Math.sin(a);
    words.push({ start: m.index, end: m.index + m[0].length, box: { x: (cx - len / 2) / W, y: (cy - 20) / H, width: len / W, height: 40 / H } });
    along += len + 18;
  }
  const xs = words.flatMap((w) => [w.box.x, w.box.x + w.box.width]);
  const yv = words.flatMap((w) => [w.box.y, w.box.y + w.box.height]);
  const box = { x: Math.min(...xs), y: Math.min(...yv), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...yv) - Math.min(...yv) };
  const long = { text, confidence: 1, alternatives: [], words, box, corners: [box.x, box.y, box.x + box.width, box.y, box.x + box.width, box.y + box.height, box.x, box.y + box.height] };
  const leaving = line('Leaving', { x: 100, y: 735, w: 140, h: 40 });
  const forWord = line('for', { x: 255, y: 712, w: 55, h: 30 });
  const level = (t, y) => line(t, { x: 100, y, w: 500, h: 40 });
  const lines = [level('Monday Oct 23', 300), long, level('Back by Sunday', 900), forWord, level('Call the bank about the card', 400), leaving, level('Feed the cat', 1000)];
  const out = P.orderLines(lines, W, H).map((l) => l.text);
  assert.deepEqual(out, ['Monday Oct 23', 'Call the bank about the card', 'Leaving for Bedford Hills on 6:40 train', 'Back by Sunday', 'Feed the cat']);
});

// ---------- build 4: the document reader (iOS 26) ----------

test('document reader: its reading order, paragraphs and wraps are used as they come', () => {
  // Lines placed so geometry alone would read them across, with Vision's order down each column.
  const mk = (text, x, y, order, para, wraps) => ({ ...line(text, { x, y, w: 380 }), order, para, ...(wraps != null ? { wraps } : {}) });
  const lines = [
    mk('right column top line', 560, 100, 2, 1, true),
    mk('left column top line', 60, 100, 0, 0, true),
    mk('right column ends here.', 560, 142, 3, 1, false),
    mk('left column ends here.', 60, 142, 1, 0, false),
    mk('- a list item', 60, 300, 4, -1),
  ];
  const out = P.readingOrder(lines, W, H, { cropped: true });
  assert.deepEqual(out.map((l) => l.text), ['left column top line', 'left column ends here.', 'right column top line', 'right column ends here.', '- a list item']);
  const paras = P.groupParagraphs(out, W, H).map((p) => p.lines);
  assert.equal(paras.length, 3);
  assert.equal(T.modelText(T.buildRuns(paras, true)), 'left column top line left column ends here.\n\nright column top line right column ends here.\n\n- a list item');
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
