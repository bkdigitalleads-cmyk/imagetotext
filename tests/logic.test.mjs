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
  const sizes = [[520, 46], [560, 38], [760, 36], [600, 40], [590, 39], [300, 42], [290, 37], [300, 41]];
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
    ['1/1\u20442 to 2 minutes', '1/1\u20442 to 2 minutes'], // pieces: shown as read, never "1/½"
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

test('nudge: shows when more than 10% of the words are on unsure lines', () => {
  const good = Array.from({ length: 9 }, (_, i) => line('one two three four five', { y: i * 50, confidence: 0.9 }));
  assert.equal(A.shouldNudge([...good, line('six seven eight nine ten', { y: 600, confidence: 0.5 })]), false); // exactly 10%
  assert.equal(A.shouldNudge([...good, line('six seven eight nine ten eleven', { y: 600, confidence: 0.5 })]), true);
  assert.equal(A.shouldNudge([]), false);
  assert.equal(A.unsureShare([line('- , .', { y: 0, confidence: 0.1 }), line('word', { y: 50, confidence: 0.9 })]), 0); // punctuation is not a word
});

// Build 2's note never showed on the phone: Vision's confidence there is
// coarse (1.0, 0.5, 0.3), and the second pass lifted most low lines to 1.0
// before the note was decided. Now the first look counts, and so do words
// the phone's dictionary does not know where Vision was not fully sure.
test('nudge: shows for the magazine spread and a blurry photo, not for a straight cookbook shot', () => {
  // Magazine: a third of the lines were read at 0.5 first, then lifted to 1.0 by the second pass.
  const magazine = MAG_ORDER.map((t, i) => ({ ...line(t, { y: i * 50 }), ...(i % 3 === 1 ? { firstConfidence: 0.5 } : {}) }));
  assert.equal(A.shouldNudge(magazine), true);
  // Blurry: low lines throughout, some garbled words the dictionary does not know.
  const blurry = COOKBOOK.flat().map((t, i) => ({ ...line(t, { y: i * 50, confidence: i % 2 ? 0.5 : 1 }), unknown: i % 2 ? [1] : [] }));
  assert.equal(A.shouldNudge(blurry), true);
  // Straight cookbook shot: every line at 1.0, the runner-up agrees, a couple of real but rare words ("haricots") unknown.
  const straight = [...COOKBOOK.flat(), '4 POUND haricots verts, stems removed'].map((t, i) => ({
    ...line(t, { y: i * 50, confidence: 1, alternatives: [t] }),
    unknown: t.startsWith('4 POUND') ? [2, 3] : [],
  }));
  assert.equal(A.shouldNudge(straight), false);
  const c = A.nudgeCounts(straight);
  assert.equal(c.unknown, 2);
  assert.equal(c.unsure, 0);
  // An unknown word counts when Vision was torn about it (the runner-up has another word there).
  const torn = { ...line('stems removd', { y: 0, confidence: 1, alternatives: ['stems removed'] }), unknown: [1] };
  assert.equal(A.nudgeCounts([torn]).unknownUnsure, 1);
  // Confident garbage: most checked words unknown to the dictionary.
  const garbled = ['tha qnick brcwn fcx jumqs', 'ovcr tbe lazv doq agaim', 'amd tben ruus awav fast'].map((t, i) => ({ ...line(t, { y: i * 50 }), unknown: [0, 1, 2, 3] }));
  assert.equal(A.shouldNudge(garbled), true);
  assert.equal(A.NUDGE_UNKNOWN_SHARE, 0.3);
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
