export type Institution = 'college' | 'faculty';
export type Source = { path: string; name: string; modified?: string; size?: number };
export type Group = { id: string; name: string; institution: Institution; debts: Source | null };
export const ROOT = 'https://disk.yandex.ru/d/KTpb1wS1l0-amA';
export const INSTITUTIONS: Record<Institution, string> = {
  college: 'Колледж "МИР"', faculty: 'Факультет СПО Университет "МИР"',
};
export function groupId(institution: Institution, name: string) { return `${institution}:${name.toLocaleUpperCase('ru')}`; }
export function canonical(name: string) {
  return name.replace(/\.pdf$/i, '').toLocaleUpperCase('ru').replace(/^К(?=[А-ЯЁ])/, 'К-')
    .replace(/^ЮР/, 'Юр').replace(/\s+/g, '');
}
// These names occur in timetable PDFs but have no published summary sheet.
export const SCHEDULE_ONLY: Record<Institution, string[]> = {
  college: ['К-БД-11', 'К-ПД-29', 'К-ТД-19', 'К-ТЭ-11', 'К-ТЭ-19-1', 'К-ТЭ-19-2', 'К-Ю-19-1', 'К-Ю-19-2', 'К-ИИ-19', 'К-РУ-19'],
  faculty: ['БД-19-1', 'БД-19-2', 'ЗУ-11', 'ЗУ-19', 'Юр-11', 'Юр-19-1', 'Юр-19-2'],
};
