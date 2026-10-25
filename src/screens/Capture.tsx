import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Image, Linking, Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Svg, { Circle, Path } from 'react-native-svg';
import { darkTheme, fonts, lightTheme, radius, tabular } from '../theme';
import { useApp } from '../state';
import { applyCrop, Crop, detectPage, PageFind, readIntoDoc, ReadResult, Source, turnedSize } from '../ocr';
import { BLUR_THRESHOLD, FOCUS_HOLD_SECONDS, focusPoint, guessQuad, isBlurry, isConvex, quadBounds, turnQuad } from '../accuracy';
import { focusAt, sharpness } from '../../modules/vision-ocr';
import type { Quad } from '../../modules/vision-ocr';
import { captureHaptic, useReduceMotion } from '../ui/motion';
import { GlyphButton, InkButton, LiveButton, Tap, WordButton } from '../ui/Tap';
import { SlipNote } from '../ui/Paper';

/**
 * Getting pages in: the camera with a page-shaped guide, then crop and
 * rotate each page, then reading. A full-screen modal so nothing else
 * competes for the thumb. Photos and files skip the camera and start at
 * cropping. When Vision finds the page in a photo, the crop starts on the
 * page's own outline (four corners to drag), and the page is squared up
 * before reading; otherwise it is a plain rectangle. Recognition always runs
 * on the full-resolution image.
 *
 * The photo steps sit on a dark ink surround (a darkroom, in both light and
 * dark mode) so the page is the brightest thing; controls are paper colored.
 */
export type CaptureStart = { kind: 'camera' } | { kind: 'sources'; sources: Source[]; origin: 'photos' | 'files' };

const DARK = '#151412';
const PAPER = lightTheme.paper;
const PAPER_SOFT = 'rgba(251, 248, 241, 0.72)';
/** The darkroom always uses the night palette for its controls. */
const room = { ...darkTheme, bg: DARK, ink: PAPER, sunk: '#2A2824', highlight: lightTheme.highlight };

interface Item {
  src: Source;
  crop: Crop;
  /** The person changed the crop, so a late page detection must not overwrite it. */
  touched?: boolean;
  /** Vision found the page and the crop follows its outline. */
  found?: boolean;
  /** No page was found: the corner handles start on a guess for the person to drag. */
  guess?: boolean;
}

/** A crop that follows a found page outline (on the unturned photo). */
const pageCrop = (quad: Quad): Crop => ({ turns: 0, ...quadBounds(quad), quad });

const fullCrop = (src: Source, turns = 0): Crop => {
  const t = turnedSize(src, turns);
  return { turns, x: 0, y: 0, width: t.width, height: t.height };
};

