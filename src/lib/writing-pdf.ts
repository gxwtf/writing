'use client';

/**
 * 作文积累本 PDF 导出（矢量排版，A4 双栏）。
 * 依赖 public/fonts 下的中英文字体（部署资产，不入库）：
 *   simsun.ttf / times.ttf / timesbd.ttf
 */
import { jsPDF } from 'jspdf';

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const MARGIN_MM = 15;
const CONTENT_WIDTH_MM = A4_WIDTH_MM - MARGIN_MM * 2;

function formatFilenameDate(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

const WORDBOOK_FONT = {
  simsunFile: 'simsun.ttf',
  simsunName: 'SimSun',
  timesFile: 'times.ttf',
  timesBoldFile: 'timesbd.ttf',
  timesName: 'TimesNewRoman',
} as const;

const WORDBOOK_VECTOR = {
  columnGap: 8,
  headerBottomY: MARGIN_MM + 12,
  contentTopY: MARGIN_MM + 18,
  contentBottomY: A4_HEIGHT_MM - MARGIN_MM,
  wordSize: 11.2,
  indexSize: 9.2,
  bodySize: 9.5,
  tagSize: 8.2,
  wordLineHeight: 4.7,
  bodyLineHeight: 4.25,
  tagLineHeight: 3.7,
  entryPaddingTop: 1,
  entryPaddingBottom: 1.8,
};

type WordbookFontName = typeof WORDBOOK_FONT.simsunName | typeof WORDBOOK_FONT.timesName;
type WordbookFontStyle = 'normal' | 'bold';

interface WordbookTextRun {
  text: string;
  font: WordbookFontName;
  style: WordbookFontStyle;
  size: number;
}

interface WordbookLine {
  runs: WordbookTextRun[];
  indent: number;
  lineHeight: number;
}

interface WordbookEntryLayout {
  lines: WordbookLine[];
  height: number;
}

interface WordbookPlacedEntry {
  layout: WordbookEntryLayout;
}

type WordbookPageLayout = [WordbookPlacedEntry[], WordbookPlacedEntry[]];

export interface WritingEntryPdf {
  id: number;
  content: string;
  note?: string | null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

const fontBase64Cache: Record<string, string> = {};

function wordbookColumnWidth(): number {
  return (CONTENT_WIDTH_MM - WORDBOOK_VECTOR.columnGap) / 2;
}

function isCjkChar(char: string): boolean {
  return /[\u2E80-\u9FFF\uF900-\uFAFF\u3400-\u4DBF\u3000-\u303F\uFF00-\uFFEF]/.test(char);
}

function compactRuns(runs: WordbookTextRun[]): WordbookTextRun[] {
  const result: WordbookTextRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const prev = result[result.length - 1];
    if (prev && prev.font === run.font && prev.style === run.style && prev.size === run.size) {
      prev.text += run.text;
    } else {
      result.push({ ...run });
    }
  }
  return result;
}

function textRuns(
  text: string,
  size: number,
  englishStyle: WordbookFontStyle = 'normal'
): WordbookTextRun[] {
  const runs: WordbookTextRun[] = [];
  let current = '';
  let currentIsCjk: boolean | null = null;

  for (const char of Array.from(text)) {
    const nextIsCjk = isCjkChar(char);
    if (current && nextIsCjk !== currentIsCjk) {
      runs.push({
        text: current,
        font: currentIsCjk ? WORDBOOK_FONT.simsunName : WORDBOOK_FONT.timesName,
        style: currentIsCjk ? 'normal' : englishStyle,
        size,
      });
      current = '';
    }
    current += char;
    currentIsCjk = nextIsCjk;
  }

  if (current && currentIsCjk !== null) {
    runs.push({
      text: current,
      font: currentIsCjk ? WORDBOOK_FONT.simsunName : WORDBOOK_FONT.timesName,
      style: currentIsCjk ? 'normal' : englishStyle,
      size,
    });
  }

  return compactRuns(runs);
}

function setWordbookFont(pdf: jsPDF, run: WordbookTextRun): void {
  pdf.setFont(run.font, run.font === WORDBOOK_FONT.simsunName ? 'normal' : run.style);
  pdf.setFontSize(run.size);
}

function measureRun(pdf: jsPDF, run: WordbookTextRun): number {
  setWordbookFont(pdf, run);
  return pdf.getTextWidth(run.text);
}

function tokenizeRun(run: WordbookTextRun): WordbookTextRun[] {
  if (run.font === WORDBOOK_FONT.simsunName) {
    return Array.from(run.text).map((text) => ({ ...run, text }));
  }

  const parts = run.text.match(/\S+\s*|\s+/g) ?? [];
  return parts.map((text) => ({ ...run, text }));
}

function wrapWordbookRuns(
  pdf: jsPDF,
  runs: WordbookTextRun[],
  maxWidth: number,
  indent: number,
  lineHeight: number
): WordbookLine[] {
  const lines: WordbookLine[] = [];
  let current: WordbookTextRun[] = [];
  let currentWidth = 0;
  const availableWidth = Math.max(8, maxWidth - indent);

  const pushLine = () => {
    const cleanRuns = compactRuns(current)
      .map((run, index) => (index === 0 ? { ...run, text: run.text.replace(/^\s+/, '') } : run))
      .filter((run) => run.text.length > 0);
    if (cleanRuns.length > 0) {
      lines.push({ runs: cleanRuns, indent, lineHeight });
    }
    current = [];
    currentWidth = 0;
  };

  for (const run of runs) {
    for (const token of tokenizeRun(run)) {
      const tokenWidth = measureRun(pdf, token);
      if (current.length > 0 && currentWidth + tokenWidth > availableWidth) {
        pushLine();
      }

      if (tokenWidth > availableWidth) {
        for (const char of Array.from(token.text)) {
          const charRun = { ...token, text: char };
          const charWidth = measureRun(pdf, charRun);
          if (current.length > 0 && currentWidth + charWidth > availableWidth) {
            pushLine();
          }
          current.push(charRun);
          currentWidth += charWidth;
        }
      } else {
        current.push(token);
        currentWidth += tokenWidth;
      }
    }
  }

  pushLine();
  return lines;
}

function paginateEntries(entries: WordbookEntryLayout[]): WordbookPageLayout[] {
  const pages: WordbookPageLayout[] = [[[], []]];
  let page = pages[0];
  let columnIndex: 0 | 1 = 0;
  let y = WORDBOOK_VECTOR.contentTopY;

  for (const layout of entries) {
    if (page[columnIndex].length > 0 && y + layout.height > WORDBOOK_VECTOR.contentBottomY) {
      if (columnIndex === 0) {
        columnIndex = 1;
        y = WORDBOOK_VECTOR.contentTopY;
      } else {
        page = [[], []];
        pages.push(page);
        columnIndex = 0;
        y = WORDBOOK_VECTOR.contentTopY;
      }
    }

    page[columnIndex].push({ layout });
    y += layout.height;
  }

  return pages;
}

function drawLine(pdf: jsPDF, line: WordbookLine, x: number, baselineY: number): void {
  if (line.runs.length === 0) return;
  let runX = x + line.indent;
  for (const run of line.runs) {
    setWordbookFont(pdf, run);
    pdf.text(run.text, runX, baselineY);
    runX += measureRun(pdf, run);
  }
}

async function fetchFontBase64(url: string): Promise<string> {
  if (fontBase64Cache[url]) return fontBase64Cache[url];

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`字体加载失败：${url}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  const base64 = btoa(binary);
  fontBase64Cache[url] = base64;
  return base64;
}

async function registerFonts(pdf: jsPDF): Promise<void> {
  const [simsun, times, timesBold] = await Promise.all([
    fetchFontBase64(`/fonts/${WORDBOOK_FONT.simsunFile}`),
    fetchFontBase64(`/fonts/${WORDBOOK_FONT.timesFile}`),
    fetchFontBase64(`/fonts/${WORDBOOK_FONT.timesBoldFile}`),
  ]);

  pdf.addFileToVFS(WORDBOOK_FONT.simsunFile, simsun);
  pdf.addFont(WORDBOOK_FONT.simsunFile, WORDBOOK_FONT.simsunName, 'normal');
  pdf.addFileToVFS(WORDBOOK_FONT.timesFile, times);
  pdf.addFont(WORDBOOK_FONT.timesFile, WORDBOOK_FONT.timesName, 'normal');
  pdf.addFileToVFS(WORDBOOK_FONT.timesBoldFile, timesBold);
  pdf.addFont(WORDBOOK_FONT.timesBoldFile, WORDBOOK_FONT.timesName, 'bold');
}

function layoutWritingEntry(
  pdf: jsPDF,
  entry: WritingEntryPdf,
  index: number,
  columnWidth: number
): WordbookEntryLayout {
  const lines: WordbookLine[] = [];
  const bodyIndent = 8.7;
  const contentLineHeight = WORDBOOK_VECTOR.wordLineHeight;

  // 标题：序号 + 内容（支持换行分段）
  const contentParagraphs = entry.content.split('\n');
  for (let pi = 0; pi < contentParagraphs.length; pi++) {
    const para = contentParagraphs[pi];
    if (para.trim() === '') {
      lines.push({ runs: [], indent: 0, lineHeight: contentLineHeight });
      continue;
    }
    if (pi === 0) {
      const headRuns: WordbookTextRun[] = [
        { text: `${index}. `, font: WORDBOOK_FONT.timesName, style: 'normal', size: WORDBOOK_VECTOR.indexSize },
        ...textRuns(para, WORDBOOK_VECTOR.wordSize, 'bold'),
      ];
      lines.push(...wrapWordbookRuns(pdf, headRuns, columnWidth, 0, contentLineHeight));
    } else {
      const contRuns = textRuns(para, WORDBOOK_VECTOR.wordSize, 'bold');
      lines.push(...wrapWordbookRuns(pdf, contRuns, columnWidth, 0, contentLineHeight));
    }
  }

  // 备注
  if (entry.note && entry.note.trim()) {
    const noteParagraphs = entry.note.split('\n');
    for (const para of noteParagraphs) {
      if (para.trim() === '') {
        lines.push({ runs: [], indent: bodyIndent, lineHeight: WORDBOOK_VECTOR.bodyLineHeight });
      } else {
        const noteRuns = textRuns(para, WORDBOOK_VECTOR.bodySize);
        lines.push(...wrapWordbookRuns(pdf, noteRuns, columnWidth, bodyIndent, WORDBOOK_VECTOR.bodyLineHeight));
      }
    }
  }

  // 标签
  if (entry.tags.length > 0) {
    const tags = entry.tags.join('、');
    const tagRuns = textRuns(`标签：${tags}`, WORDBOOK_VECTOR.tagSize);
    lines.push(...wrapWordbookRuns(pdf, tagRuns, columnWidth, bodyIndent, WORDBOOK_VECTOR.tagLineHeight));
  }

  const textHeight = lines.reduce((sum, line) => sum + line.lineHeight, 0);
  return {
    lines,
    height: WORDBOOK_VECTOR.entryPaddingTop + textHeight + WORDBOOK_VECTOR.entryPaddingBottom,
  };
}

function drawWritingEntriesPage(
  pdf: jsPDF,
  page: WordbookPageLayout,
  pageIndex: number,
  totalPages: number,
  totalEntries: number
): void {
  pdf.setDrawColor(0);
  pdf.setLineWidth(0.35);
  pdf.line(MARGIN_MM, WORDBOOK_VECTOR.headerBottomY, A4_WIDTH_MM - MARGIN_MM, WORDBOOK_VECTOR.headerBottomY);

  pdf.setTextColor(0);
  pdf.setFont(WORDBOOK_FONT.simsunName, 'normal');
  pdf.setFontSize(18);
  pdf.text('作文积累本', MARGIN_MM, MARGIN_MM + 7.2);

  const metaRuns = [
    ...textRuns(`共 ${totalEntries} 条 · 第 `, 10),
    { text: `${pageIndex + 1} / ${totalPages}`, font: WORDBOOK_FONT.timesName, style: 'bold' as const, size: 10 },
    ...textRuns(' 页', 10),
  ];
  const metaWidth = metaRuns.reduce((sum, run) => sum + measureRun(pdf, run), 0);
  let x = A4_WIDTH_MM - MARGIN_MM - metaWidth;
  const y = MARGIN_MM + 6.8;
  for (const run of metaRuns) {
    setWordbookFont(pdf, run);
    pdf.text(run.text, x, y);
    x += measureRun(pdf, run);
  }

  for (let columnIndex = 0; columnIndex < page.length; columnIndex++) {
    const entries = page[columnIndex];
    const x = MARGIN_MM + columnIndex * (wordbookColumnWidth() + WORDBOOK_VECTOR.columnGap);
    let y = WORDBOOK_VECTOR.contentTopY;

    for (const entry of entries) {
      y += WORDBOOK_VECTOR.entryPaddingTop;
      for (const line of entry.layout.lines) {
        const baselineY = y + line.lineHeight * 0.73;
        drawLine(pdf, line, x, baselineY);
        y += line.lineHeight;
      }
      y += WORDBOOK_VECTOR.entryPaddingBottom - 0.8;
      pdf.setDrawColor(225);
      pdf.setLineWidth(0.15);
      pdf.line(x, y, x + wordbookColumnWidth(), y);
      y += 0.8;
    }
  }
}

export async function generateWritingEntriesPdf(entries: WritingEntryPdf[]): Promise<void> {
  if (entries.length === 0) return;

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    putOnlyUsedFonts: true,
    compress: true,
  });

  await registerFonts(pdf);
  pdf.setProperties({
    title: '作文积累本',
    subject: '作文积累本',
    creator: '作文积累本',
  });

  const columnWidth = wordbookColumnWidth();
  const layouts = entries.map((entry, index) => layoutWritingEntry(pdf, entry, index + 1, columnWidth));
  const pages = paginateEntries(layouts);

  for (let i = 0; i < pages.length; i++) {
    if (i > 0) {
      pdf.addPage();
    }
    drawWritingEntriesPage(pdf, pages[i], i, pages.length, entries.length);
  }

  pdf.save(`作文积累本_${formatFilenameDate()}.pdf`);
}
