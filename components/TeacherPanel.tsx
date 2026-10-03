'use client';
import { useEffect, useMemo, useState } from 'react';
import { getPdf } from '@/lib/yandex';
import { parseSchedules } from '@/lib/pdf-data';
import { displayLessonLocation } from '@/lib/display-location';
import { buildTeachers, futureLesson, matchesTeacher, type ScheduleSource, type Teacher } from '@/lib/teachers';
import type { Week } from '@/lib/yandex';

const cache = new Map<string, Teacher[]>();
function lessonLocation(room: string, remote: boolean) {
  if (remote) return 'Дистант';
  if (room === '—') return 'Место не указано';
  return /^\d/.test(room) ? `каб. ${room}` : displayLessonLocation(room);
}
export default function TeacherPanel({ weeks, refreshKey }: { weeks: Week[]; refreshKey: number }) {
  const [week, setWeek] = useState('');
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [errors, setErrors] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  useEffect(() => {
    let cancelled = false;
    const key = `${week}|${refreshKey}`;
    if (cache.has(key)) { setTeachers(cache.get(key)!); setLoading(false); setError(''); return; }
    setLoading(true); setError(''); setErrors(0); setTeachers([]);
    (async () => {
      const response = await fetch(`/api/schedule-sources${week ? `?week=${encodeURIComponent(week)}` : ''}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Не удалось загрузить данные. Попробуйте обновить страницу.');
      const { sources } = await response.json() as { sources: ScheduleSource[] };
      if (!sources.length) { if (!cancelled) { setTeachers([]); setLoading(false); } return; }
      const entries: { source: ScheduleSource; group: string; days: Awaited<ReturnType<typeof parseSchedules>>[string] }[] = [];
      let failed = 0;
      // Three shared PDFs at a time, rather than one download per group or per keystroke.
      for (let i = 0; i < sources.length; i += 3) {
        const batch = await Promise.allSettled(sources.slice(i, i + 3).map(async (source) => {
          const days = await parseSchedules(await getPdf(source.path), source.groups);
          return Object.entries(days).map(([group, value]) => ({ source, group, days: value }));
        }));
        for (const result of batch) if (result.status === 'fulfilled') entries.push(...result.value);
        else failed++;
        if (cancelled) return;
      }
      const data = buildTeachers(entries);
      if (!cancelled) { setTeachers(data); setErrors(failed); setLoading(false); if (!failed) cache.set(key, data); }
    })().catch(() => { if (!cancelled) { setLoading(false); setError('Не удалось загрузить данные. Попробуйте обновить страницу.'); } });
    return () => { cancelled = true; };
  }, [week, refreshKey]);
  const matches = useMemo(() => teachers.filter((teacher) => matchesTeacher(teacher.name, query)).slice(0, 30), [query, teachers]);
  const selected = teachers.find((t) => t.id === selectedId);
  const next = selected && futureLesson(selected);
  return <section className="tab-content"><div className="data-head"><div><span className="section-label">Все опубликованные группы</span><h2>Преподаватели</h2></div></div>
    <p className="section-help">Найди преподавателя по фамилии и посмотри, где у него следующая пара.</p>
    <label className="week-field">Опубликованная неделя<select value={week} onChange={(e) => { setWeek(e.target.value); setSelectedId(''); }}><option value="">Текущая учебная неделя</option>{weeks.map((w) => <option key={w.path} value={w.name}>{w.name}</option>)}</select></label>
    <label className="teacher-search">Фамилия или ФИО преподавателя<div className="searchbox"><input value={query} onChange={(e) => { setQuery(e.target.value); setSelectedId(''); }} placeholder="Например, Иванова" autoComplete="off" /></div></label>
    {loading && <div className="panel state" role="status">Загружаю расписание преподавателей…</div>}
    {!loading && error && <div className="panel state error">{error}</div>}
    {!loading && !error && errors > 0 && <div className="source-warning">Не удалось прочитать {errors} файл(ов). Результаты могут быть неполными.</div>}
    {!loading && !error && !query.trim() && <div className="panel state">Начните вводить фамилию преподавателя.</div>}
    {!loading && !error && query.trim() && !matches.length && <div className="panel state">Преподаватель не найден в опубликованном расписании.</div>}
    {!loading && !error && query.trim() && !selected && matches.length > 0 && <div className="teacher-results">{matches.map((teacher) => <button key={teacher.id} onClick={() => setSelectedId(teacher.id)}><strong>{teacher.name}</strong><span>{teacher.lessons.length} пар · {teacher.lessons[0]?.groups.join(', ')}</span></button>)}</div>}
    {selected && <><button className="back-button" onClick={() => setSelectedId('')}>← К результатам</button><h3 className="teacher-title">{selected.name}</h3>
      {next ? <div className="panel next-lesson"><span className="section-label">Ближайшая пара</span><strong>{next.day}, {next.date.slice(8)}.{next.date.slice(5, 7)} · {next.time}</strong><p>{next.subject}</p><span>{lessonLocation(next.room, next.remote)} · {next.groups.join(' · ')}</span></div> : <div className="panel state">В опубликованном расписании на эту неделю предстоящих занятий не найдено.</div>}
      <div className="day-list teacher-days">{selected.lessons.map((lesson, i) => <div className="panel teacher-lesson" key={`${lesson.date}-${lesson.time}-${i}`}><time>{lesson.day}, {lesson.date.slice(8)}.{lesson.date.slice(5, 7)} · {lesson.time}</time><strong>{lesson.subject}</strong><span>{lesson.groups.join(' · ')} · {lessonLocation(lesson.room, lesson.remote)}{lesson.subgroup ? ` · подгруппа ${lesson.subgroup}` : ''}</span></div>)}</div>
    </>}
  </section>;
}