export default function CaptureFlow({
  visible,
  start,
  docId,
  allowed,
  replacePageId = null,
  onDone,
  onCancel,
}: {
  visible: boolean;
  start: CaptureStart;
  docId: number | null;
  /** Most pages this batch may add; 0 means no limit. */
  allowed: number;
  /** Retake: the one new page takes this page's place. */
  replacePageId?: number | null;
  onDone: (res: ReadResult) => void;
  onCancel: () => void;
}) {
  const { settings } = useApp();
  const [items, setItems] = useState<Item[]>([]);
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState<'camera' | 'crop' | 'reading' | 'error'>('camera');
  const [done, setDone] = useState(0);
  const [prepared, setPrepared] = useState<Source[]>([]);

  /**
   * Looks for the page in a photo. While the crop is untouched: a found page
   * starts the crop on its outline; when none is found, corner handles start
   * on the camera's guide (or 6% in from each edge) for the person to drag.
   * A photo that is all page already (a screenshot, a scan, a PDF page) keeps
   * the whole image.
   */
  const detect = (src: Source) => {
    const settle = (find: PageFind) =>
      setItems((list) =>
        list.map((it) => {
          if (it.src.uri !== src.uri || it.touched) return it;
          if (find.kind === 'page') return { ...it, crop: pageCrop(find.quad), found: true, guess: false };
          if (find.kind === 'whole') return it;
          const guide = it.crop.x > 0 || it.crop.y > 0 || it.crop.width < src.width || it.crop.height < src.height ? it.crop : undefined;
          return { ...it, crop: pageCrop(guessQuad(src, guide)), found: false, guess: true };
        })
      );
    detectPage(src)
      .then(settle)
      .catch(() => settle({ kind: 'none' }));
  };

  useEffect(() => {
    if (!visible) return;
    setDone(0);
    setIndex(0);
    if (start.kind === 'camera') {
      setItems([]);
      setStep('camera');
    } else {
      setItems(start.sources.map((src) => ({ src, crop: fullCrop(src) })));
      start.sources.forEach(detect);
      setStep('crop');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, start]);

  const roomForMore = replacePageId == null && (allowed === 0 || items.length < allowed);

  const read = async (list: Item[]) => {
    setStep('reading');
    setDone(0);
    setPrepared([]);
    try {
      const ready: Source[] = [];
      for (const it of list) {
        // A found page or a crop the person set (not the whole photo) leaves no scraps of a facing page to drop.
        const whole = !it.crop.quad && it.crop.turns % 4 === 0 && it.crop.x <= 0 && it.crop.y <= 0 && it.crop.width >= it.src.width && it.crop.height >= it.src.height;
        ready.push(await applyCrop(it.src, it.crop, !whole && (it.found === true || it.touched === true)));
      }
      setPrepared(ready);
      const res = await readIntoDoc(ready, {
        docId,
        languages: settings.languages,
        keepOriginals: settings.keepOriginals,
        origin: start.kind === 'camera' ? 'scan' : start.origin,
        replacePageId,
        onPage: setDone,
      });
      onDone(res);
    } catch {
      setStep('error');
    }
  };

  const current = items[index];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onCancel}>
      <View style={[styles.root, { backgroundColor: DARK }]}>
        {step === 'camera' && (
          <CameraStep
            pageNumber={items.length + 1}
            onClose={() => (items.length > 0 ? setStep('crop') : onCancel())}
            onShot={(src, crop) => {
              const next = [...items, { src, crop }];
              setItems(next);
              setIndex(next.length - 1);
              setStep('crop');
              detect(src);
            }}
          />
        )}
        {step === 'crop' && current && (
          <CropStep
            key={`${index}-${current.src.uri}`}
            item={current}
            position={{ index, total: items.length }}
            onChange={(crop) => setItems((list) => list.map((it, i) => (i === index ? { ...it, crop, touched: true, guess: it.guess === true && crop.quad != null } : it)))}
            onCancel={onCancel}
            primary={
              index < items.length - 1
                ? { label: 'Next page', onPress: () => setIndex(index + 1) }
                : { label: items.length > 1 ? `Read ${items.length} pages` : 'Read it', onPress: () => read(items) }
            }
            secondary={start.kind === 'camera' && index === items.length - 1 && roomForMore ? { label: 'Scan another page', onPress: () => setStep('camera') } : undefined}
            skipAll={items.length > 1 && index < items.length - 1 ? () => read(items) : undefined}
          />
        )}
        {step === 'reading' && <ReadingStep src={prepared[Math.min(done, prepared.length - 1)]} done={done} total={items.length} />}
        {step === 'error' && (
          <View style={styles.center}>
            <Text style={styles.errorTitle}>That page did not read.</Text>
            <Text style={styles.errorLine}>Try once more. If it keeps happening, a new photo in better light usually works.</Text>
            <View style={styles.errorActions}>
              <LiveButton theme={room} label="Try again" onPress={() => read(items)} />
              <InkButton theme={room} label="Close" onPress={onCancel} />
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ---------- camera ----------

function CameraStep({ pageNumber, onShot, onClose }: { pageNumber: number; onShot: (src: Source, crop: Crop) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const [perm, requestPerm] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [torch, setTorch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [area, setArea] = useState({ width: 0, height: 0 });
  // A capture that measured blurry, waiting for Retake or Use anyway.
  const [blurry, setBlurry] = useState<{ src: Source; crop: Crop } | null>(null);
  // The focus ring where the preview was last tapped.
  const [ring, setRing] = useState<{ x: number; y: number; key: number } | null>(null);
  const ringFade = useRef(new Animated.Value(0)).current;
  const ringScale = useRef(new Animated.Value(1)).current;

  // A page-shaped guide: most of the width, a letter page's proportions.
  const gw = area.width - 48;
  const gh = Math.min(gw * 1.3, area.height - 150);
  const gx = (area.width - gw) / 2;
  const gy = Math.max(70, (area.height - gh) / 2 - 10);

  /** Tap to focus: focus and expose at that point, held briefly, with a ring that fades. */
  const tapToFocus = (x: number, y: number) => {
    const p = focusPoint({ x, y }, area);
    focusAt(p.x, p.y, FOCUS_HOLD_SECONDS);
    setRing({ x, y, key: Date.now() });
    ringFade.setValue(1);
    ringScale.setValue(reduce ? 1 : 1.35);
    Animated.parallel([
      Animated.timing(ringScale, { toValue: 1, duration: reduce ? 0 : 220, useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(FOCUS_HOLD_SECONDS * 1000 - 600),
        Animated.timing(ringFade, { toValue: 0, duration: 600, useNativeDriver: true }),
      ]),
    ]).start();
  };

  const shoot = async () => {
    if (busy || !camera.current) return;
    setBusy(true);
    captureHaptic();
    try {
      const pic = await camera.current.takePictureAsync({ quality: 1, exif: false });
      if (!pic) return;
      const src = { uri: pic.uri, width: pic.width, height: pic.height };
      // Start the crop at the guide (the preview fills the screen, so map it
      // back onto the photo), with a little margin so no letters are lost.
      const scale = Math.max(area.width / src.width, area.height / src.height);
      const offX = (src.width * scale - area.width) / 2;
      const offY = (src.height * scale - area.height) / 2;
      const m = 0.04;
      const x = Math.max(0, (gx + offX) / scale - src.width * m);
      const y = Math.max(0, (gy + offY) / scale - src.height * m);
      const w = Math.min(src.width - x, gw / scale + src.width * m * 2);
      const h = Math.min(src.height - y, gh / scale + src.height * m * 2);
      const crop = w > 50 && h > 50 ? { turns: 0, x, y, width: w, height: h } : fullCrop(src);
      // A soft photo reads badly; say so before it is used. Measured on the page area only.
      const sharp = await sharpness(src.uri, { x: crop.x / src.width, y: crop.y / src.height, width: crop.width / src.width, height: crop.height / src.height });
      console.log(`[ocr] capture sharpness ${sharp == null ? 'unknown' : Math.round(sharp)} (blurry under ${BLUR_THRESHOLD})`);
      if (isBlurry(sharp)) setBlurry({ src, crop });
      else onShot(src, crop);
    } catch {
      // the camera hiccuped; the button works again
    } finally {
      setBusy(false);
    }
  };

  if (!perm) return <View style={styles.center} />;
  if (!perm.granted) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.errorTitle}>The camera reads pages right here on the phone.</Text>
        <Text style={styles.errorLine}>Nothing is uploaded. Allow the camera and point it at a page.</Text>
        <View style={styles.errorActions}>
          {perm.canAskAgain ? (
            <LiveButton theme={room} label="Allow the camera" onPress={() => requestPerm()} />
          ) : (
            <LiveButton theme={room} label="Open Settings" onPress={() => Linking.openSettings()} />
          )}
          <InkButton theme={room} label="Not now" onPress={onClose} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root} onLayout={(e) => setArea(e.nativeEvent.layout)}>
      {/* expo-camera's autofocus "off" is continuous autofocus; "on" focuses once and locks (build 1's soft photos). */}
      <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" enableTorch={torch} autofocus="off" />
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={(e) => tapToFocus(e.nativeEvent.locationX, e.nativeEvent.locationY)}
        accessibilityRole="button"
        accessibilityLabel="Camera view"
        accessibilityHint="Tap the page to focus on it"
      />
      {area.width > 0 && (
        <>
          {/* the dim surround and the guide's corners */}
          <View pointerEvents="none" style={[styles.dim, { left: 0, right: 0, top: 0, height: gy }]} />
          <View pointerEvents="none" style={[styles.dim, { left: 0, right: 0, top: gy + gh, bottom: 0 }]} />
          <View pointerEvents="none" style={[styles.dim, { left: 0, width: gx, top: gy, height: gh }]} />
          <View pointerEvents="none" style={[styles.dim, { right: 0, width: gx, top: gy, height: gh }]} />
          <Corners x={gx} y={gy} w={gw} h={gh} area={area} />
          {ring && (
            <Animated.View
              key={ring.key}
              pointerEvents="none"
              style={[styles.focusRing, { left: ring.x - 34, top: ring.y - 34, opacity: ringFade, transform: [{ scale: ringScale }] }]}
            />
          )}
          <Text pointerEvents="none" style={[styles.hint, { top: gy - 44 }]} maxFontSizeMultiplier={1.3}>
            {pageNumber > 1 ? `Page ${pageNumber}. ` : ''}Fill the frame with the page, straight on.
          </Text>
        </>
      )}
      {blurry && (
        <View style={[styles.blurSlip, { bottom: Math.max(insets.bottom, 16) + 120 }]}>
          <SlipNote
            theme={room}
            text="That looks blurry. Hold still and tap the page to focus."
            action={{ label: 'Retake', onPress: () => setBlurry(null) }}
            closeLabel="Use anyway"
            onClose={() => {
              const b = blurry;
              setBlurry(null);
              onShot(b.src, b.crop);
            }}
          />
        </View>
      )}
      <View style={[styles.cameraBar, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        <GlyphButton theme={room} glyph="close" label="Close" onPress={onClose} color={PAPER} size={52} />
        <Tap onPress={shoot} disabled={busy} accessibilityRole="button" accessibilityLabel="Take the photo" style={styles.shutterRing} pressedStyle={{ transform: [{ scale: 0.94 }] }}>
          <View style={[styles.shutter, { backgroundColor: room.highlight }]}>{busy && <ActivityIndicator color={lightTheme.onHighlight} />}</View>
        </Tap>
        <GlyphButton theme={room} glyph="torch" label={torch ? 'Light off' : 'Light on'} onPress={() => setTorch(!torch)} on={torch} color={PAPER} size={52} />
      </View>
    </View>
  );
}

/** Four drawn corners around the page guide. */
function Corners({ x, y, w, h, area }: { x: number; y: number; w: number; h: number; area: { width: number; height: number } }) {
  const l = 30;
  const d = [
    `M${x} ${y + l} L${x} ${y + 4} Q${x} ${y} ${x + 4} ${y} L${x + l} ${y}`,
    `M${x + w - l} ${y} L${x + w - 4} ${y} Q${x + w} ${y} ${x + w} ${y + 4} L${x + w} ${y + l}`,
    `M${x + w} ${y + h - l} L${x + w} ${y + h - 4} Q${x + w} ${y + h} ${x + w - 4} ${y + h} L${x + w - l} ${y + h}`,
    `M${x + l} ${y + h} L${x + 4} ${y + h} Q${x} ${y + h} ${x} ${y + h - 4} L${x} ${y + h - l}`,
  ].join(' ');
  return (
    <Svg width={area.width} height={area.height} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Path d={d} stroke={PAPER} strokeWidth={4} fill="none" strokeLinecap="round" />
    </Svg>
  );
}

// ---------- crop and rotate ----------

type DragMode = 'tl' | 'tr' | 'bl' | 'br' | 'move' | 'corner0' | 'corner1' | 'corner2' | 'corner3' | 'quadMove';

function CropStep({
  item,
  position,
  onChange,
  onCancel,
  primary,
  secondary,
  skipAll,
}: {
  item: Item;
  position: { index: number; total: number };
  onChange: (crop: Crop) => void;
  onCancel: () => void;
  primary: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
  skipAll?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { src, crop } = item;
  const [area, setArea] = useState({ width: 0, height: 0 });
  const pad = 22;
  const turned = turnedSize(src, crop.turns);
  const s = area.width > 0 ? Math.min((area.width - pad * 2) / turned.width, (area.height - pad * 2) / turned.height) : 0;
  const W = turned.width * s;
  const H = turned.height * s;
  const left = (area.width - W) / 2;
  const top = (area.height - H) / 2;
  const sideways = crop.turns % 2 === 1;
  const imgW = sideways ? H : W;
  const imgH = sideways ? W : H;

  // Live values for the gesture handler, which is made once.
  const live = useRef({ s, crop, turned, left, top });
  live.current = { s, crop, turned, left, top };
  const drag = useRef<{ mode: DragMode; start: Crop } | null>(null);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          const { s: sc, crop: c, left: l, top: t } = live.current;
          const px = (e.nativeEvent.locationX - l) / sc;
          const py = (e.nativeEvent.locationY - t) / sc;
          const reach = 44 / sc;
          const near = (cx: number, cy: number) => Math.abs(px - cx) < reach && Math.abs(py - cy) < reach;
          let mode: DragMode = 'move';
          if (c.quad) {
            // The page outline: the nearest corner within reach, or the whole outline.
            const dist = c.quad.map((q) => Math.hypot(q.x - px, q.y - py));
            const i = dist.indexOf(Math.min(...dist));
            mode = dist[i] < reach * 1.3 ? (`corner${i}` as DragMode) : 'quadMove';
          } else if (near(c.x, c.y)) mode = 'tl';
          else if (near(c.x + c.width, c.y)) mode = 'tr';
          else if (near(c.x, c.y + c.height)) mode = 'bl';
          else if (near(c.x + c.width, c.y + c.height)) mode = 'br';
          drag.current = { mode, start: c };
        },
        onPanResponderMove: (_, g) => {
          const d = drag.current;
          if (!d) return;
          const { s: sc, turned: tz } = live.current;
          const dx = g.dx / sc;
          const dy = g.dy / sc;
          const min = Math.max(80, Math.min(tz.width, tz.height) * 0.12);
          const q0 = d.start.quad;
          if (q0) {
            let q: Quad;
            if (d.mode === 'quadMove') {
              const b = quadBounds(q0);
              const mx = Math.min(Math.max(-b.x, dx), tz.width - b.x - b.width);
              const my = Math.min(Math.max(-b.y, dy), tz.height - b.y - b.height);
              q = q0.map((p) => ({ x: p.x + mx, y: p.y + my })) as Quad;
            } else {
              const i = Number(d.mode.slice(6));
              q = q0.map((p, k) =>
                k === i ? { x: Math.min(tz.width, Math.max(0, p.x + dx)), y: Math.min(tz.height, Math.max(0, p.y + dy)) } : p
              ) as Quad;
              // A corner dragged across the others would twist the page: stop at the last good shape.
              if (!isConvex(q)) return;
            }
            onChange({ ...d.start, ...quadBounds(q), quad: q });
            return;
          }
          let { x, y, width, height } = d.start;
          if (d.mode === 'move') {
            x = Math.min(Math.max(0, x + dx), tz.width - width);
            y = Math.min(Math.max(0, y + dy), tz.height - height);
          } else {
            let x2 = x + width;
            let y2 = y + height;
            if (d.mode === 'tl' || d.mode === 'bl') x = Math.min(Math.max(0, x + dx), x2 - min);
            if (d.mode === 'tr' || d.mode === 'br') x2 = Math.max(Math.min(tz.width, x2 + dx), x + min);
            if (d.mode === 'tl' || d.mode === 'tr') y = Math.min(Math.max(0, y + dy), y2 - min);
            if (d.mode === 'bl' || d.mode === 'br') y2 = Math.max(Math.min(tz.height, y2 + dy), y + min);
            width = x2 - x;
            height = y2 - y;
          }
          onChange({ ...d.start, x, y, width, height });
        },
        onPanResponderRelease: () => {
          drag.current = null;
        },
        onPanResponderTerminate: () => {
          drag.current = null;
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const r = { x: left + crop.x * s, y: top + crop.y * s, w: crop.width * s, h: crop.height * s };
  const untouched = !crop.quad && crop.turns === 0 && crop.x === 0 && crop.y === 0 && crop.width === src.width && crop.height === src.height;
  // The page outline on screen.
  const shown = crop.quad?.map((p) => ({ x: left + p.x * s, y: top + p.y * s }));
  const rotate = () => {
    const turns = (crop.turns + 1) % 4;
    if (!crop.quad) return onChange(fullCrop(src, turns));
    const q = turnQuad(crop.quad, turned);
    onChange({ turns, ...quadBounds(q), quad: q });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.cropTop}>
        <WordButton theme={room} label="Cancel" onPress={onCancel} color={PAPER} />
        <Text style={[styles.cropTitle, tabular]} maxFontSizeMultiplier={1.3} numberOfLines={2}>
          {position.total > 1 ? `Page ${position.index + 1} of ${position.total}` : item.guess ? 'Drag the corners\nto the page' : crop.quad ? 'Page found' : 'Crop'}
        </Text>
        <View style={styles.cropTools}>
          {!untouched && <GlyphButton theme={room} glyph="crop" label="Use the whole photo" onPress={() => onChange(fullCrop(src, 0))} color={PAPER} />}
          <GlyphButton theme={room} glyph="rotate" label="Rotate a quarter turn" onPress={rotate} color={PAPER} />
        </View>
      </View>
      {position.total > 1 && item.guess && (
        <Text style={styles.cropHint} maxFontSizeMultiplier={1.3}>
          Drag the corners to the page
        </Text>
      )}

      <View
        style={{ flex: 1 }}
        onLayout={(e) => setArea(e.nativeEvent.layout)}
        {...pan.panHandlers}
        accessible
        accessibilityLabel={
          item.guess
            ? 'No page edge was found. Drag each corner to a corner of the page.'
            : crop.quad
            ? 'The page was found. Drag a corner to fit the edge of the page.'
            : 'Crop area. Drag a corner to crop, or drag inside to move it.'
        }
      >
        {s > 0 && (
          <>
            <Image
              source={{ uri: src.uri }}
              style={{ position: 'absolute', width: imgW, height: imgH, left: left + (W - imgW) / 2, top: top + (H - imgH) / 2, transform: [{ rotate: `${crop.turns * 90}deg` }] }}
              resizeMode="stretch"
            />
            {shown ? (
              <PageOutline points={shown} area={area} />
            ) : (
              <>
                <View pointerEvents="none" style={[styles.shadeCrop, { left: 0, right: 0, top: 0, height: r.y }]} />
                <View pointerEvents="none" style={[styles.shadeCrop, { left: 0, right: 0, top: r.y + r.h, bottom: 0 }]} />
                <View pointerEvents="none" style={[styles.shadeCrop, { left: 0, width: r.x, top: r.y, height: r.h }]} />
                <View pointerEvents="none" style={[styles.shadeCrop, { left: r.x + r.w, right: 0, top: r.y, height: r.h }]} />
                <View pointerEvents="none" style={[styles.cropFrame, { left: r.x, top: r.y, width: r.w, height: r.h }]} />
                <Corners x={r.x} y={r.y} w={r.w} h={r.h} area={area} />
              </>
            )}
          </>
        )}
      </View>

      <View style={[styles.cropBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <LiveButton theme={room} label={primary.label} onPress={primary.onPress} tall />
        {secondary && <InkButton theme={room} label={secondary.label} glyph="camera" onPress={secondary.onPress} />}
        {skipAll && (
          <View style={{ alignItems: 'center' }}>
            <WordButton theme={room} label="Read all as they are" onPress={skipAll} color={PAPER_SOFT} />
          </View>
        )}
      </View>
    </View>
  );
}

/** The found page: everything outside it dimmed, its edge, and a handle on each corner. */
function PageOutline({ points, area }: { points: { x: number; y: number }[]; area: { width: number; height: number } }) {
  const poly = `M${points.map((p) => `${p.x} ${p.y}`).join(' L')} Z`;
  return (
    <Svg width={area.width} height={area.height} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Path d={`M0 0 H${area.width} V${area.height} H0 Z ${poly}`} fill="rgba(10, 9, 8, 0.6)" fillRule="evenodd" />
      <Path d={poly} stroke={PAPER} strokeWidth={2} fill="none" strokeLinejoin="round" />
      {points.map((p, i) => (
        <Circle key={i} cx={p.x} cy={p.y} r={13} stroke={PAPER} strokeWidth={3} fill="rgba(21, 20, 18, 0.35)" />
      ))}
    </Svg>
  );
}

// ---------- reading ----------

/** The page under a highlighter sweep while Vision reads it. */
function ReadingStep({ src, done, total }: { src?: Source; done: number; total: number }) {
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const sweep = useRef(new Animated.Value(0)).current;
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(Animated.timing(sweep, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reduce, sweep]);

  const ratio = src ? src.height / src.width : 1.3;
  const maxW = box.width - 64;
  const maxH = box.height - 160;
  const w = Math.max(0, Math.min(maxW, maxH / ratio));
  const h = w * ratio;

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]} onLayout={(e) => setBox(e.nativeEvent.layout)}>
      <View style={styles.center}>
        {src && w > 0 && (
          <View style={{ width: w, height: h, overflow: 'hidden', borderRadius: radius.sheet }}>
            <Image source={{ uri: src.uri }} style={{ width: w, height: h }} resizeMode="cover" />
            <Animated.View
              style={[
                styles.band,
                { backgroundColor: lightTheme.highlightWash, opacity: reduce ? 0.6 : 1 },
                { transform: [{ translateY: reduce ? h / 2 - 20 : sweep.interpolate({ inputRange: [0, 1], outputRange: [-40, h] }) }] },
              ]}
            />
          </View>
        )}
        <Text style={[styles.reading, tabular]} accessibilityLiveRegion="polite">
          {total > 1 ? `Reading page ${Math.min(done + 1, total)} of ${total}` : 'Reading'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  dim: { position: 'absolute', backgroundColor: 'rgba(10, 9, 8, 0.5)' },
  hint: { position: 'absolute', left: 24, right: 24, textAlign: 'center', color: PAPER, fontSize: 17, fontWeight: fonts.weight.semibold },
  cameraBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingTop: 16 },
  focusRing: { position: 'absolute', width: 68, height: 68, borderRadius: 34, borderWidth: 2, borderColor: PAPER },
  blurSlip: { position: 'absolute', left: 16, right: 16 },
  shutterRing: { width: 84, height: 84, borderRadius: 42, borderWidth: 3, borderColor: PAPER, alignItems: 'center', justifyContent: 'center' },
  shutter: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center' },
  cropTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, minHeight: 52 },
  cropTitle: { color: PAPER, fontFamily: fonts.heading, fontSize: 19, lineHeight: 23, flexShrink: 1, textAlign: 'center', paddingHorizontal: 6 },
  cropHint: { color: PAPER_SOFT, fontSize: 15, textAlign: 'center', paddingHorizontal: 16, paddingBottom: 6 },
  cropTools: { flexDirection: 'row', gap: 4, minWidth: 60, justifyContent: 'flex-end' },
  shadeCrop: { position: 'absolute', backgroundColor: 'rgba(10, 9, 8, 0.6)' },
  cropFrame: { position: 'absolute', borderWidth: 1, borderColor: PAPER_SOFT },
  cropBar: { paddingHorizontal: 16, paddingTop: 10, gap: 10 },
  band: { position: 'absolute', left: 0, right: 0, height: 40 },
  reading: { color: PAPER, fontFamily: fonts.heading, fontSize: 21, marginTop: 24 },
  errorTitle: { color: PAPER, fontFamily: fonts.display, fontSize: 28, lineHeight: 34, textAlign: 'center' },
  errorLine: { color: PAPER_SOFT, fontSize: 17, lineHeight: 24, textAlign: 'center', marginTop: 12 },
  errorActions: { alignSelf: 'stretch', gap: 12, marginTop: 28 },
});
