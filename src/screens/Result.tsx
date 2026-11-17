import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, fonts, radius, reading, tabular, Theme } from '../theme';
import { useApp } from '../state';
import { deleteDoc, deletePage, Doc, getDoc, markNudgeSeen, Page, reorderPages, setDocCleanUp, setDocTitle, setPageText } from '../db';
import { removeFiles, scanUri } from '../files';
import { docText, pageRuns, pageText } from '../ocr';
import { copyText, exportFile, ExportKind, shareText } from '../exporting';
import { countWords, firstLine, moveItem, Run } from '../text';
import { maybeRequestReview } from '../reviews';
import { FREE_MAX_PAGES } from '../quota';
import Glyph, { GlyphName } from '../ui/Glyph';
import { DIM_PHOTO, Leaf, Mark, Rule, SlipNote, Tray } from '../ui/Paper';
import { isBlurry, shouldNudge } from '../accuracy';
import { GlyphButton, Tap, ToolButton, TopBar, WordButton } from '../ui/Tap';
import DragList from '../ui/DragList';
import { copyHaptic, tick } from '../ui/motion';
import PdfPreview from './PdfPreview';
import { t, whenLabel } from '../i18n';
import type { SourceKind } from '../../App';

/** Let one sheet finish sliding away before the next opens (iOS presents one at a time). */
const after = (fn: () => void) => setTimeout(fn, 420);

/**
 * The text. Read it, tap a word to see where it came from, switch on Clean
 * up to join the page's broken lines into paragraphs, edit it, and get it
 * out: Copy all, Share, Export, or add another page.
 */
