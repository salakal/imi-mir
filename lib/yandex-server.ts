import { canonical, groupId, INSTITUTIONS, ROOT, SCHEDULE_ONLY, type Group, type Institution, type Source } from './groups';
const API = 'https://cloud-api.yandex.net/v1/disk/public/resources';
type Entry = Source & { type: string };
const branch = (kind: 'Расписание' | 'Сводные ведомости', institution: Institution) => `/${kind}/${INSTITUTIONS[institution]}`;

async function fetchWithRetry(url: URL | string) {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(16000) });
      if (response.ok || (response.status < 500 && response.status !== 429)) return response;
      last = new Error(`Яндекс.Диск ответил ${response.status}`);
    } catch (error) { last = error; }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
  }
  throw last instanceof Error ? last : new Error('Яндекс.Диск временно недоступен');
}

async function api(path: string, download = false, offset = 0) {
  const url = new URL(API + (download ? '/download' : ''));
  url.searchParams.set('public_key', ROOT); url.searchParams.set('path', path);
  if (!download) { url.searchParams.set('limit', '1000'); url.searchParams.set('offset', String(offset)); }
  const response = await fetchWithRetry(url);
  if (!response.ok) throw new Error(`Яндекс.Диск ответил ${response.status}`);
  return response.json() as Promise<{ _embedded?: { items: Entry[]; total: number }; href?: string }>;
}

async function list(path: string): Promise<Entry[]> {
  const all: Entry[] = [];
  for (let offset = 0; ; offset += 1000) {
    const data = await api(path, false, offset);
    const items = data._embedded?.items ?? [];
    all.push(...items);
    if (items.length === 0 || all.length >= (data._embedded?.total ?? 0)) return all;
  }
}

function desiredMonday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Samara', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(new Date());
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const date = new Date(Date.UTC(Number(v.year), Number(v.month) - 1, Number(v.day)));
  const weekday = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[v.weekday as 'Mon'] ?? 1;
  date.setUTCDate(date.getUTCDate() + (weekday >= 6 ? 8 - weekday : 1 - weekday));
  return { day: `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}`, year: date.getUTCFullYear() };
}

function weeks(entries: Entry[]) {
  return entries.filter((e) => e.type === 'dir').flatMap((e) => {
    const m = e.name.match(/(\d{1,2})\.(\d{1,2})\s*[-–]\s*(\d{1,2})\.(\d{1,2})/);
    return m ? [{ path: e.path, name: e.name, start: `${m[1].padStart(2, '0')}.${m[2].padStart(2, '0')}` }] : [];
  });
}

export async function getCatalog() {
  const institutions = Object.keys(INSTITUTIONS) as Institution[];
  const [folders, currentWeeks] = await Promise.all([
    Promise.all(institutions.map((i) => list(branch('Сводные ведомости', i)))),
    Promise.all(institutions.map((i) => list(branch('Расписание', i)))),
  ]);
  const dirs = folders.flatMap((items, idx) => items.filter((e) => e.type === 'dir').map((e) => ({ ...e, institution: institutions[idx] })));
  const contents = await Promise.all(dirs.map((dir) => list(dir.path)));
  const groups: Group[] = dirs.flatMap((dir, idx) => contents[idx].filter((e) => e.type === 'file' && /\.pdf$/i.test(e.name)).map((e) => {
    const name = canonical(e.name);
    return { id: groupId(dir.institution, name), name, institution: dir.institution, debts: { path: e.path, name: e.name, modified: e.modified, size: e.size } };
  }));
  for (const institution of institutions) for (const name of SCHEDULE_ONLY[institution]) {
    if (!groups.some((g) => g.id === groupId(institution, name))) groups.push({ id: groupId(institution, name), name, institution, debts: null });
  }
  const availableWeeks = Object.fromEntries(institutions.map((i, idx) => [i, weeks(currentWeeks[idx])])) as Record<Institution, ReturnType<typeof weeks>>;
  const desired = desiredMonday();
  return { groups: groups.sort((a, b) => a.institution.localeCompare(b.institution) || a.name.localeCompare(b.name, 'ru', { numeric: true })),
    weeks: availableWeeks, expectedMonday: desired.day, year: desired.year, checkedAt: new Date().toISOString(), source: ROOT };
}

export async function lookupGroup(id: string): Promise<Group | null> {
  const separator = id.indexOf(':');
  const institution = id.slice(0, separator) as Institution;
  const name = id.slice(separator + 1);
  if (!Object.hasOwn(INSTITUTIONS, institution) ||
    !/^(?:К-(?:ИСП|БД|ТД|ПД|Ю|ИИ|РУ|ТЭ)|БД|ЗУ|ЮР)-\d{1,2}(?:-\d)?$/.test(name) ||
    groupId(institution, name) !== id) return null;
  const specialty = institution === 'college' ? name.match(/^К-[А-ЯЁ]+/)?.[0] :
    name.startsWith('БД-') ? '38.02.07 Банковское дело' :
    name.startsWith('ЗУ-') ? '21.02.19 Землеустройство ' : '40.02.04 Юриспруденция';
  if (!specialty) return null;
  const scheduleOnly = SCHEDULE_ONLY[institution].some((g) => groupId(institution, g) === id);
  const files = await list(`${branch('Сводные ведомости', institution)}/${specialty}`)
    .catch((error: unknown) => {
      if (scheduleOnly && error instanceof Error && /404/.test(error.message)) return [];
      throw error;
    });
  const entry = files.find((e) => e.type === 'file' && /\.pdf$/i.test(e.name) && canonical(e.name).toLocaleUpperCase('ru') === name.toLocaleUpperCase('ru'));
  if (!entry && !scheduleOnly) return null;
  return { id, name: canonical(name), institution, debts: entry ? { path: entry.path, name: entry.name, modified: entry.modified, size: entry.size } : null };
}

