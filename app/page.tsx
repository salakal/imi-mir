"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, CalendarDays, Check, CircleCheck, Clock3, RefreshCw, Search, Wifi, Users } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type Day, type Debt, type Student, parseDebts, parseSchedule } from '@/lib/pdf-data';
import { type Group, type Institution, INSTITUTIONS, ROOT } from '@/lib/groups';
import { getCatalog, getManifest, getPdf, type Catalog, type Manifest } from '@/lib/yandex';
import { displayLessonLocation } from '@/lib/display-location';
import TeacherPanel from '@/components/TeacherPanel';
import SessionPanel from '@/components/SessionPanel';

const defaultGroup = 'college:К-ИСП-49-1';
const profileKey = (g: Group) => g.id === defaultGroup ? 'mir49:student' : g.id === 'college:К-ИСП-49-2' ? 'mir:49-2:student' : g.id === 'college:К-ИСП-31' ? 'mir:31:student' : `mir:${g.id}:student`;
const marksKey = (g: Group, name: string) => g.id === defaultGroup ? `mir49:marks:${name}` : g.id === 'college:К-ИСП-49-2' ? `mir:49-2:marks:${name}` : g.id === 'college:К-ИСП-31' ? `mir:31:marks:${name}` : `mir:${g.id}:marks:${name}`;
function stamp(value?: string) {
  if (!value) return 'дата неизвестна';
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Samara', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) + ' (Самара)';
}
function message(error: unknown) { return error instanceof Error ? error.message : 'Неизвестная ошибка'; }
function dateRange(week: string | null, year?: number) {
  const match = week?.match(/(\d{1,2})\.(\d{1,2})\s*[-–]\s*(\d{1,2})\.(\d{1,2})/);
  return match ? { label: `${match[1]}.${match[2]} — ${match[3]}.${match[4]}`, first: new Date(Date.UTC(year ?? new Date().getUTCFullYear(), Number(match[2]) - 1, Number(match[1]))) } : null;
}

