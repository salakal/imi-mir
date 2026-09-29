'use client';
import { useEffect, useState } from 'react';
import type { Group } from '@/lib/groups';
import { getPdf } from '@/lib/yandex';
import { parseSession, type SessionInfo, type SessionSource } from '@/lib/sessions';

export default function SessionPanel({ group, groups, onGroup, refreshKey }: { group: Group; groups: Group[]; onGroup: (group: Group) => void; refreshKey: number }) {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [source, setSource] = useState<SessionSource | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true; setInfo(null); setError(''); setLoading(true);
    (async () => {
      const response = await fetch('/api/session-sources', { cache: 'no-store' });
      if (!response.ok) throw new Error('Не удалось проверить файлы сессии. Попробуйте обновить страницу.');
      const { sources } = await response.json() as { sources: SessionSource[] };
      const file = sources.find((s) => s.institution === group.institution) ?? null;
      if (!file) { if (active) { setSource(null); setLoading(false); } return; }
      const result = await parseSession(await getPdf(file.path), group.name, file);
      if (active) { setSource(file); setInfo(result); setLoading(false); }
    })().catch(() => { if (active) { setError('Не удалось проверить данные сессии. Попробуйте обновить страницу.'); setLoading(false); } });
    return () => { active = false; };
  }, [group.id, refreshKey]);
  return <section className="tab-content"><div className="data-head"><div><span className="section-label">2026–2027 учебный год</span><h2>Сессия</h2></div></div>
    <label className="group-field session-group">Группа<select value={group.id} onChange={(e) => { const next = groups.find((g) => g.id === e.target.value); if (next) onGroup(next); }}>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
    {loading && <div className="panel state" role="status">Проверяю опубликованный файл сессии…</div>}
    {!loading && error && <div className="panel state error">{error}</div>}
    {!loading && !error && !info && <div className="panel state"><strong>Расписание сессии для этой группы пока не опубликовано.</strong><p>Если общий файл доступен, в нём не удалось найти надёжную запись для {group.name}.</p></div>}
    {!loading && !error && info && <><div className="source-warning">В опубликованном файле указаны дисциплины по семестрам, но нет дат, времени, кабинетов и преподавателей. Проверь точные даты в расписании, когда его опубликуют.</div>
      {!info.verified && <div className="source-warning" role="status">Некоторые строки опубликованной таблицы не удалось прочитать однозначно. Сверь перечень ниже с исходным документом.</div>}
      {info.items.length === 0 && <div className="panel state">В опубликованном файле пока не удалось выделить дисциплины для {group.name}.</div>}
      {[...new Set(info.items.map((item) => item.semester))].sort((a, b) => a - b).map((term) => <div key={term} className="session-term"><h3>{term} семестр</h3><div className="session-items">{info.items.filter((item) => item.semester === term).map((item, i) => <article className="panel session-item" key={`${item.kind}-${i}`}><span>{item.kind}</span><strong>{item.subject}</strong></article>)}</div></div>)}
      <p className="source-line">Источник: {source?.name} · изменён: {source?.modified ? new Date(source.modified).toLocaleDateString('ru-RU', { timeZone: 'Europe/Samara' }) : 'дата неизвестна'} · <a href={`/api/pdf?path=${encodeURIComponent(info.sourcePath)}#page=${info.page}`} target="_blank" rel="noreferrer">Открыть страницу группы в PDF ↗</a></p>
    </>}
  </section>;
}
