// Run with: node --experimental-strip-types scripts/check-sessions.mjs college.pdf faculty.pdf
// These PDFs are downloaded from the public Yandex.Disk folder for local verification only.
import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseSessionPage } from '../lib/sessions.ts';

const groups = {
  college: ['К-БД-11', 'К-БД-21', 'К-БД-39', 'К-ИИ-19', 'К-ИСП-21', 'К-ИСП-29-1', 'К-ИСП-29-2', 'К-ИСП-31', 'К-ИСП-39-1', 'К-ИСП-39-2', 'К-ИСП-49-1', 'К-ИСП-49-2', 'К-ПД-19', 'К-ПД-29', 'К-ПД-39', 'К-ПД-49', 'К-РУ-19', 'К-ТД-19', 'К-ТД-29', 'К-ТД-39', 'К-ТЭ-11', 'К-ТЭ-19-1', 'К-ТЭ-19-2', 'К-Ю-19-1', 'К-Ю-19-2', 'К-Ю-29-1', 'К-Ю-29-2', 'К-Ю-39-1', 'К-Ю-39-2'],
  faculty: ['БД-19-1', 'БД-19-2', 'БД-29-1', 'БД-29-2', 'БД-39-1', 'БД-39-2', 'ЗУ-11', 'ЗУ-19', 'ЗУ-29', 'ЗУ-31', 'Юр-11', 'Юр-19-1', 'Юр-19-2', 'Юр-21', 'Юр-29-1', 'Юр-29-2', 'Юр-39-1', 'Юр-39-2'],
};
if (process.argv.length !== 4) throw new Error('Укажите файлы колледжа и факультета СПО');
let failures = 0;
for (const [index, institution] of ['college', 'faculty'].entries()) {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(process.argv[index + 2])) }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const height = page.view[3];
    const content = await page.getTextContent();
    pages.push({ height, text: content.items.flatMap((t) => 'str' in t && t.str.trim()
      ? [{ str: t.str.trim(), x: t.transform[4], y: height - t.transform[5], width: t.width }] : []) });
  }
  for (const group of groups[institution]) {
    const found = pages.map((page, i) => ({ ...parseSessionPage(page.text, group, institution, page.height), page: i + 1 }))
      .filter((result) => result.items);
    const count = found.reduce((sum, result) => sum + result.items.length, 0);
    const verified = found.length > 0 && found.every((result) => result.verified) && count > 0;
    if (!verified) failures++;
    console.log(`${verified ? 'OK' : 'FAIL'} ${institution} ${group}: ${count} предметов, страницы ${found.map((p) => p.page).join(',') || 'нет'}`);
    if (!verified) for (const page of found) console.log(`  ${page.page}: ${page.issues?.join(' | ') || 'нет строк'}`);
  }
}
console.log(`Необработанных групп: ${failures}`);
if (failures) process.exitCode = 1;
