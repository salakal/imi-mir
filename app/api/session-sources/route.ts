import { getSessionSources } from '@/lib/yandex-server';
export async function GET() {
  try { return Response.json({ sources: await getSessionSources() }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Источник недоступен' }, { status: 503 }); }
}
