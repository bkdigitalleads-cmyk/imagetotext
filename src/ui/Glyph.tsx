/**
 * The app's own glyphs, drawn by hand on a 28x28 grid: lines that bow a
 * little instead of running ruler-straight, round ends, one stroke weight,
 * so they sit with the slab headers and the paper. Not an icon pack.
 * The five that carry the app: camera, picture, folder, copy, share.
 */
import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

export type GlyphName =
  | 'camera'
  | 'picture'
  | 'folder'
  | 'copy'
  | 'share'
  | 'export'
  | 'addPage'
  | 'pages'
  | 'plus'
  | 'close'
  | 'check'
  | 'back'
  | 'chevron'
  | 'settings'
  | 'trash'
  | 'rotate'
  | 'torch'
  | 'grip'
  | 'pencil'
  | 'crop';

export default function Glyph({
  name,
  size = 26,
  color,
  weight = 1.8,
}: {
  name: GlyphName;
  size?: number;
  color: string;
  weight?: number;
}) {
  const s = { stroke: color, strokeWidth: weight, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 28 28" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {draw(name, s, color)}
    </Svg>
  );
}

function draw(name: GlyphName, s: object, color: string) {
  switch (name) {
    case 'camera':
      return (
        <>
          <Path {...s} d="M5.6 9.4 Q4.3 9.5 4.2 11 L4.4 20.6 Q4.5 22.4 6.2 22.3 L21.9 22.5 Q23.7 22.4 23.8 20.7 L23.6 11.1 Q23.5 9.3 21.8 9.4 L18.6 9.5 L17 6.6 Q16.7 6.1 16 6.1 L12 6.2 Q11.3 6.2 11 6.8 L9.6 9.4 Z" />
          <Path {...s} d="M14 11.6 C16.4 11.5 18.2 13.4 18.1 15.7 C18 18 16.2 19.7 13.9 19.6 C11.6 19.5 9.9 17.8 10 15.5 C10.1 13.3 11.8 11.7 14 11.6 Z" />
          <Circle cx={20.9} cy={12.1} r={0.9} fill={color} />
        </>
      );
    case 'picture':
      return (
        <>
          <Path {...s} d="M6 5.3 Q4.4 5.4 4.5 7 L4.3 21 Q4.4 22.7 6.1 22.6 L22 22.8 Q23.6 22.7 23.6 21.1 L23.8 7.1 Q23.7 5.4 22 5.5 Z" />
          <Path {...s} d="M5 19.6 L10.6 13.6 Q11.1 13.1 11.6 13.6 L15.4 17.7 L18 15.2 Q18.5 14.8 19 15.2 L23.2 19.3" />
          <Path {...s} d="M18.4 8.4 C19.6 8.4 20.4 9.2 20.4 10.3 C20.3 11.4 19.5 12.1 18.4 12.1 C17.3 12.1 16.6 11.3 16.6 10.2 C16.7 9.2 17.4 8.4 18.4 8.4 Z" />
        </>
      );
    case 'folder':
      return (
        <>
          <Path {...s} d="M4.3 9.2 Q4.2 7.2 6.2 7.1 L10.8 7 Q11.5 7 11.9 7.6 L13.3 9.4 L21.7 9.5 Q23.8 9.6 23.8 11.6 L23.6 20.6 Q23.6 22.6 21.6 22.6 L6.3 22.7 Q4.4 22.6 4.4 20.7 Z" />
          <Path {...s} d="M4.4 12.6 Q14 12.2 23.7 12.7" />
        </>
      );
    case 'copy':
      return (
        <>
          <Path {...s} d="M9.4 5.6 L20.6 5.4 Q22.6 5.5 22.6 7.5 L22.8 17.6" />
          <Path {...s} d="M6.6 9.2 L14.8 9 L18.8 13 L18.7 21.8 Q18.6 23 17.4 23 L6.7 23.1 Q5.4 23 5.4 21.7 L5.5 10.4 Q5.5 9.2 6.6 9.2 Z" />
          <Path {...s} d="M14.8 9.1 L14.9 13 L18.7 13" />
        </>
      );
    case 'share':
      return (
        <>
          <Path {...s} d="M10 12.1 L7.6 12.2 Q6.1 12.2 6.1 13.7 L6.2 21.6 Q6.2 23.1 7.7 23.1 L20.4 23 Q21.9 23 21.9 21.5 L21.8 13.6 Q21.8 12.1 20.3 12.1 L18 12.2" />
          <Path {...s} d="M14 16.6 Q13.8 10.5 14.1 4.6" />
          <Path {...s} d="M10.2 8.3 L14.1 4.4 L17.9 8.4" />
        </>
      );
    case 'export':
      return (
        <>
          <Path {...s} d="M15.6 4.6 L8.5 4.7 Q7 4.7 7 6.2 L7.1 21.9 Q7.1 23.4 8.6 23.4 L19.5 23.3 Q21 23.3 21 21.8 L20.9 10" />
          <Path {...s} d="M15.6 4.6 L15.7 10 L20.9 10 Z" />
          <Path {...s} d="M14 13.2 Q14.1 16.5 13.9 19.6 M11.3 17 L13.9 19.7 L16.6 17" />
        </>
      );
    case 'addPage':
      return (
        <>
          <Path {...s} d="M15.6 4.6 L8.5 4.7 Q7 4.7 7 6.2 L7.1 21.9 Q7.1 23.4 8.6 23.4 L19.5 23.3 Q21 23.3 21 21.8 L20.9 10 L15.6 4.6" />
          <Path {...s} d="M14 12.8 Q14.1 16 13.9 19.4 M10.7 16.1 Q14 16 17.3 16.2" />
        </>
      );
    case 'pages':
      return (
        <>
          <Path {...s} d="M8.4 8 L8.5 5.9 Q8.6 4.6 9.9 4.6 L21.6 4.7 Q22.9 4.8 22.9 6.1 L22.8 18.4 Q22.7 19.7 21.4 19.7 L19.8 19.7" />
          <Path {...s} d="M6.4 8.3 L18.1 8.2 Q19.6 8.3 19.6 9.8 L19.5 22 Q19.4 23.4 18 23.4 L6.5 23.5 Q5.1 23.4 5.1 22 L5.2 9.7 Q5.1 8.3 6.4 8.3 Z" />
        </>
      );
    case 'plus':
      return <Path {...s} d="M14 6.2 Q13.8 14 14.1 21.8 M6.2 14.1 Q14 13.8 21.8 14" />;
    case 'close':
      return <Path {...s} d="M7.6 7.4 Q14 13.9 20.5 20.6 M20.4 7.5 Q14.1 14 7.5 20.5" />;
    case 'check':
      return <Path {...s} d="M5.8 14.6 L11.4 20 Q11.8 20.4 12.2 20 L22.4 8.2" />;
    case 'back':
      return <Path {...s} d="M17.2 5.8 L9.4 13.6 Q9 14 9.4 14.4 L17.3 22.2" />;
    case 'chevron':
      return <Path {...s} d="M10.8 6.6 L17.6 13.6 Q18 14 17.6 14.4 L10.7 21.4" />;
    case 'settings':
      return (
        <>
          <Path {...s} d="M4.6 8.2 Q14 7.9 23.4 8.3 M4.6 14 Q14 14.2 23.4 13.9 M4.6 19.8 Q14 19.6 23.4 20" />
          <Circle cx={17.6} cy={8.2} r={2.3} fill={color} />
          <Circle cx={10.2} cy={14} r={2.3} fill={color} />
          <Circle cx={19.2} cy={19.8} r={2.3} fill={color} />
        </>
      );
    case 'trash':
      return (
        <>
          <Path {...s} d="M5.4 8 Q14 7.7 22.6 8.1 M11.2 7.8 L11.6 5.4 Q11.8 4.7 12.5 4.7 L15.6 4.7 Q16.3 4.8 16.4 5.4 L16.8 7.9" />
          <Path {...s} d="M7.4 8.2 L8.4 21.9 Q8.6 23.3 10 23.3 L18 23.3 Q19.4 23.2 19.6 21.8 L20.6 8.2" />
          <Path {...s} d="M12.1 12 L12.4 19.4 M16 12 L15.7 19.4" />
        </>
      );
    case 'rotate':
      return (
        <>
          <Path {...s} d="M7.2 11.4 C8.6 7.6 12.6 5.4 16.6 6.5 C20.8 7.6 23.2 11.9 22.1 16.1 C21 20.3 16.7 22.8 12.5 21.7 C10.4 21.1 8.7 19.8 7.7 18" />
          <Path {...s} d="M6.4 6.8 L7.1 11.6 L11.8 10.7" />
        </>
      );
    case 'torch':
      return <Path {...s} d="M15.6 4.4 L8.2 15.4 Q7.9 15.9 8.5 15.9 L13.6 15.8 L12.2 23.6 L19.8 12.3 Q20.1 11.8 19.5 11.8 L14.4 11.9 Z" />;
    case 'grip':
      return (
        <>
          {[9, 14, 19].map((y) => (
            <React.Fragment key={y}>
              <Circle cx={11} cy={y} r={1.4} fill={color} />
              <Circle cx={17} cy={y} r={1.4} fill={color} />
            </React.Fragment>
          ))}
        </>
      );
    case 'pencil':
      return (
        <>
          <Path {...s} d="M18.4 5.4 L22.6 9.6 L10.4 21.7 L5.2 22.8 L6.3 17.6 Z" />
          <Path {...s} d="M15.8 8 L20 12.2" />
        </>
      );
    case 'crop':
      return <Path {...s} d="M8.4 4.4 L8.5 18.6 Q8.5 19.6 9.5 19.6 L23.6 19.5 M4.4 8.5 L18.5 8.4 Q19.5 8.4 19.5 9.4 L19.6 23.6" />;
  }
}