function matchesSchedule(group: Group, filename: string) {
  const name = filename.toLocaleUpperCase('ru').replace(/[^А-ЯЁ0-9]/g, '');
  const first = /-19(?:-|$)/.test(group.name);
  const freshman = /(?:1КУРС|1КЛ|9КЛ)/.test(name);
  if (first !== freshman) return false;
  const n = group.name.toLocaleUpperCase('ru');
  if (group.institution === 'faculty') {
    if (first) return true;
    return name.includes(n.startsWith('ЮР') ? 'ЮР' : n.startsWith('БД') ? 'БД' : 'ЗУ');
  }
  if (first) return n.startsWith('К-ПД') || n.startsWith('К-Ю') || n.startsWith('К-ТД')
    ? name.includes('КПДКЮКТД') : name.includes('КРУКТЭКИИ');
  if (n.startsWith('К-ИСП') || n.startsWith('К-ТЭ')) return name.includes('КИСП');
  if (n.startsWith('К-БД') || n.startsWith('К-ТД')) return name.includes('КБДКТД');
  if (n.startsWith('К-ПД')) return name === 'КПД';
  if (n.startsWith('К-Ю')) return name === 'КЮ';
  return false;
}

export async function getManifest(group: Group, weekPath?: string) {
  const listing = weeks(await list(branch('Расписание', group.institution)));
  const desired = desiredMonday();
  const selected = weekPath ? listing.find((w) => w.path === weekPath) : listing.find((w) => w.start === desired.day);
  if (weekPath && !selected) throw new Error('Неделя не найдена в опубликованном расписании');
  const files = selected ? await list(selected.path) : [];
  const schedule = files.find((e) => e.type === 'file' && /\.pdf$/i.test(e.name) && matchesSchedule(group, e.name)) ?? null;
  return { week: selected?.name ?? null, expectedMonday: desired.day, year: desired.year,
    schedule: schedule && { path: schedule.path, modified: schedule.modified, name: schedule.name, size: schedule.size },
    debts: group.debts, checkedAt: new Date().toISOString(), source: ROOT };
}

// One listing per institution and week; clients download each shared PDF once.
export async function getScheduleSources(groups: Group[], weekStart?: string) {
  const desired = desiredMonday();
  const result: { path: string; modified?: string; groups: string[]; institution: Institution; week: string; year: number }[] = [];
  for (const institution of Object.keys(INSTITUTIONS) as Institution[]) {
    const listing = weeks(await list(branch('Расписание', institution)));
    const selected = listing.find((w) => w.start === (weekStart ?? desired.day));
    if (!selected) continue;
    const files = (await list(selected.path)).filter((file) => file.type === 'file' && /\.pdf$/i.test(file.name));
    for (const file of files) {
      const names = groups.filter((group) => group.institution === institution && matchesSchedule(group, file.name)).map((group) => group.name);
      if (names.length) result.push({ path: file.path, modified: file.modified, groups: names, institution, week: selected.name, year: desired.year });
    }
  }
  return result;
}

const SESSION_DIR = '/Зачетно-экзаменационные сессии 2026-2027';
export async function getSessionSources() {
  const files = await list(SESSION_DIR);
  return files.filter((e) => e.type === 'file' && /\.pdf$/i.test(e.name)).flatMap((e) => {
    const institution = /колледж/i.test(e.name) ? 'college' : /СПО/i.test(e.name) ? 'faculty' : null;
    return institution ? [{ path: e.path, name: e.name, modified: e.modified, institution }] : [];
  });
}

// Only proxy PDFs confirmed in the current public folder listing.
export async function getVerifiedPdf(path: string) {
  if (!path.startsWith('/Сводные ведомости/') && !path.startsWith('/Расписание/') && !path.startsWith(`${SESSION_DIR}/`)) throw new Error('Недопустимый путь');
  const parent = path.slice(0, path.lastIndexOf('/'));
  if (!path.startsWith(`${SESSION_DIR}/`) && !Object.values(INSTITUTIONS).some((name) => path.startsWith(`/Сводные ведомости/${name}/`) || path.startsWith(`/Расписание/${name}/`))) throw new Error('Недопустимый раздел');
  if (!(await list(parent)).some((e) => e.type === 'file' && e.path === path && /\.pdf$/i.test(e.name))) throw new Error('PDF не найден в публичной папке');
  const { href } = await api(path, true);
  if (!href) throw new Error('Яндекс.Диск не вернул ссылку на PDF');
  const response = await fetchWithRetry(href);
  if (!response.ok) throw new Error(`Не удалось скачать PDF (${response.status})`);
  return response.arrayBuffer();
}
