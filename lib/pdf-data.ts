import type { PDFPageProxy } from "pdfjs-dist";
type LegacyGroup = "49-1" | "49-2" | "31";

type Text = { str: string; x: number; y: number; width: number; rot: boolean };
export type Debt = { id: string; semester: number; subject: string; teacher: string };
export type Student = { name: string; debts: Debt[] };
export type Pair = {
  time: string; subject: string; teacher: string; room: string;
  remote: boolean; subgroup?: "А" | "Б";
};
export type Day = { label: string; pairs: Pair[]; off: boolean };

let pdfModule: typeof import("pdfjs-dist") | undefined;
async function pdf() {
  if (!pdfModule) {
    pdfModule = await import("pdfjs-dist");
    if (typeof window !== "undefined") pdfModule.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  }
  return pdfModule;
}

async function open(buffer: ArrayBuffer) {
  const engine = await pdf();
  const document = await engine.getDocument({ data: new Uint8Array(buffer) }).promise;
  return document.getPage(1);
}

async function text(page: PDFPageProxy): Promise<Text[]> {
  const height = page.view[3];
  const content = await page.getTextContent();
  return content.items.flatMap((item) => {
    if (!("str" in item) || !item.str.trim()) return [];
    return [{ str: item.str.trim(), x: item.transform[4], y: height - item.transform[5],
      width: item.width, rot: item.transform[1] > 1 }];
  });
}

