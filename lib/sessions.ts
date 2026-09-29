import type { Institution } from './groups';
export type SessionItem = { subject: string; kind: 'Экзамен' | 'Зачёт' | 'Дифференцированный зачёт'; semester: number };
export type SessionInfo = { group: string; items: SessionItem[]; sourcePath: string; modified?: string; page: number; verified: boolean };
export type SessionSource = { path: string; name: string; modified?: string; institution: Institution };
type Fragment = { str: string; x: number; y: number; width: number };
const normalized = (value: string) => value.toLocaleUpperCase('ru').replace(/Ё/g, 'Е').replace(/[^А-Я0-9]/g, '');
const gradePattern = /\((?:Э|З|ДЗ|ДФК)\)/gi;

// Each PDF page contains a three-column table. Heading start positions give
// stable column boundaries even when a long heading wraps into another row.
export function parseSessionPage(text: Fragment[], group: string, institution: Institution, height: number) {
  const officialGroup = /^К-ТЭ-19-[12]$/i.test(group) ? 'К-ТЭ-19' : group;
  const header = [...text.filter((t) => t.y > 100 && t.y < height * .48)]
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = new Map<number, Fragment[]>();
  for (const item of text) {
    const y = Math.round(item.y);
    rows.set(y, [...(rows.get(y) ?? []), item]);
  }
  const markerY = [...rows].filter(([y]) => header.some((t) => Math.round(t.y) === y))
    .find(([, items]) => normalized(items.sort((a, b) => a.x - b.x).map((t) => t.str).join('')).includes(normalized(officialGroup)))?.[0];
  if (!markerY) return null;
  const below = text.filter((t) => t.y > markerY + 10 && t.y < height * .92).sort((a, b) => a.y - b.y || a.x - b.x);
  const titles = below.filter((t) => t.y < markerY + 90);
  const exam = titles.find((t) => /^ЭКЗАМЕНЫ$/i.test(t.str));
  const dif = titles.find((t) => /^ДИФФЕРЕНЦИРОВАННЫЕ/i.test(t.str));
  const credits = titles.filter((t) => /^ЗАЧ[ЕЁ]ТЫ$/i.test(t.str)).sort((a, b) => a.x - b.x);
  const columns = institution === 'college' ? [exam, dif, credits.at(-1)] : [exam, credits[0], dif];
  if (columns.some((t) => !t)) return { items: [] as SessionItem[], verified: false };
  const starts = columns.map((t) => t!.x);
  const bounds = [(starts[0] + starts[1]) / 2, (starts[1] + starts[2]) / 2];
  const semesterRows = [...rows].filter(([y, cells]) => y > markerY + 20 && y < height * .91 &&
    /\b\d(?:\s*\/\s*\d)?\s*семестр/i.test(cells.map((t) => t.str).join(' '))).sort((a, b) => a[0] - b[0]);
  const course = Number(group.match(/(?:-|\s)(\d)[19]/)?.[1] ?? '0');
  const items: SessionItem[] = [];
  let invalid = 0;
  const issues: string[] = [];
  for (let index = 0; index < semesterRows.length; index++) {
    const [start, cells] = semesterRows[index];
    const term = cells.map((t) => t.str).join(' ').match(/(\d)(?:\s*\/\s*(\d))?\s*семестр/i);
    if (!term) continue;
    const terms = [Number(term[1]), ...(term[2] ? [Number(term[2])] : [])];
    const semester = terms.find((n) => Math.ceil(n / 2) === course) ?? terms[0];
    const end = semesterRows[index + 1]?.[0] ?? height * .9;
    const byColumn: Fragment[][] = [[], [], []];
    let previous: Fragment | undefined;
    let previousColumn = 0;
    for (const t of below.filter((t) => t.y > start + 1 && t.y < end - 1)) {
      if (/^(?:ЭКЗАМЕНЫ|ЗАЧ[ЕЁ]ТЫ|ДИФФЕРЕНЦИРОВАННЫЕ)$/i.test(t.str)) continue;
      if (/^(?:Зам\.|Декан|Подпись|Утверждаю)/i.test(t.str)) continue;
      const inferred = t.x < bounds[0] ? 0 : t.x < bounds[1] ? 1 : 2;
      // PDF text extraction splits a word or its (ДЗ) marker across the
      // visual column boundary. Adjacent fragments on the same line belong
      // to the same cell, even if their x coordinate crosses that boundary.
      const adjoining = previous && Math.abs(previous.y - t.y) < 2 &&
        t.x >= previous.x && t.x - (previous.x + previous.width) >= -2 &&
        t.x - (previous.x + previous.width) < 7;
      const column = adjoining ? previousColumn : inferred;
      byColumn[column].push(t);
      previous = t;
      previousColumn = column;
    }
    byColumn.forEach((column, c) => {
      const kind: SessionItem['kind'] = c === 0 ? 'Экзамен' : institution === 'college'
        ? (c === 1 ? 'Дифференцированный зачёт' : 'Зачёт')
        : (c === 1 ? 'Зачёт' : 'Дифференцированный зачёт');
      let buffer = '';
      let previousPart: Fragment | undefined;
      let practiceContext = '';
      const flush = () => {
        const raw = buffer.replace(/\s+/g, ' ').trim(); buffer = ''; previousPart = undefined;
        if (!raw) return;
        const grades = [...raw.matchAll(gradePattern)].map((m) => m[0].toLocaleUpperCase('ru'));
        const subject = raw.replace(gradePattern, '').replace(/\s*[-–]\s*/g, '-')
          .replace(/\s+\./g, '.').replace(/(\d)(Экзамен)/g, '$1 $2')
          .replace(/\s+/g, ' ').replace(/^[-–\s]+/, '').trim();
        if (!subject && /^[-–\s]+$/.test(raw)) return;
        if (!subject || /^(?:\d+\s*семестр|ЭКЗАМЕНЫ|ЗАЧ[ЕЁ]ТЫ|ДИФФЕРЕНЦИРОВАННЫЕ)/i.test(subject) ||
          /^[^А-ЯЁA-Z0-9]/.test(subject) || /^[а-яё]/.test(subject)) { invalid++; issues.push(`Неясная строка: ${raw}`); return; }
        if (grades.length > 1 || grades.some((g) =>
          kind === 'Экзамен' ? g !== '(Э)' : kind === 'Зачёт' ? g !== '(З)' : g !== '(ДЗ)' && g !== '(ДФК)')) { invalid++; issues.push(`Метка не совпадает с колонкой ${kind}: ${raw}`); }
        items.push({ semester, kind, subject: practiceContext && /^(?:УП|ПП)\.?\s*\d/i.test(subject)
          ? `${practiceContext}: ${subject}` : subject });
      };
      for (const t of column) {
        if (/^(?:Учебная|Производственная) практика:$/i.test(t.str)) {
          flush(); practiceContext = t.str.slice(0, -1); continue;
        }
        // A practice or module entry sometimes has no bracketed grade.
        if (/^(?:УП|ПП|ПМ|МДК)\.?\s*\d/i.test(t.str) && buffer) flush();
        const adjoining = previousPart && Math.abs(previousPart.y - t.y) < 2 &&
          t.x - (previousPart.x + previousPart.width) >= -2 &&
          t.x - (previousPart.x + previousPart.width) < 2;
        const segments = t.str.split(/(?<=\((?:Э|З|ДЗ|ДФК)\))\s+(?=[А-ЯЁ])/i);
        for (const [segmentIndex, segment] of segments.entries()) {
          buffer += `${buffer && !(adjoining && segmentIndex === 0) ? ' ' : ''}${segment}`;
          if (/\((?:Э|З|ДЗ|ДФК)\)(?:\s*\+\s*курсовая работа)?\s*$/i.test(buffer)) flush();
        }
        previousPart = t;
      }
      flush();
    });
  }
  return { items, verified: items.length > 0 && invalid === 0, issues };
}

export async function parseSession(buffer: ArrayBuffer, group: string, source: SessionSource): Promise<SessionInfo | null> {
  const pdfjs = await import('pdfjs-dist');
  if (typeof window !== 'undefined') pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const results: SessionItem[] = [];
  let pageFound = 0;
  let verified = true;
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n); const height = page.view[3];
    const content = await page.getTextContent();
    const text = content.items.flatMap((x) => ('str' in x && x.str.trim()) ? [{ str: x.str.trim(), x: x.transform[4], y: height - x.transform[5], width: x.width }] : []);
    const parsed = parseSessionPage(text, group, source.institution, height);
    if (!parsed) continue;
    if (!pageFound) pageFound = n;
    results.push(...parsed.items);
    if (!parsed.verified) verified = false;
  }
  return pageFound ? { group, items: results, sourcePath: source.path, modified: source.modified, page: pageFound, verified: verified && results.length > 0 } : null;
}