export default function ResultScreen({
  docId,
  onBack,
  onAddPage,
  onRetake,
}: {
  docId: number;
  onBack: () => void;
  onAddPage: (kind: SourceKind) => void;
  /** A new photo for one page, from the "hard to read" note. */
  onRetake: (page: Page) => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { isPro, showPaywall, dataVersion, bumpData, say } = useApp();
  const s = t();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [picked, setPicked] = useState<{ page: Page; run: Run; index: number } | null>(null);
  const [tray, setTray] = useState<'export' | 'add' | 'pages' | null>(null);
  const [preview, setPreview] = useState(false);
  // Pages showing the "hard to read" note in this viewing. It is shown once per page, ever.
  const [nudges, setNudges] = useState<Record<number, boolean>>({});
  const scroll = useRef<ScrollView>(null);
  const pageY = useRef<Record<number, number>>({});

  const load = useCallback(async () => {
    const d = await getDoc(docId);
    setDoc(d);
    return d;
  }, [docId]);

  useEffect(() => {
    load().catch(() => setDoc(null));
  }, [load, dataVersion]);

  // A page read with too many unsure words gets the note the first time it is seen.
  useEffect(() => {
    const fresh = (doc?.pages ?? []).filter((p) => !p.nudgeSeen && p.editedText == null && shouldNudge(p.lines));
    if (fresh.length === 0) return;
    setNudges((n) => ({ ...n, ...Object.fromEntries(fresh.map((p) => [p.id, true])) }));
    fresh.forEach((p) => markNudgeSeen(p.id).catch(() => {}));
  }, [doc]);

  if (!doc) return <View style={{ flex: 1, backgroundColor: theme.bg }} />;

  const clean = doc.cleanUp && isPro;
  const pages = doc.pages;
  const allText = () => docText(pages, clean);
  const pageTexts = () => pages.map((p) => pageText(p, clean));

  // ---------- actions ----------

  const onCopy = async () => {
    const text = allText();
    if (!text) return say(s.nothingToCopy);
    if (!(await copyText(text))) return say(s.didNotCopy);
    copyHaptic();
    say(s.copied(countWords(text)));
    maybeRequestReview('firstCopy');
  };

  const onShare = async () => {
    const text = allText();
    if (!text) return say(s.nothingToShare);
    await shareText(text).catch(() => {});
  };

  const onCleanUp = async (on: boolean) => {
    if (!isPro) return showPaywall('cleanup');
    tick();
    await setDocCleanUp(doc.id, on);
    const d = await load();
    if (d) await setDocTitle(d.id, docText(d.pages, on));
    bumpData();
  };

  const onExport = (kind: ExportKind) => {
    setTray(null);
    if (!isPro) {
      if (kind === 'pdf') after(() => setPreview(true));
      else after(() => showPaywall('export'));
      return;
    }
    after(() => {
      exportFile(kind, pageTexts()).catch(() => Alert.alert(s.fileNotMade, s.tryOnceMore));
    });
  };

  const onAdd = (kind: SourceKind) => {
    setTray(null);
    after(() => onAddPage(kind));
  };

  const askAdd = () => {
    if (!isPro && pages.length >= FREE_MAX_PAGES) return showPaywall('batch');
    setTray('add');
  };

  const toggleEdit = async () => {
    if (!editing) {
      setDrafts(Object.fromEntries(pages.map((p) => [p.id, pageText(p, clean)])));
      setPicked(null);
      setEditing(true);
      return;
    }
    await saveDrafts();
    setEditing(false);
  };

  const saveDrafts = async () => {
    for (const p of pages) {
      const draft = drafts[p.id];
      if (draft == null || draft === pageText(p, clean)) continue;
      await setPageText(p.id, draft);
    }
    const d = await load();
    if (d) await setDocTitle(d.id, docText(d.pages, d.cleanUp && isPro));
    bumpData();
  };

  const backToRead = async (p: Page) => {
    await setPageText(p.id, null);
    const d = await load();
    if (d) await setDocTitle(d.id, docText(d.pages, d.cleanUp && isPro));
    bumpData();
  };

  const onDelete = () =>
    Alert.alert(s.deleteScanTitle, s.deleteScanBody, [
      { text: s.keepIt, style: 'cancel' },
      {
        text: s.delete,
        style: 'destructive',
        onPress: async () => {
          removeFiles(await deleteDoc(doc.id));
          bumpData();
          onBack();
        },
      },
    ]);

  const onMove = async (from: number, to: number) => {
    const ids = moveItem(pages.map((p) => p.id), from, to);
    setDoc({ ...doc, pages: moveItem(pages, from, to) });
    await reorderPages(doc.id, ids);
    const d = await load();
    if (d) await setDocTitle(d.id, docText(d.pages, d.cleanUp && isPro));
    bumpData();
  };

  const onDeletePage = (p: Page, i: number) =>
    Alert.alert(s.deletePageTitle(i + 1), s.deletePageBody, [
      { text: s.keepIt, style: 'cancel' },
      {
        text: s.deletePage,
        style: 'destructive',
        onPress: async () => {
          removeFiles(await deletePage(p.id));
          if (pages.length <= 1) {
            removeFiles(await deleteDoc(doc.id));
            setTray(null);
            bumpData();
            return onBack();
          }
          const d = await load();
          if (d) await setDocTitle(d.id, docText(d.pages, d.cleanUp && isPro));
          bumpData();
        },
      },
    ]);

  // ---------- drawing ----------

  const meta = `${whenLabel(doc.createdAt)} · ${s.pages(pages.length)}`;

  return (
    <View style={{ flex: 1 }}>
      <TopBar
        theme={theme}
        back={{ label: s.scansBack, onPress: async () => (editing ? (await saveDrafts(), onBack()) : onBack()) }}
        right={
          <View style={styles.topRight}>
            <WordButton theme={theme} label={editing ? s.done : s.edit} onPress={toggleEdit} strong={editing} />
            {!editing && <GlyphButton theme={theme} glyph="trash" label={s.deleteThisScan} onPress={onDelete} color={theme.inkSoft} />}
          </View>
        }
      />

      <ScrollView ref={scroll} contentContainerStyle={{ paddingBottom: 40 }} automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled">
        <Text style={[styles.meta, { color: theme.inkFaint }, tabular]}>{meta}</Text>

        {pages.length > 1 && (
          <View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
              {pages.map((p, i) => (
                <Tap
                  key={p.id}
                  onPress={() => scroll.current?.scrollTo({ y: Math.max(0, (pageY.current[p.id] ?? 0) - 8), animated: true })}
                  accessibilityRole="button"
                  accessibilityLabel={s.page(i + 1)}
                  style={styles.stripItem}
                >
                  <Leaf theme={theme} uri={scanUri(p.thumb)} width={52} />
                  <Text style={[styles.stripNum, { color: theme.inkSoft }, tabular]}>{i + 1}</Text>
                </Tap>
              ))}
            </ScrollView>
            <View style={styles.stripActions}>
              <WordButton theme={theme} label={s.reorderPages} onPress={() => setTray('pages')} color={theme.inkSoft} />
            </View>
          </View>
        )}

        <View style={[styles.cleanRow, { borderColor: theme.rule }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cleanLabel, { color: theme.ink }]}>{s.cleanUp}</Text>
            <Text style={[styles.cleanSub, { color: theme.inkFaint }]}>
              {s.cleanUpSub}
              {isPro ? '' : '. Pro'}
            </Text>
          </View>
          <Switch
            value={clean}
            onValueChange={onCleanUp}
            trackColor={{ true: theme.ink, false: theme.rule }}
            thumbColor={theme.thumb}
            ios_backgroundColor={theme.rule}
            accessibilityLabel={s.cleanUp}
            accessibilityHint={s.cleanUpSub}
          />
        </View>

        {pages.map((p, i) => (
          <View key={p.id} onLayout={(e) => (pageY.current[p.id] = e.nativeEvent.layout.y)} style={styles.page}>
            {pages.length > 1 && <Text style={[styles.pageLabel, { color: theme.inkFaint }, tabular]}>{s.page(i + 1)}</Text>}
            {nudges[p.id] && !editing && (
              <SlipNote
                theme={theme}
                text={
                  isBlurry(p.sharpness) ? s.nudgeBlurry : s.nudge
                }
                closeLabel={s.dismiss}
                action={{
                  label: s.retake,
                  onPress: () => {
                    setNudges((n) => ({ ...n, [p.id]: false }));
                    onRetake(p);
                  },
                }}
                onClose={() => setNudges((n) => ({ ...n, [p.id]: false }))}
              />
            )}
            {editing ? (
              <TextInput
                multiline
                value={drafts[p.id] ?? ''}
                onChangeText={(t) => setDrafts((d) => ({ ...d, [p.id]: t }))}
                style={[styles.editor, { color: theme.ink, borderColor: theme.rule, backgroundColor: theme.paper }]}
                selectionColor={theme.highlight}
                scrollEnabled={false}
                autoCorrect
                accessibilityLabel={pages.length > 1 ? s.textOfPage(i + 1) : s.textLabel}
              />
            ) : (
              <PageText theme={theme} page={p} clean={clean} picked={picked?.page.id === p.id ? picked.index : -1} onWord={(run, index) => setPicked({ page: p, run, index })} />
            )}
            {!editing && p.editedText != null && (
              <WordButton theme={theme} label={s.useAsRead} onPress={() => backToRead(p)} color={theme.inkFaint} />
            )}
          </View>
        ))}
      </ScrollView>

      <View style={[styles.toolbar, { borderTopColor: theme.rule, backgroundColor: theme.bg, paddingBottom: Math.max(insets.bottom, 8) }]}>
        <ToolButton theme={theme} glyph="copy" label={s.copyAll} onPress={onCopy} />
        <ToolButton theme={theme} glyph="share" label={s.share} onPress={onShare} a11y={s.shareA11y} />
        <ToolButton theme={theme} glyph="export" label={s.export} onPress={() => setTray('export')} tag={isPro ? undefined : 'Pro'} />
        <ToolButton theme={theme} glyph="addPage" label={s.addPage} onPress={askAdd} />
      </View>

      <Tray theme={theme} visible={tray === 'export'} onClose={() => setTray(null)} title={s.export}>
        <TrayChoice theme={theme} glyph="export" label={s.plainText} ext=".txt" sub={s.opensAnywhere} tag={!isPro} onPress={() => onExport('txt')} />
        <TrayChoice theme={theme} glyph="export" label={s.pdf} ext=".pdf" sub={isPro ? s.pdfSubPro : s.pdfSubFree} tag={!isPro} onPress={() => onExport('pdf')} />
        <TrayChoice theme={theme} glyph="export" label={s.markdown} ext=".md" sub={s.forNotesApps} tag={!isPro} onPress={() => onExport('md')} />
      </Tray>

      <Tray theme={theme} visible={tray === 'add'} onClose={() => setTray(null)} title={s.addAPage}>
        <TrayChoice theme={theme} glyph="camera" label={s.scan} onPress={() => onAdd('scan')} />
        <TrayChoice theme={theme} glyph="picture" label={s.photos} onPress={() => onAdd('photos')} />
        <TrayChoice theme={theme} glyph="folder" label={s.files} onPress={() => onAdd('files')} />
      </Tray>

      <Tray theme={theme} visible={tray === 'pages'} onClose={() => setTray(null)} title={s.pagesTitle}>
        <Text style={[styles.trayNote, { color: theme.inkSoft }]}>{s.dragGrip}</Text>
        <Rule theme={theme} />
        <ScrollView style={{ maxHeight: 420 }} scrollEnabled={pages.length > 5}>
          <DragList
            theme={theme}
            items={pages}
            keyOf={(p) => String(p.id)}
            rowHeight={84}
            onMove={onMove}
            labelOf={(p, i) => s.pageRow(i + 1, firstLine(pageText(p, clean), 40))}
            renderRow={(p, i) => (
              <View style={styles.pageRow}>
                <Leaf theme={theme} uri={scanUri(p.thumb)} width={44} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.pageRowTitle, { color: theme.ink }, tabular]}>{s.page(i + 1)}</Text>
                  <Text style={[styles.pageRowSub, { color: theme.inkFaint }]} numberOfLines={1}>
                    {firstLine(pageText(p, clean), 40) || s.noTextFound}
                  </Text>
                </View>
                <GlyphButton theme={theme} glyph="trash" label={s.deletePageN(i + 1)} onPress={() => onDeletePage(p, i)} color={theme.inkFaint} />
              </View>
            )}
          />
        </ScrollView>
      </Tray>

      <SourceTray theme={theme} picked={picked} onClose={() => setPicked(null)} onEdit={() => (setPicked(null), toggleEdit())} />

      <PdfPreview
        visible={preview}
        pages={pageTexts()}
        onClose={() => setPreview(false)}
        onLocked={() => {
          setPreview(false);
          after(() => showPaywall('export'));
        }}
      />
    </View>
  );
}

