// Fetch the published timetable and check the neighboring columns shown in
// the 28 September 2026 report. Run with Node 22+ and poppler-utils installed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSchedule } from '../lib/pdf-data.ts';

const root = 'https://disk.yandex.ru/d/KTpb1wS1l0-amA';
const path = '/Расписание/Колледж "МИР"/нечетная неделя 28.09-03.10';
const api = 'https://cloud-api.yandex.net/v1/disk/public/resources';
async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Источник ответил ${response.status}`);
  return response;
}
function query(endpoint, path) {
  const url = new URL(api + endpoint);
  url.searchParams.set('public_key', root);
  url.searchParams.set('path', path);
  return url;
}
const listing = await (await get(query('', path))).json();
const file = listing._embedded?.items?.find((entry) => entry.type === 'file' &&
  entry.name.toLocaleUpperCase('ru').replace(/[^А-ЯЁ0-9]/g, '').includes('КРУКТЭКИИ'));
assert.ok(file, 'В папке нужной недели не найден общий PDF для К-ТЭ и К-ИИ');
const download = await (await get(query('/download', file.path))).json();
assert.ok(download.href, 'Яндекс.Диск не вернул ссылку на PDF');
const bytes = Buffer.from(await (await get(download.href)).arrayBuffer());
assert.ok(bytes.length > 10000 && bytes.subarray(0, 4).toString() === '%PDF', 'Получен не PDF');

const dir = mkdtempSync(join(tmpdir(), 'imi-schedule-'));
try {
  const source = join(dir, 'source.pdf');
  const image = join(dir, 'page');
  writeFileSync(source, bytes);
  execFileSync('pdftoppm', ['-f', '1', '-singlefile', '-r', '144', source, image]);
  const ppm = readFileSync(`${image}.ppm`);
  const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(ppm.toString('ascii', 0, 64));
  assert.ok(header, 'Не удалось прочесть изображение PDF');
  const [width, height] = header.slice(1).map(Number);
  const offset = Buffer.byteLength(header[0], 'ascii');
  assert.equal(ppm.length - offset, width * height * 3);
  const sample = (x, y) => {
    const px = Math.max(0, Math.min(width - 1, Math.round(x * 2)));
    const py = Math.max(0, Math.min(height - 1, Math.round(y * 2)));
    return [...ppm.subarray(offset + (py * width + px) * 3, offset + (py * width + px) * 3 + 3)];
  };
  const expected = {
    'К-ТЭ-19-1': [
      ['Информатика', 'Анохина', '412'],
      ['Индивидуальный проект', 'Анохина', '518'],
      ['Обществознание', 'Степанова', '516'],
      ['Физика', 'Зотова', '408'],
    ],
    'К-ИИ-19': [
      ['Разговоры о важном', 'Степанова', '521'],
      ['Обществознание', 'Степанова', '516'],
      ['Физика', 'Зотова', '408'],
      ['Математика', 'Акимова', '411'],
    ],
  };
  for (const [group, monday] of Object.entries(expected)) {
    const days = await parseSchedule(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), group, sample);
    const actual = days[0].pairs;
    assert.equal(actual.length, monday.length, `${group}: число пар в понедельник`);
    for (const [i, [subject, teacher, room]] of monday.entries()) {
      assert.equal(actual[i].subject, subject, `${group}: предмет ${i + 1}`);
      assert.ok(actual[i].teacher.includes(teacher), `${group}: преподаватель ${i + 1}: ${actual[i].teacher}`);
      assert.equal(actual[i].room, room, `${group}: кабинет ${i + 1}`);
    }
    for (const day of days) for (const pair of day.pairs) {
      assert.ok(pair.remote || pair.room !== '—', `${group}: ${day.label}, ${pair.time}, кабинет пропал`);
      assert.doesNotMatch(`${pair.subject} ${pair.teacher}`, /(?:^|\s)(?:ауд|каб)\.?\s/i);
    }
    assert.equal(days[0].pairs[0].remote, false, `${group}: цветная ячейка ошибочно признана дистантом`);
    console.log(group, file.name, days.reduce((count, day) => count + day.pairs.length, 0), 'пар проверено');
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
