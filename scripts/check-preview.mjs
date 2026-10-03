// Smoke-test a running build and its live timetable proxy.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const root = process.env.IMI_SITE_URL ?? 'https://imi-mir-git-preview-initial-source-vadimkamatveev07-2378.vercel.app';
const digest = (value) => createHash('sha256').update(value).digest('hex');
async function get(path) {
  let last;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(new URL(path, root), { signal: AbortSignal.timeout(20000), cache: 'no-store' });
      if (response.ok) return response;
      last = new Error(`${path}: HTTP ${response.status}`);
    } catch (error) { last = error; }
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw last;
}
const homeResponse = await get('/');
console.log('Site response:', homeResponse.status, homeResponse.url);
const home = await homeResponse.text();
assert.match(home, /IMI/, 'В Preview нет заголовка IMI');
const manifest = await (await get('/api/manifest?group=college%3A%D0%9A-%D0%A2%D0%AD-19-1')).json();
assert.ok(manifest.schedule?.path, 'Preview не находит расписание К-ТЭ-19-1');
const downloadApi = new URL('https://cloud-api.yandex.net/v1/disk/public/resources/download');
downloadApi.searchParams.set('public_key', 'https://disk.yandex.ru/d/KTpb1wS1l0-amA');
downloadApi.searchParams.set('path', manifest.schedule.path);
const metadata = await fetch(downloadApi, {signal:AbortSignal.timeout(30000)});
assert.equal(metadata.status, 200, 'Официальный источник не отдал ссылку для сравнения');
const {href} = await metadata.json();
assert.ok(href, 'Официальный источник не вернул PDF');
const official = await fetch(href, {signal:AbortSignal.timeout(60000)});
assert.equal(official.status, 200, 'Официальный PDF недоступен');
const source = Buffer.from(await official.arrayBuffer());
const pdf = Buffer.from(await (await get(`/api/pdf?path=${encodeURIComponent(manifest.schedule.path)}`)).arrayBuffer());
assert.equal(digest(pdf), digest(source), 'Preview отдаёт другой PDF, чем официальный источник');
console.log('Preview homepage, manifest and proxied official PDF verified');