// ---------- the text of a page ----------

/**
 * Unedited pages draw word by word, so a word can be tapped for its source
 * and unsure words get a faint dotted underline. Edited pages are plain text.
 */
function PageText({ theme, page, clean, picked, onWord }: { theme: Theme; page: Page; clean: boolean; picked: number; onWord: (run: Run, index: number) => void }) {
  const runs = pageRuns(page, clean);
  if (runs == null) {
    const text = pageText(page, clean);
    return (
      <View style={{ gap: reading.paragraphGap }}>
        {text.split(/\n{2,}/).map((para, i) => (
          <Text key={i} style={[styles.reading, { color: theme.ink }]} selectable>
            {para}
          </Text>
        ))}
      </View>
    );
  }
  if (runs.length === 0) {
    return <Text style={[styles.nothing, { color: theme.inkFaint }]}>{t().nothingOnPage}</Text>;
  }
  // Split into paragraphs where a run ends with a blank line.
  const paragraphs: { run: Run; index: number }[][] = [[]];
  runs.forEach((run, index) => {
    paragraphs[paragraphs.length - 1].push({ run, index });
    if (run.after.includes('\n\n')) paragraphs.push([]);
  });
  return (
    <View style={{ gap: reading.paragraphGap }}>
      {paragraphs
        .filter((p) => p.length > 0)
        .map((para, i) => (
          <Text key={i} style={[styles.reading, { color: theme.ink }]} accessibilityHint={t().wordHint}>
            {para.map(({ run: r, index }) => {
              const on = picked === index;
              return (
                <Text key={index}>
                  <Text
                    onPress={() => onWord(r, index)}
                    style={[
                      on && { backgroundColor: theme.highlightWash },
                      r.unsure && { textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: theme.inkFaint },
                    ]}
                  >
                    {r.text}
                  </Text>
                  {r.after.replace(/\n\n+$/, '')}
                </Text>
              );
            })}
          </Text>
        ))}
    </View>
  );
}

