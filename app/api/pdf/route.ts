import { getVerifiedPdf } from '@/lib/yandex-server';

export async function GET(request: Request) {
  const path = new URL(request.url).searchParams.get('path');
  if (!path || path.length > 350 || !path.toLowerCase().endsWith('.pdf')) return new Response('Unknown PDF', { status: 400 });
  try {
    return new Response(await getVerifiedPdf(path), {
      headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Источник недоступен', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