async function pixels(page: PDFPageProxy) {
  const scale = 2;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Браузер не смог прочитать PDF");
  await page.render({ canvasContext: ctx, viewport }).promise;
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return (x: number, y: number): [number, number, number] => {
    const px = Math.max(0, Math.min(width - 1, Math.round(x * scale)));
    const py = Math.max(0, Math.min(height - 1, Math.round(y * scale)));
    const i = (py * width + px) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
}

function yellow([r, g, b]: number[]) { return r > 210 && g > 205 && b < 140 && r > b * 1.65; }
function gray([r, g, b]: number[]) { return r < 190 && Math.abs(r - g) < 16 && Math.abs(g - b) < 16; }
function green([r, g, b]: number[]) { return g > 115 && g > r * 1.18 && g > b * 1.12; }

const DEBT_LAYOUT: Record<LegacyGroup, { numberX: number; firstRow: number; subjectLeft: number; subjectRight: number; studentLeft: number; studentRight: number; teacherLeft: number; teacherRight: number; semesters: number; minRows: number }> = {
  '49-1': { numberX: 25, firstRow: 100, subjectLeft: 37, subjectRight: 99, studentLeft: 130, studentRight: 510, teacherLeft: 485, teacherRight: 560, semesters: 6, minRows: 35 },
  '49-2': { numberX: 29.52, firstRow: 130, subjectLeft: 44, subjectRight: 116, studentLeft: 170, studentRight: 475, teacherLeft: 470, teacherRight: 540, semesters: 6, minRows: 35 },
  '31': { numberX: 70.46, firstRow: 175, subjectLeft: 93, subjectRight: 195, studentLeft: 245, studentRight: 715, teacherLeft: 725, teacherRight: 790, semesters: 4, minRows: 30 },
};

async function parseLegacyDebts(buffer: ArrayBuffer, group: LegacyGroup, sample?: (x: number, y: number) => number[]): Promise<Student[]> {
  const page = await open(buffer);
  const items = await text(page);
  const layout = DEBT_LAYOUT[group];
  if (!items.some((t) => t.str.includes(`Группа К-ИСП-${group}`)))
    throw new Error(`Ведомость не соответствует группе К-ИСП-${group}`);
  const color = sample ?? await pixels(page);
  const students = items.filter((t) => t.rot && t.y < layout.firstRow && t.x > layout.studentLeft && t.x < layout.studentRight &&
    /^[А-ЯЁ][А-ЯЁа-яё-]+(?:\s+[А-ЯЁ][А-ЯЁа-яё-]+){1,4}$/.test(t.str)).sort((a, b) => a.x - b.x);
  // One name in the К-ИСП-31 PDF has its patronymic in a separate text item.
  if (group === '31') {
    const fragment = items.find((t) => t.rot && t.str === 'Александровна' && t.x > 260 && t.x < 285);
    const first = students.find((t) => t.str === 'Бострикова Александра');
    if (fragment && first) first.str += ` ${fragment.str}`;
  }
  if (students.length < 15) throw new Error("Не удалось проверить столбцы студентов в ведомости");

  const numbered = items.filter((t) => !t.rot && Math.abs(t.x - layout.numberX) < 1.8 && t.y > layout.firstRow && t.y < 565 && /^\d{1,2}$/.test(t.str))
    .sort((a, b) => a.y - b.y);
  if (numbered.length < layout.minRows) throw new Error("Изменилась структура строк ведомости");
  let semester = 0;
  const rows = numbered.map((n, index) => {
    if (n.str === "1") semester++;
    const midpoint = index ? (numbered[index - 1].y + n.y) / 2 : n.y - 5;
    // In К-ИСП-31 one course title starts 6.6 points above its row number;
    // another unnumbered course occupies the gap before row 7 of semester 2.
    const top = group === '31' ? Math.max(midpoint, n.y - (semester === 2 && n.str === '7' ? 4 : 7)) : midpoint;
    const bottom = index < numbered.length - 1 ? (n.y + numbered[index + 1].y) / 2 : n.y + 5;
    const nearby = items.filter((t) => !t.rot && t.y >= top && t.y < bottom);
    const subject = nearby.filter((t) => t.x >= layout.subjectLeft && t.x < layout.subjectRight).sort((a, b) => a.y - b.y || a.x - b.x)
      .map((t) => t.str).join(" ").replace(/\s+/g, " ").trim();
    const teacher = nearby.filter((t) => t.x > layout.teacherLeft && t.x < layout.teacherRight).sort((a, b) => Math.abs(a.y - n.y) - Math.abs(b.y - n.y))[0]?.str ?? "Не указан";
    return { semester, number: n.str, y: n.y, subject, teacher };
  });
  if (semester !== layout.semesters) throw new Error("Количество семестров в ведомости изменилось");
  return students.map(({ str: name, x }) => ({
    name,
    debts: rows.filter((row) => row.subject && (
      yellow(color(x - 5, row.y - 1)) || yellow(color(x - 5, row.y + 1))
    )).map((row) => ({
      id: `${row.semester}:${row.number}:${row.subject.toLowerCase().replace(/\s+/g, " ")}`,
      semester: row.semester, subject: row.subject, teacher: row.teacher,
    })),
  })).sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

// The summary PDFs are tables painted into pages, not spreadsheets. Locate the
// student header columns and numbered subject rows before sampling cell fills.
export async function parseDebts(buffer: ArrayBuffer, group: string, sample?: (x: number, y: number, page: number) => number[]): Promise<Student[]> {
  if (group === 'К-ИСП-49-1' || group === 'К-ИСП-49-2')
    return parseLegacyDebts(buffer, group.slice(-4) as LegacyGroup, sample ? (x, y) => sample(x, y, 1) : undefined);
  const engine = await pdf();
  const doc = await engine.getDocument({ data: new Uint8Array(buffer) }).promise;
  const first = await doc.getPage(1);
  const firstText = await text(first);
  const declaredGroup = firstText.find((t) => /Группа\s+(?:К-|Юр-|БД-|ЗУ-)/i.test(t.str));
  if (declaredGroup && !declaredGroup.str.toLocaleUpperCase('ru').includes(group.toLocaleUpperCase('ru')))
    throw new Error('Заголовок ведомости не совпадает с выбранной группой');
  const students = firstText.filter((t) => t.rot && /^[А-ЯЁ][А-ЯЁа-яё-]+(?:\s+[А-ЯЁ][А-ЯЁа-яё-]+){1,4}$/.test(t.str))
    .sort((a, b) => a.x - b.x);
  for (const student of students) if (student.str.split(/\s+/).length === 2) {
    const fragment = firstText.find((t) => t.rot && /^[А-ЯЁ][а-яё-]+$/.test(t.str) &&
      t.x - student.x > 2 && t.x - student.x < 8 && Math.abs(t.y - student.y) < 7);
    if (fragment) student.str += ` ${fragment.str}`;
  }
  if (students.length < 8 || students.length > 48) throw new Error('Не удалось достоверно определить колонки студентов');
  if (students.some((s, i) => i && s.x - students[i - 1].x < 3)) throw new Error('Столбцы студентов пересекаются');
  const headerBottom = Math.max(...students.map((s) => s.y));
  const subjectCandidates = firstText.filter((t) => !t.rot && t.y > headerBottom + 4 &&
    t.x >= 30 && t.x < students[0].x - 35 && /[А-ЯЁа-яё]/.test(t.str) && !/^(?:семестр|зачет|зачёт|экзамен)$/i.test(t.str));
  const xCounts = new Map<number, number>();
  for (const t of subjectCandidates) {
    const x = Math.round(t.x / 3) * 3;
    xCounts.set(x, (xCounts.get(x) ?? 0) + 1);
  }
  const subjectLeft = [...xCounts].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (subjectLeft === undefined || (xCounts.get(subjectLeft) ?? 0) < 7) throw new Error('Не удалось определить строки предметов');
  const initialNumbers = firstText.filter((t) => !t.rot && /^\d{1,2}$/.test(t.str) &&
    t.y > headerBottom + 2 && t.x < subjectLeft - 4 && t.x > subjectLeft - 50);
  const numberCounts = new Map<number, number>();
  for (const t of initialNumbers) {
    const x = Math.round(t.x / 3) * 3;
    numberCounts.set(x, (numberCounts.get(x) ?? 0) + 1);
  }
  const numberX = [...numberCounts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const debts = students.map((s) => ({ name: s.str, debts: [] as Debt[] }));
  const distance = students.length > 1 ? students[1].x - students[0].x : 12;
  if (numberX === undefined || (numberCounts.get(numberX) ?? 0) < 7) {
    if (group.toLocaleUpperCase('ru') !== 'ЮР-21' || doc.numPages !== 1)
      throw new Error('Не удалось проверить нумерацию строк');
    const color = sample ? (x: number, y: number) => sample(x, y, 1) : await pixels(first);
    const lines = firstText.filter((t) => !t.rot && Math.abs(t.x - subjectLeft) < 3 &&
      t.y > headerBottom + 4 && /[А-ЯЁа-яё]/.test(t.str)).sort((a, b) => a.y - b.y);
    const anchors = lines.filter((t) => /^[А-ЯЁ]/.test(t.str));
    if (anchors.length < 20) throw new Error('Не удалось проверить строки предметов');
    for (let j = 0; j < anchors.length; j++) {
      const n = anchors[j], next = anchors[j + 1]?.y ?? n.y + 12;
      const continuation = lines.filter((t) => t.y > n.y && t.y < next && /^[а-яё]/.test(t.str));
      const subject = [n, ...continuation].map((t) => t.str).join(' ');
      const fills = [-3, -1, 1, 3].map((offset) => color(subjectLeft + 60, n.y + offset));
      const semester = fills.some((fill) => fill[1] > fill[0] + 7 && fill[0] > 170) ? 1 :
        fills.some((fill) => fill[0] > fill[1] + 10 && fill[2] > 160) ? 2 : 0;
      const teacher = firstText.filter((t) => !t.rot && t.x > students[students.length - 1].x + distance &&
        t.y > n.y - 5 && t.y < next - 1 && /[А-ЯЁа-яё]/.test(t.str))
        .sort((a, b) => Math.abs(a.y - n.y) - Math.abs(b.y - n.y))[0]?.str ?? 'В ведомости не указан';
      for (let i = 0; i < students.length; i++) {
        const cellX = students[i].x - Math.min(5, distance / 4);
        if (![-2, 0, 2].some((dy) => yellow(color(cellX, n.y + dy)))) continue;
        if (!semester) throw new Error('Не удалось определить семестр жёлтой строки');
        debts[i].debts.push({ id: `${semester}:${j + 1}:${subject.toLocaleLowerCase('ru')}`, semester, subject, teacher });
      }
    }
    return debts.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }
  let semester = 0, rowCount = 0;
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = pageNumber === 1 ? first : await doc.getPage(pageNumber);
    const items = pageNumber === 1 ? firstText : await text(page);
    const color = sample ? (x: number, y: number) => sample(x, y, pageNumber) : await pixels(page);
    const numbers = items.filter((t) => !t.rot && /^\d{1,2}$/.test(t.str) &&
      Math.abs(t.x - numberX) < 3.5 && t.y > (pageNumber === 1 ? headerBottom + 3 : 5))
      .sort((a, b) => a.y - b.y);
    // A continuation page sometimes has only one row; the first page carries
    // the student names, and the same x coordinates continue on later pages.
    if (pageNumber === 1 && numbers.length < 7) throw new Error('Ведомость не содержит проверяемых строк');
    for (let index = 0; index < numbers.length; index++) {
      const n = numbers[index];
      if (n.str === '1') semester++;
      const previous = numbers[index - 1]?.y ?? (pageNumber === 1 ? headerBottom + 2 : Math.max(0, n.y - 14));
      const next = numbers[index + 1]?.y ?? Math.min(page.view[3] - 1, n.y + Math.max(7, n.y - previous));
      const top = (previous + n.y) / 2;
      const bottom = (n.y + next) / 2;
      const nearby = items.filter((t) => !t.rot && t.y >= top - 1 && t.y < bottom);
      let subject = nearby.filter((t) => t.x >= subjectLeft - 4 && t.x < students[0].x - Math.min(18, distance) &&
        /[А-ЯЁа-яё]/.test(t.str) && !/^(?:ДЗ|ДФК|З|Э|Экзамен|Зачет|Зачёт)$/i.test(t.str) &&
        !/^\d{1,2}\.\d{2}\.\d{4}$/.test(t.str))
        .sort((a, b) => a.y - b.y || a.x - b.x).map((t) => t.str).join(' ').replace(/\s+/g, ' ').trim();
      let rowTop = top - 1;
      if (/^[а-яё]/.test(subject) && index > 0) {
        const leading = items.filter((t) => !t.rot && t.y > previous + 1 && t.y < top &&
          Math.abs(t.x - subjectLeft) < 5 && /^[А-ЯЁ]/.test(t.str)).sort((a, b) => b.y - a.y)[0];
        if (leading) { subject = `${leading.str} ${subject}`; rowTop = leading.y - 2; }
      }
      if (subject === 'ПМ') {
        const tail = items.find((t) => !t.rot && /^\.\d+/.test(t.str) && t.x > subjectLeft &&
          t.x < subjectLeft + 35 && Math.abs(t.y - n.y) < 3);
        if (tail) subject += tail.str;
      }
      const teacher = items.filter((t) => !t.rot && t.y >= rowTop && t.y < bottom &&
        t.x > students[students.length - 1].x + distance / 2 &&
        t.x < page.view[2] - 4 && /[А-ЯЁа-яё]/.test(t.str))
        .sort((a, b) => Math.abs(a.y - n.y) - Math.abs(b.y - n.y))[0]?.str ?? 'В ведомости не указан';
      const flagged = students.map((s) => yellow(color(s.x - Math.min(5, distance / 4), n.y - 1)) ||
        yellow(color(s.x - Math.min(5, distance / 4), n.y + 1)));
      if (flagged.some(Boolean) && (!subject || semester === 0)) throw new Error(`Жёлтая ячейка без проверяемого предмета или семестра (лист ${pageNumber}, строка ${n.str}, y=${n.y.toFixed(1)}, предмет=${subject || 'пусто'}, семестр=${semester})`);
      rowCount++;
      for (let i = 0; i < students.length; i++) if (flagged[i]) debts[i].debts.push({
        id: `${semester}:${n.str}:${subject.toLocaleLowerCase('ru').replace(/\s+/g, ' ')}`,
        semester, subject, teacher,
      });
    }
  }
  if (semester < 1 || rowCount < 8) throw new Error('Таблица ведомости изменила структуру');
  return debts.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

const TIMES = ["08:15–09:45", "09:55–11:25", "11:50–13:20", "13:30–15:00", "15:20–16:50", "17:00–18:30"];
const WEEKDAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
function pairTime(anchor: Text, items: Text[], fallback: string) {
  const line = anchor.str.match(/^(\d{1,2})\.(\d{2})\s*[-–]\s*(\d{1,2})\.(\d{2})/);
  const continuation = !line && anchor.str.match(/^(\d{1,2})\.(\d{2})\s*[-–]\s*$/)
    ? items.find((t) => !t.rot && Math.abs(t.x - anchor.x) < 12 && t.y > anchor.y &&
      t.y < anchor.y + 12 && /^\d{1,2}\.\d{2}$/.test(t.str))?.str.match(/^(\d{1,2})\.(\d{2})$/)
    : null;
  const first = anchor.str.match(/^(\d{1,2})\.(\d{2})/);
  const parts = line ? line.slice(1, 5) : continuation && first ? [...first.slice(1), ...continuation.slice(1)] : null;
  if (parts) return `${parts[0].padStart(2, '0')}:${parts[1]}–${parts[2].padStart(2, '0')}:${parts[3]}`;
  // Some timetable rows give only a start time (for example 9.00).
  return first ? `${first[1].padStart(2, '0')}:${first[2]}` : fallback;
}

function boundary(color: (x: number, y: number) => number[], x: number, top: number, bottom: number) {
  let count = 0, total = 0;
  for (let y = top + 3; y < bottom - 3; y += 1) {
    total++;
    const contrast = [-1, -0.5, 0, 0.5, 1].some((dx) => {
      const current = color(x + dx, y)[0];
      return Math.min(color(x + dx - 2, y)[0], color(x + dx + 2, y)[0]) - current > 18;
    });
    if (contrast) count++;
  }
  return total > 2 && count / total > .6;
}
function nearbyBoundary(color: (x: number, y: number) => number[], desired: number, top: number, bottom: number, radius = 6) {
  for (let offset = 0; offset <= radius; offset += 0.5) {
    for (const x of offset ? [desired - offset, desired + offset] : [desired])
      if (boundary(color, x, top, bottom)) return x;
  }
  return null;
}

export function rowBoundary(color: (x: number, y: number) => number[], left: number, right: number, from: number, to: number) {
  const width = right - left;
  const xs = [0.12, 0.32, 0.68, 0.88].map((fraction) => left + width * fraction);
  const candidates: number[] = [];
  for (let y = from + 2; y < to - 2; y += 0.5) {
    const ruled = xs.filter((x) => {
      const current = color(x, y)[0];
      return current < 100 && color(x, y - 2)[0] - current > 60 && color(x, y + 2)[0] - current > 60;
    }).length;
    if (ruled >= 3) candidates.push(y);
  }
  // A time label is positioned a few points below the top border of its row.
  return candidates.sort((a, b) => Math.abs(a - (to - 5)) - Math.abs(b - (to - 5)))[0] ?? null;
}

export function splitLesson(value: string): Omit<Pair, "time"> | null {
  // The PDF text layer occasionally paints the label twice without another
  // lesson between them: "преп преп Фамилия".
  value = value.replace(/преп(?:\s+преп)+(?=\s|$)/gi, 'преп');
  const separator = value.match(/преп\s*\.?\s*/i);
  if (!separator || separator.index === undefined) return null;
  // A second teacher marker indicates that two lessons have been joined.
  if (/преп\s*\.?/i.test(value.slice(separator.index + separator[0].length))) return null;
  const subjectPart = value.slice(0, separator.index)
    .replace(/^(?:(?:Подгруппа|п\/г)\s*[АБ12]\s*)+/i, '')
    .replace(/^\d{1,2}\.\d{2}\s+(?=[А-ЯЁ])/i, '').trim();
  const tail = value.slice(separator.index + separator[0].length).trim();
  // Rooms can appear before the subject, after it, or after the teacher.
  // A street address / stadium is a location, never a person's surname.
  const locationPattern = /(?:(?:г\.?\s*Самара\s*,?\s*)?(?:ул\.?\s*)?[А-ЯЁ][а-яё-]+\s+\d+[а-яёa-z]?\s*,?\s*(?:стадион|спорткомплекс|спортивный комплекс|спортзал|спортивный зал)[^,]*(?:,\s*[^,]+)?|(?:стадион|спорткомплекс|спортивный комплекс|баскетбольный зал|спортивный зал|спорт\s*зал)[^,]*(?:,\s*[^,]+)?)/i;
  const address = value.match(locationPattern)?.[0]?.trim();
  const roomPattern = /(?:аудитория|ауд\.?|кабинет|каб\.?)\s*№?\s*(\d+[а-яёa-z]?(?:[-/]\d+[а-яёa-z]?)?)/gi;
  const rooms = [...value.matchAll(roomPattern)].map((match) => match[1]);
  if (new Set(rooms.map((room) => room.toLocaleLowerCase('ru'))).size > 1) return null;
  const auditorium = rooms[0];
  const room = address ?? auditorium ?? '—';
  const stripLocation = (s: string) => s.replace(roomPattern, ' ')
    .replace(locationPattern, ' ').replace(/дистанционно/gi, ' ').replace(/\s+/g, ' ').trim();
  const subject = stripLocation(subjectPart);
  const teacher = stripLocation(tail).replace(/^[,;–-]+|[,;–-]+$/g, '').trim();
  if (!subject || /(?:^|\s)(?:ауд(?:итория)?|каб(?:инет)?)\.?(?:\s|$)/i.test(subject + ' ' + teacher)) return null;
  return { subject, teacher: teacher || '—', room, remote: /(?:дистанционно|дистант|онлайн)/i.test(value) };
}

function parseCell(source: Text[], left: number, right: number, top: number, bottom: number,
  extendLeft = 0, extendRight = 0): (Omit<Pair, "time"> & { timeHint?: string }) | null {
  const strings = source.filter((t) => !t.rot && t.y > top + 1 && t.y < bottom - 0.2 &&
    t.x + t.width / 2 > left + 1 - extendLeft && t.x + t.width / 2 < right - 1 + extendRight)
    .sort((a, b) => a.y - b.y || a.x - b.x).map((t) => t.str);
  const value = strings.join(" ").replace(/\s+/g, " ").trim();
  const lesson = splitLesson(value);
  if (!lesson && /преп\s*\.?/i.test(value))
    throw new Error(`Строки расписания смешаны: ${value.slice(0, 140)}`);
  const start = value.match(/^(\d{1,2})\.(\d{2})\s+(?=[А-ЯЁ])/i);
  return lesson && start ? { ...lesson, timeHint: `${start[1].padStart(2, '0')}:${start[2]}` } : lesson;
}

export async function parseSchedule(buffer: ArrayBuffer, group: string, sample?: (x: number, y: number) => number[]): Promise<Day[]> {
  const page = await open(buffer);
  const items = await text(page);
  const color = sample ?? await pixels(page);
  return scheduleFromPage(page, items, color, group);
}

// Reuse the PDF render and text extraction for every group in a shared timetable.
export async function parseSchedules(buffer: ArrayBuffer, groups: string[]): Promise<Record<string, Day[]>> {
  const page = await open(buffer);
  const items = await text(page);
  const color = await pixels(page);
  const result: Record<string, Day[]> = {};
  for (const group of groups) {
    try { result[group] = scheduleFromPage(page, items, color, group); }
    catch { /* A missing column must not hide other groups in this PDF. */ }
  }
  return result;
}

export function scheduleFromPage(page: PDFPageProxy, items: Text[], color: (x: number, y: number) => number[], group: string): Day[] {
  const normalized = group.toLocaleUpperCase('ru');
  const headers = items.filter((t) => t.y < 82 && /^(?:К-[А-ЯЁ]+|БД|ЗУ|Юр)-\d/i.test(t.str))
    .sort((a, b) => a.x - b.x);
  const header = headers.find((t) => t.str.toLocaleUpperCase('ru') === normalized ||
    (normalized === 'К-БД-21' && t.str.toLocaleUpperCase('ru') === 'К-БД-39,21') ||
    (normalized === 'К-БД-39' && t.str.toLocaleUpperCase('ru') === 'К-БД-39,21') ||
    (normalized === 'ЗУ-29' && t.str.toLocaleUpperCase('ru') === 'ЗУ-29,11') ||
    (normalized === 'ЗУ-11' && t.str.toLocaleUpperCase('ru') === 'ЗУ-29,11') ||
    (normalized === 'К-ИИ-19' && t.str.toLocaleUpperCase('ru').includes('К-ИИ-19') && t.str.includes(',')) ||
    (normalized === 'К-ТЭ-19-2' && t.str.toLocaleUpperCase('ru').includes('К-ТЭ-19-2')));
  if (!header) throw new Error(`Группа ${group} не найдена в опубликованном PDF`);
  const height = page.view[3];
  const headerIndex = headers.indexOf(header);
  const groupX = header.x + header.width / 2;
  const groupLeft = headerIndex > 0
    ? (headers[headerIndex - 1].x + headers[headerIndex - 1].width / 2 + groupX) / 2
    : Math.max(32, groupX - (headers[1]?.x + headers[1]?.width / 2 - groupX) / 2);
  const groupRight = headerIndex < headers.length - 1
    ? (groupX + headers[headerIndex + 1].x + headers[headerIndex + 1].width / 2) / 2
    : Math.min(page.view[2] - 8, groupX + (groupX - (headers[headerIndex - 1]?.x + headers[headerIndex - 1]?.width / 2)) / 2);
  const separatorX = headers[0].x + headers[0].width / 2;
  const separators: number[] = [];
  for (let y = header.y + 12; y < height - 15; y += 0.5) {
    if (yellow(color(separatorX, y)) && (separators.length === 0 || y - separators[separators.length - 1] > 15))
      separators.push(y);
  }
  if (separators.length < 5) throw new Error("Не удалось проверить границы дней в расписании");
  const ends = [header.y + 6, ...separators, height - 10];
  const result: Day[] = [];
  for (let day = 0; day < 6; day++) {
    const start = ends[day], end = ends[day + 1];
    const anchors = items.filter((t) => t.x >= 15 && t.x < Math.min(...headers.map((h) => h.x)) - 12 && t.y > start && t.y < end &&
      /^(?:8\.15|9\.00|9\.55|11\.50|13\.30|15\.20|17\.00)/.test(t.str))
      .sort((a, b) => a.y - b.y);
    if (anchors.length < 4 || anchors.length > 7) throw new Error(`Не удалось разобрать часы: ${WEEKDAYS[day]}`);
    const pairs: Pair[] = [];
    for (let index = 0; index < anchors.length; index++) {
      const previous = anchors[index - 1];
      const next = anchors[index + 1];
      const top = rowBoundary(color, groupLeft, groupRight, previous?.y ?? start, anchors[index].y)
        ?? (previous ? (previous.y + anchors[index].y) / 2 : start);
      const bottom = next
        ? rowBoundary(color, groupLeft, groupRight, anchors[index].y, next.y) ?? (anchors[index].y + next.y) / 2
        : end - 1;
      if (gray(color(groupX - 16, anchors[index].y)) && gray(color(groupX + 16, anchors[index].y))) continue;
      // Header centers only approximate the actual column edges. Search a
      // fraction of the column width for the printed rule. When a row has no
      // rule (merged cells), keep the inferred edge: widening into the next
      // group silently steals its teacher, room and even a whole lesson.
      const radius = Math.min(35, (groupRight - groupLeft) * 0.35);
      const leftRule = nearbyBoundary(color, groupLeft, top, bottom, radius);
      const rightRule = nearbyBoundary(color, groupRight, top, bottom, radius);
      const left = leftRule ?? groupLeft;
      const right = rightRule ?? groupRight;
      const middle = nearbyBoundary(color, groupX, top, bottom) !== null;
      const cells = middle ? [{ left: groupLeft, right: groupX, extendLeft: 0, extendRight: 0 },
        { left: groupX, right: groupRight, extendLeft: 0, extendRight: 0 }] :
        [{ left, right, extendLeft: leftRule === null ? 4 : 0, extendRight: rightRule === null ? 4 : 0 }];
      const parts = cells.map(({ left, right, extendLeft, extendRight }, part) => {
        const cell = parseCell(items, left, right, top, bottom, extendLeft, extendRight);
        if (!cell) return null;
        const { timeHint, ...parsed } = cell;
        if (!parsed.remote && parsed.room === '—') {
          if (typeof window !== 'undefined' && window.location.hostname === '127.0.0.1')
            console.warn('IMI PDF cell', JSON.stringify({ group, day, index, top, bottom, left, right, middle,
              nearby: items.filter((t) => t.y > top - 4 && t.y < bottom + 4 &&
                t.x > left - 20 && t.x < right + 20).map(({ str, x, y, width }) => ({ str, x, y, width })) }));
          throw new Error(`Не удалось определить кабинет: ${group}, ${WEEKDAYS[day]}, ${pairTime(anchors[index], items, TIMES[index])}`);
        }
        return { ...parsed, time: timeHint ?? pairTime(anchors[index], items, TIMES[index]),
          ...(middle ? { subgroup: (part === 0 ? "А" : "Б") as "А" | "Б" } : {}) };
      });
      const found = parts.filter((part) => part !== null);
      if (middle && found.length === 0) {
        const cell = parseCell(items, left, right, top, bottom,
          leftRule === null ? 4 : 0, rightRule === null ? 4 : 0);
        if (cell) {
          const { timeHint, ...whole } = cell;
          if (!whole.remote && whole.room === '—')
            throw new Error(`Не удалось определить кабинет: ${group}, ${WEEKDAYS[day]}, ${pairTime(anchors[index], items, TIMES[index])}`);
          pairs.push({ ...whole, time: timeHint ?? pairTime(anchors[index], items, TIMES[index]) });
        }
      } else for (const part of found) pairs.push(part);
    }
    const off = Array.from({ length: 4 }, (_, i) => gray(color(groupX, start + (end - start) * (i + 1) / 5)))
      .filter(Boolean).length >= 3 && pairs.length === 0;
    result.push({ label: WEEKDAYS[day], pairs, off });
  }
  return result;
}
