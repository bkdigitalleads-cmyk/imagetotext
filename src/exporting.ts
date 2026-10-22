/**
 * Getting text out: copy, share as text, and the three export files
 * (.txt, .md, and .pdf through expo-print). Files are written on the phone
 * and go only where the person sends them.
 */
import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { nameForShare, writeShareFile } from './files';
import { dayKey } from './quota';
import { fileBaseName, htmlEscape, toMarkdown, toTxt } from './text';

export type ExportKind = 'txt' | 'pdf' | 'md';

export async function copyText(text: string): Promise<boolean> {
  try {
    return await Clipboard.setStringAsync(text);
  } catch {
    return false;
  }
}

/** The share sheet with the text itself (Messages, Mail, Notes and so on). */
export async function shareText(text: string): Promise<void> {
  await Share.share({ message: text });
}

// Paper and ink, the same in light and dark: it is a printed page.
const CSS = `
  @page { margin: 56px 60px; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1d1b17; font-size: 13.5px; line-height: 1.6; margin: 0; }
  .meta { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #8a8375; font-size: 10px; letter-spacing: 0.3px; margin-bottom: 22px; }
  p { margin: 0 0 11px; white-space: pre-wrap; }
  hr { border: none; border-top: 1px solid #dcd4c3; margin: 24px 0; }
`;

/** The PDF's HTML: paragraphs as paragraphs, a rule between pages. */
export function pdfHtml(pages: string[], day: string): string {
  const body = pages
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) =>
      p
        .split(/\n{2,}/)
        .map((para) => `<p>${htmlEscape(para)}</p>`)
        .join('')
    )
    .join('<hr />');
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>${CSS}</style></head><body>
  <div class="meta">${htmlEscape(day)} · ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}</div>${body}</body></html>`;
}

/** Writes the file and opens the share sheet for it. */
export async function exportFile(kind: ExportKind, pages: string[]): Promise<void> {
  const day = dayKey(Date.now());
  const name = fileBaseName(pages.join('\n\n'), day);
  let uri: string;
  let mimeType: string;
  let UTI: string;
  if (kind === 'pdf') {
    const printed = await Print.printToFileAsync({ html: pdfHtml(pages, day) });
    uri = nameForShare(printed.uri, `${name}.pdf`);
    mimeType = 'application/pdf';
    UTI = 'com.adobe.pdf';
  } else if (kind === 'md') {
    uri = writeShareFile(`${name}.md`, toMarkdown(pages));
    mimeType = 'text/markdown';
    UTI = 'net.daringfireball.markdown';
  } else {
    uri = writeShareFile(`${name}.txt`, toTxt(pages));
    mimeType = 'text/plain';
    UTI = 'public.plain-text';
  }
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType, UTI, dialogTitle: name });
}
