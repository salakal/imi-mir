import type { Day } from './pdf-data';

export type Lesson = { date: string; day: string; time: string; subject: string; teacher: string; room: string; groups: string[]; subgroup?: string; remote: boolean };
export type Teacher = { id: string; name: string; lessons: Lesson[] };
export type ScheduleSource = { path: string; modified?: string; groups: string[]; week: string; year: number };
export const normalizeTeacher = (name: string) => name.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\./g, '').replace(/\s+/g, ' ').trim();
export function teacherId(name: string) {
  // Keep different initials distinct, even when surnames match.
  return normalizeTeacher(name).replace(/\s/g, '');
}
export function matchesTeacher(name: string, query: string) {
  const candidate = normalizeTeacher(name);
  const input = normalizeTeacher(query);
  if (!input) return true;
  if (candidate.replace(/\s/g, '').includes(input.replace(/\s/g, ''))) return true;
  const [surname, ...rest] = input.split(' ');
  const [actualSurname, ...initials] = candidate.split(' ');
  return rest.length > 0 && actualSurname.includes(surname) && rest.every((word, index) => initials[index]?.startsWith(word[0]));
}
export function dayDates(source: ScheduleSource): string[] {
  const m = source.week.match(/(\d{1,2})\.(\d{1,2})\s*[-–]\s*(\d{1,2})\.(\d{1,2})/);
  if (!m) return [];
  const year = Number(m[2]) > Number(m[4]) ? source.year - 1 : source.year;
  const start = new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[1])));
  return Array.from({ length: 6 }, (_, i) => new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10));
}
export function buildTeachers(entries: { source: ScheduleSource; group: string; days: Day[] }[]): Teacher[] {
  const index = new Map<string, Teacher>();
  for (const { source, group, days } of entries) {
    const dates = dayDates(source);
    days.forEach((day, i) => day.pairs.forEach((pair) => {
      if (!pair.teacher || pair.teacher === '—' || !dates[i]) return;
      const name = pair.teacher.replace(/\s+/g, ' ').trim();
      const id = teacherId(name);
      if (!id) return;
      let teacher = index.get(id);
      if (!teacher) { teacher = { id, name, lessons: [] }; index.set(id, teacher); }
      const key = `${dates[i]}|${pair.time}|${normalizeTeacher(pair.subject)}|${pair.room}|${pair.subgroup ?? ''}`;
      const same = teacher.lessons.find((p) => `${p.date}|${p.time}|${normalizeTeacher(p.subject)}|${p.room}|${p.subgroup ?? ''}` === key);
      if (same) { if (!same.groups.includes(group)) same.groups.push(group); }
      else teacher.lessons.push({ date: dates[i], day: day.label, time: pair.time, subject: pair.subject, teacher: name, room: pair.room, groups: [group], subgroup: pair.subgroup, remote: pair.remote });
    }));
  }
  return [...index.values()].map((teacher) => ({ ...teacher, lessons: teacher.lessons.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)) })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}
export function futureLesson(teacher: Teacher, now = new Date()) {
  const local = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Samara', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(now).replace(' ', 'T');
  return teacher.lessons.find((lesson) => `${lesson.date}T${lesson.time.slice(0, 5)}` >= local);
}
