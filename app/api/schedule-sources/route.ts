import { getCatalog, getScheduleSources } from '@/lib/yandex-server';

export async function GET(request: Request) {
  try {
    const catalog = await getCatalog();
    const week = new URL(request.url).searchParams.get('week') || undefined;
    const selected = [...catalog.weeks.college, ...catalog.weeks.faculty].find((w) => w.name === week);
    if (week && !selected)
      return Response.json({ error: 'Неделя не опубликована' }, { status: 404 });
    return Response.json({ sources: await getScheduleSources(catalog.groups, selected?.start) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Источник недоступен' }, { status: 503 });
  }
}