export default function Home() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [institution, setInstitution] = useState<Institution>('college');
  const [groupId, setGroupId] = useState('');
  const [weekPath, setWeekPath] = useState('');
  const [refreshCount, setRefreshCount] = useState(0);
  const [tab, setTab] = useState('debts');
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [days, setDays] = useState<Day[]>([]);
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [marks, setMarks] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [debtsError, setDebtsError] = useState('');
  const [scheduleError, setScheduleError] = useState('');
  const [showMarked, setShowMarked] = useState(false);
  const [debtCheckedAt, setDebtCheckedAt] = useState('');
  const [scheduleCheckedAt, setScheduleCheckedAt] = useState('');
  const loadSequence = useRef(0);
  useEffect(() => {
    try {
      const saved = localStorage.getItem('mir:group');
      if (saved) { setGroupId(saved); setInstitution(saved.startsWith('faculty:') ? 'faculty' : 'college'); }
    } catch { /* Browser storage can be disabled. */ }
  }, []);
  useEffect(() => {
    let active = true;
    getCatalog().then((data) => { if (active) { setCatalog(data); setCatalogError(''); } })
      .catch((error) => { if (active) { setCatalog(null); setCatalogError(message(error)); setBusy(false); } });
    return () => { active = false; };
  }, [refreshCount]);
  const group = catalog?.groups.find((item) => item.id === groupId && item.institution === institution) ?? null;
  const groups = catalog?.groups.filter((item) => item.institution === institution) ?? [];
  const availableWeeks = catalog?.weeks[institution] ?? [];
  const selectGroup = useCallback((next: Group) => {
    loadSequence.current++;
    setGroupId(next.id); setInstitution(next.institution); setWeekPath('');
    setStudents([]); setDays([]); setManifest(null); setQuery(''); setSelected('');
    try { localStorage.setItem('mir:group', next.id); } catch { /* Local storage is optional. */ }
  }, []);
  useEffect(() => {
    if (!catalog || group || !groupId) return;
    const replacement = groups[0] ?? catalog.groups[0];
    if (replacement) selectGroup(replacement);
  }, [catalog, group, groups, selectGroup]);
  const load = useCallback(async () => {
    if (!group) return;
    const sequence = ++loadSequence.current;
    setBusy(true); setDebtsError(''); setScheduleError(''); setManifest(null); setStudents([]); setDays([]);
    try {
      const info = await getManifest(group.id, weekPath || undefined);
      if (sequence !== loadSequence.current) return;
      setManifest(info);
      const jobs = await Promise.allSettled([
        info.debts ? getPdf(info.debts.path).then((buffer) => parseDebts(buffer, group.name)) : Promise.reject(new Error('Для этой группы сводная ведомость пока не опубликована')),
        info.schedule ? getPdf(info.schedule.path).then((buffer) => parseSchedule(buffer, group.name)) : Promise.reject(new Error(info.week ? 'В папке этой недели нет расписания группы' : 'Нужная неделя ещё не опубликована')),
      ]);
      if (sequence !== loadSequence.current) return;
      if (jobs[0].status === 'fulfilled') { setStudents(jobs[0].value); setDebtCheckedAt(info.checkedAt); }
      else setDebtsError(message(jobs[0].reason));
      if (jobs[1].status === 'fulfilled') { setDays(jobs[1].value); setScheduleCheckedAt(info.checkedAt); }
      else setScheduleError(message(jobs[1].reason));
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      setDebtsError(message(error)); setScheduleError(message(error));
    } finally { if (sequence === loadSequence.current) setBusy(false); }
  }, [group, weekPath]);
  useEffect(() => { void load(); return () => { loadSequence.current++; }; }, [load]);
  useEffect(() => {
    if (!group) return;
    try { setSelected(localStorage.getItem(profileKey(group)) ?? ''); }
    catch { setSelected(''); }
    setQuery('');
  }, [group?.id]);
  useEffect(() => {
    if (!group || !selected) { setMarks([]); return; }
    try { setMarks(JSON.parse(localStorage.getItem(marksKey(group, selected)) ?? '[]')); }
    catch { setMarks([]); }
  }, [group?.id, selected]);
  useEffect(() => {
    if (!group || !selected || students.length === 0) return;
    const valid = new Set(students.find((s) => s.name === selected)?.debts.map((d) => d.id) ?? []);
    setMarks((current) => {
      const filtered = current.filter((id) => valid.has(id));
      if (filtered.length !== current.length) try { localStorage.setItem(marksKey(group, selected), JSON.stringify(filtered)); } catch { /* Local storage is optional. */ }
      return filtered.length === current.length ? current : filtered;
    });
  }, [students, selected, group?.id]);
  function choose(name: string) {
    if (!group) return;
    setSelected(name); setQuery('');
    try { localStorage.setItem(profileKey(group), name); } catch { /* Local storage is optional. */ }
  }
  function toggle(debt: Debt) {
    if (!group || !selected) return;
    setMarks((current) => {
      const next = current.includes(debt.id) ? current.filter((id) => id !== debt.id) : [...current, debt.id];
      try { localStorage.setItem(marksKey(group, selected), JSON.stringify(next)); } catch { /* Local storage is optional. */ }
      return next;
    });
  }
  const person = students.find((s) => s.name === selected);
  const matches = useMemo(() => students.filter((s) => s.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))).slice(0, 10), [students, query]);
  const active = person?.debts.filter((d) => !marks.includes(d.id)) ?? [];
  const marked = person?.debts.filter((d) => marks.includes(d.id)) ?? [];
  const range = dateRange(manifest?.week ?? null, manifest?.year);
  const dateOf = (index: number) => {
    if (!range) return '';
    const date = new Date(range.first); date.setUTCDate(date.getUTCDate() + index);
    return `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  return <div className="shell">
    <header className="topbar"><div className="brand"><img className="brand-symbol" src="/favicon.svg" alt="" /><div><strong>IMI</strong><small>{group?.name ?? 'Студенческий сервис'} · {INSTITUTIONS[institution]}</small></div></div><div className="header-actions"><button className="refresh" onClick={() => { setRefreshCount((n) => n + 1); void load(); }} disabled={busy} title="Проверить данные заново" aria-label="Обновить данные"><RefreshCw size={18} className={busy ? 'spinning' : ''} /><span>Обновить</span></button></div></header>
    <main className="main"><div className="intro"><div><span className="eyebrow">Колледж и факультет СПО</span><h1>Что сейчас по учёбе</h1><p>Расписание, долги, сессия и всё нужное по учёбе.</p></div><div className="live-chip"><span /> Данные с Яндекс.Диска</div></div>
      {catalogError && <div className="panel state error"><strong>Не удалось получить список групп</strong><p>{catalogError}</p><button onClick={() => setRefreshCount((n) => n + 1)}>Попробовать снова</button></div>}
      {!catalogError && !catalog && <div className="panel state">Загружаю группы из публичной папки…</div>}
      {catalog && <><div className="institution-picker" role="group" aria-label="Выбрать отделение">{(['college', 'faculty'] as Institution[]).map((item) => <button key={item} type="button" className={institution === item ? 'selected' : ''} aria-pressed={institution === item} onClick={() => { setInstitution(item); setGroupId(''); setTab('debts'); try { localStorage.removeItem('mir:group'); } catch {} }}>{item === 'college' ? 'Колледж «МИР»' : 'Факультет СПО'}</button>)}</div>
        <div className="selection-row"><label className="group-field">Моя группа<select value={group?.id ?? ''} onChange={(event) => { const next = catalog.groups.find((g) => g.id === event.target.value); if (next) selectGroup(next); }}><option value="" disabled>Выбери группу</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label><span className="group-summary">{groups.length} групп · {institution === 'college' ? 'колледж' : 'факультет СПО'}</span></div>
        {!group && <div className="panel state"><strong>Выбери свою группу</strong><p>Потом откроются расписание, долги и сессия. Преподавателей можно искать по расписанию всех групп.</p><button onClick={() => setTab('teachers')}>Найти преподавателя</button></div>}
        {(group || tab === 'teachers') && <Tabs value={tab} onValueChange={setTab} className="workspace"><TabsList className="main-tabs"><TabsTrigger value="debts"><CircleCheck size={18} /> Долги</TabsTrigger><TabsTrigger value="schedule"><CalendarDays size={18} /> Расписание</TabsTrigger><TabsTrigger value="session"><CalendarDays size={18} /> Сессия</TabsTrigger><TabsTrigger value="teachers"><Users size={18} /> Преподаватели</TabsTrigger></TabsList>
          <TabsContent value="debts" className="tab-content"><div className="panel lead-panel"><div className="section-label">Личный список · {group?.name}</div><h2>Найди себя в ведомости</h2><div className="searchbox"><Search size={20} /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Поиск студента по ФИО" placeholder={selected || 'Начни вводить фамилию или имя'} autoComplete="off" /></div>
            {query.trim() && !debtsError && <div className="suggestions" role="listbox" aria-label="Студенты группы">{matches.length ? matches.map((s) => <button key={s.name} type="button" role="option" aria-selected={s.name === selected} onClick={() => choose(s.name)}>{s.name}<span>{s.debts.length} долгов</span></button>) : !busy && <p>Такого ФИО в ведомости группы нет.</p>}</div>}
            {selected && <div className="selected-person"><span className="avatar">{selected[0]}</span><div><small>Выбранный студент</small><strong>{selected}</strong></div><button onClick={() => { setSelected(''); if (group) try { localStorage.removeItem(profileKey(group)); } catch {} }} className="change">Сменить</button></div>}
            <p className="tiny-note">Поиск только по группе {group?.name}. Имя и личные отметки хранятся в этом браузере.</p></div>
            <div className="data-head"><div><span className="section-label">Сводная ведомость</span><h2>Задолженности</h2></div>{person && !debtsError && <span className="count">{person.debts.length} в ведомости · {active.length} не вычеркнуто</span>}</div>
            {busy && <div className="panel state">Проверяю последнюю ведомость…</div>}
            {!busy && debtsError && <div className="panel state error"><strong>{group?.debts ? 'Не удалось проверить долги' : 'Ведомость пока не опубликована'}</strong><p>{debtsError}. Список без проверенной ведомости не показывается.</p><button onClick={() => void load()}>Попробовать снова</button></div>}
            {!busy && !debtsError && !person && <div className="panel state"><strong>Выбери своё ФИО выше</strong><p>Покажем жёлтые ячейки только в твоём столбце.</p></div>}
            {!busy && !debtsError && person && <><div className="freshness"><Clock3 size={18} /><div><strong>Ведомость изменена: {stamp(manifest?.debts?.modified)}</strong><span>Проверена: {stamp(debtCheckedAt)} · <a href={ROOT} target="_blank" rel="noreferrer">Открыть оригинал <ArrowUpRight size={13} /></a></span></div></div>
              {active.length === 0 && <div className="panel state success"><Check size={24} /><strong>Неотмеченных долгов нет</strong><p>{marked.length ? 'Все жёлтые ячейки отмечены тобой как сданные. Проверь после обновления ведомости.' : 'В твоём столбце нет жёлтых ячеек.'}</p></div>}
              {active.length > 0 && <div className="debt-list">{active.map((d) => <DebtCard key={d.id} debt={d} done={false} onToggle={() => toggle(d)} />)}</div>}
              {marked.length > 0 && <div className="marked-block"><button className="marked-toggle" onClick={() => setShowMarked((v) => !v)} aria-expanded={showMarked}>Отмечено мной: {marked.length} <span>{showMarked ? 'Скрыть ↑' : 'Показать ↓'}</span></button>{showMarked && <div className="debt-list">{marked.map((d) => <DebtCard key={d.id} debt={d} done onToggle={() => toggle(d)} />)}</div>}</div>}
              <p className="explain">«Я сдал(а)» — личная пометка только на этом устройстве. Пока ячейка жёлтая в ведомости, официальный долг остаётся.</p></>}
          </TabsContent>
          <TabsContent value="schedule" className="tab-content"><div className="data-head"><div><span className="section-label">{group?.name}</span><h2>Расписание</h2></div><span className="week-tag">{range?.label ?? `Неделя с ${manifest?.expectedMonday ?? catalog.expectedMonday}`}</span></div>
            <label className="week-field">Опубликованная неделя<select value={weekPath} onChange={(e) => setWeekPath(e.target.value)}><option value="">Нужная неделя · {catalog.expectedMonday}</option>{availableWeeks.map((w) => <option key={w.path} value={w.path}>{w.name}</option>)}</select></label>
            {manifest?.schedule && <div className="source-line">PDF изменён: {stamp(manifest.schedule.modified)} · Проверен: {stamp(scheduleCheckedAt)} · <a href={ROOT} target="_blank" rel="noreferrer">Открыть источник <ArrowUpRight size={13} /></a></div>}
            {busy && <div className="panel state">Проверяю расписание…</div>}
            {!busy && scheduleError && <div className="panel state error"><strong>Расписание сейчас недоступно</strong><p>{scheduleError}. Другая неделя не подставляется автоматически.</p><button onClick={() => void load()}>Попробовать снова</button></div>}
            {!busy && !scheduleError && <div className="day-list">{days.map((day, index) => <section className={`day-card ${day.off ? 'day-off' : ''}`} key={day.label}><div className="day-title"><h3>{day.label}</h3><span>{dateOf(index)}</span></div>{day.off ? <p className="rest">Выходной · пар нет</p> : day.pairs.length ? <div className="pairs">{day.pairs.map((p, i) => <div className="pair" key={`${p.time}:${p.subgroup ?? 'all'}:${i}`}><time>{p.time}</time><div className="pair-body">{p.subgroup && <span className="group-badge">Подгруппа {p.subgroup}</span>}<strong>{p.subject}</strong><span>{p.teacher}</span></div><span className={p.remote ? 'remote-badge' : 'room'}>{p.remote ? <><Wifi size={14} /> Дистант</> : displayLessonLocation(p.room)}</span></div>)}</div> : <p className="rest">Пары не указаны</p>}</section>)}</div>}
          </TabsContent>
          <TabsContent value="session">{tab === 'session' && group && <SessionPanel group={group} groups={catalog.groups} onGroup={selectGroup} refreshKey={refreshCount} />}</TabsContent>
          <TabsContent value="teachers">{tab === 'teachers' && <TeacherPanel weeks={[...new Map([...catalog.weeks.college, ...catalog.weeks.faculty].map((w) => [w.name, w])).values()]} refreshKey={refreshCount} />}</TabsContent>
        </Tabs>}</>}
    </main><footer>Источник: <a href={ROOT} target="_blank" rel="noreferrer">публичные файлы «МИР»</a>. Личные пометки видны только на этом устройстве.</footer>
  </div>;
}
function DebtCard({ debt, done, onToggle }: { debt: Debt; done: boolean; onToggle: () => void }) {
  return <article className={`debt-card ${done ? 'done' : ''}`}><div className="debt-info"><span className="term">{debt.semester} семестр</span><h3>{debt.subject}</h3><p>{debt.teacher}</p>{done && <span className="official">По ведомости всё ещё долг</span>}</div><button className="mark-button" onClick={onToggle}>{done ? 'Отменить отметку' : 'Я сдал(а)'}</button></article>;
}