// ---------- the source of a word ----------

/** The line in the photo the word came from, with the word under the highlighter. */
function SourceTray({ theme, picked, onClose, onEdit }: { theme: Theme; picked: { page: Page; run: Run } | null; onClose: () => void; onEdit: () => void }) {
  const { width: screenW } = useWindowDimensions();
  const page = picked?.page;
  const run = picked?.run;
  const uri = page ? scanUri(page.image) ?? scanUri(page.thumb) : null;
  const line = page && run ? page.lines[run.line] : null;

  let body: React.ReactNode = null;
  if (page && run && line && uri && page.width > 0 && page.height > 0) {
    const pw = page.width;
    const ph = page.height;
    const lb = line.box;
    const lineH = lb.height;
    // The line with some room around it.
    const rx = Math.max(0, lb.x - 0.03);
    const ry = Math.max(0, lb.y - lineH * 0.8);
    const rw = Math.min(1 - rx, lb.width + 0.06);
    const rh = Math.min(1 - ry, lineH * 2.6);
    const viewW = screenW - 40;
    let scale = viewW / (rw * pw);
    const maxH = 200;
    if (rh * ph * scale > maxH) scale = maxH / (rh * ph);
    const boxW = rw * pw * scale;
    const boxH = rh * ph * scale;
    const wb = run.box ?? lb;
    body = (
      <View style={{ alignItems: 'center' }}>
        <View style={[styles.sourceBox, { width: boxW, height: boxH, borderColor: theme.rule }]}>
          <Image source={{ uri }} style={{ position: 'absolute', width: pw * scale, height: ph * scale, left: -rx * pw * scale, top: -ry * ph * scale, opacity: theme.isDark ? DIM_PHOTO : 1 }} />
          <Mark theme={theme} x={(wb.x - rx) * pw * scale - 3} y={(wb.y - ry) * ph * scale - 2} width={wb.width * pw * scale + 6} height={wb.height * ph * scale + 4} />
        </View>
      </View>
    );
  } else if (picked) {
    body = <Text style={[styles.trayNote, { color: theme.inkSoft }]}>{t().photoNotKept}</Text>;
  }

  return (
    <Tray theme={theme} visible={picked != null} onClose={onClose}>
      <View style={styles.sourceHead}>
        <Text style={[styles.sourceWord, { color: theme.ink }]} numberOfLines={1}>
          {run?.text}
        </Text>
        <Text style={[styles.sourceNote, { color: theme.inkFaint }]}>{run?.unsure ? t().worthALook : t().whereOnPage}</Text>
      </View>
      {body}
      <View style={styles.sourceActions}>
        <WordButton theme={theme} label={t().fixText} onPress={onEdit} />
        <WordButton theme={theme} label={t().close} onPress={onClose} color={theme.inkSoft} />
      </View>
    </Tray>
  );
}

