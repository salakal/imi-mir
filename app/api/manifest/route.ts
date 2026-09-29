import { lookupGroup, getManifest } from '@/lib/yandex-server';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const group = url.searchParams.get('group');
  const week = url.searchParams.get('week') ?? undefined;
  if (!group || group.length > 90 || (week && week.length > 220)) return Response.json({ error: 'Некорректная группа или неделя' }, { status: 400 });
  try {
    const selected = await lookupGroup(group);
    if (!selected) return Response.json({ error: 'Группа отсутствует в публичных файлах' }, { status: 404 });
    return Response.json(await getManifest(selected, week), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Источник недоступен' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
