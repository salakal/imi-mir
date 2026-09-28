import type { Group, Institution, Source } from './groups';
export type Week = { path: string; name: string; start: string };
export type Catalog = { groups: Group[]; weeks: Record<Institution, Week[]>; expectedMonday: string; year: number; checkedAt: string; source: string };
export type Manifest = { week: string | null; expectedMonday: string; year: number; schedule: Source | null; debts: Source | null; checkedAt: string; source: string };

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json() as { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Источник ответил ${response.status}`);
  return data as T;
}
export function getCatalog() { return json<Catalog>('/api/catalog'); }
export function getManifest(group: string, week?: string) {
  const query = new URLSearchParams({ group });
  if (week) query.set('week', week);
  return json<Manifest>(`/api/manifest?${query}`);
}
export async function getPdf(path: string) {
  const response = await fetch(`/api/pdf?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Не удалось скачать PDF (${response.status})`);
  return response.arrayBuffer();
}