function TrayChoice({
  theme,
  glyph,
  label,
  ext,
  sub,
  tag,
  onPress,
}: {
  theme: Theme;
  glyph: GlyphName;
  label: string;
  ext?: string;
  sub?: string;
  tag?: boolean;
  onPress: () => void;
}) {
  return (
    <Tap
      onPress={onPress}
      style={[styles.choice, { borderBottomColor: theme.rule }]}
      pressedStyle={{ backgroundColor: theme.sunk }}
      accessibilityRole="button"
      accessibilityLabel={`${label}${ext ? `, ${ext}` : ''}${tag ? `, ${t().needsPro}` : ''}`}
      accessibilityHint={sub}
    >
      <Glyph name={glyph} size={28} color={theme.ink} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.choiceLabel, { color: theme.ink }]}>
          {label}
          {ext ? <Text style={{ color: theme.inkFaint }}> {ext}</Text> : null}
        </Text>
        {sub ? <Text style={[styles.choiceSub, { color: theme.inkFaint }]}>{sub}</Text> : null}
      </View>
      {tag ? <Text style={[styles.pro, { color: theme.inkSoft, borderColor: theme.rule }]}>Pro</Text> : null}
    </Tap>
  );
}

const styles = StyleSheet.create({
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { fontSize: 14, paddingHorizontal: 20, marginTop: 2 },
  strip: { paddingHorizontal: 16, paddingTop: 14, gap: 12 },
  stripItem: { alignItems: 'center', gap: 4 },
  stripNum: { fontSize: 13 },
  stripActions: { paddingHorizontal: 20 },
  cleanRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, paddingHorizontal: 20, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  cleanLabel: { fontFamily: fonts.heading, fontSize: 19 },
  cleanSub: { fontSize: 14, lineHeight: 19, marginTop: 1 },
  page: { paddingHorizontal: 22, paddingTop: 22 },
  pageLabel: { fontFamily: fonts.heading, fontSize: 15, marginBottom: 8 },
  reading: { fontSize: reading.fontSize, lineHeight: reading.lineHeight },
  nothing: { fontSize: 17, lineHeight: 24 },
  editor: { fontSize: reading.fontSize, lineHeight: reading.lineHeight, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sheet, padding: 12, minHeight: 160, textAlignVertical: 'top' },
  toolbar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6, paddingHorizontal: 6 },
  trayNote: { fontSize: 15, lineHeight: 21, paddingHorizontal: 20, paddingBottom: 12 },
  pageRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  pageRowTitle: { fontFamily: fonts.heading, fontSize: 18 },
  pageRowSub: { fontSize: 14, marginTop: 2 },
  sourceHead: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 14 },
  sourceWord: { fontSize: 26, fontWeight: fonts.weight.semibold },
  sourceNote: { fontSize: 14, marginTop: 2 },
  sourceBox: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sheet },
  sourceActions: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 10 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 64, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth },
  choiceLabel: { fontSize: 18, fontWeight: fonts.weight.semibold },
  choiceSub: { fontSize: 14, marginTop: 1 },
  pro: { fontSize: 12, fontWeight: fonts.weight.bold, letterSpacing: 0.5, borderWidth: 1, borderRadius: radius.sheet, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
});
