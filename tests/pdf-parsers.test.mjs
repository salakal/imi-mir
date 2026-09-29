import test from 'node:test';
import assert from 'node:assert/strict';
import { cellsForGroup, inferMissingColumnRules, rowBoundary, scheduleFromPage, splitLesson } from '../lib/pdf-data.ts';

test('слабые вертикальные штрихи не склеивают две пары через пустые колонки', () => {
  const centers = [90, 196, 302, 408];
  const rules = inferMissingColumnRules([36.5], [197, 410], centers, 36, 469);
  assert.deepEqual(rules, [36.5, 143, 249, 355]);
  assert.deepEqual(cellsForGroup(rules, 37, 143, 36, 469).map(c => [c.left, c.right]), [[36.5, 143]]);
  assert.deepEqual(inferMissingColumnRules([36.5], [197], centers, 36, 469), [36.5]);
});
import { parseSessionPage } from '../lib/sessions.ts';

test('аудитория перед дисциплиной не становится предметом или именем преподавателя', () => {
  assert.deepEqual(splitLesson('ауд 119 Обществознание преп Павлов А.А'), {
    subject: 'Обществознание', teacher: 'Павлов А.А', room: '119', remote: false,
  });
  assert.equal(splitLesson('Обществознание преп Павлов А.А ауд 408')?.room, '408');
});

test('спортивный объект и адрес — это место пары, не ФИО', () => {
  assert.deepEqual(splitLesson('Физическая культура преп Рудакова И.А Агибалова 7А, стадион Локомотив баскетбольный зал'), {
    subject: 'Физическая культура', teacher: 'Рудакова И.А',
    room: 'Агибалова 7А, стадион Локомотив баскетбольный зал', remote: false,
  });
});

test('кабинет и зелёная ячейка «Разговоры о важном» не означают дистант', () => {
  assert.deepEqual(splitLesson('9.00 Разговоры о важном преп Степанова О.П ауд. 521'), {
    subject: 'Разговоры о важном', teacher: 'Степанова О.П', room: '521', remote: false,
  });
  assert.equal(splitLesson('Физическая культура преп Радова Н.Н спорт зал')?.room, 'спорт зал');
  assert.equal(splitLesson('Математика преп Акимова К.В дистанционно')?.remote, true);
  assert.deepEqual(splitLesson('9.00 Разговоры о важном преп преп Степанова О.П ауд 521'), {
    subject: 'Разговоры о важном', teacher: 'Степанова О.П', room: '521', remote: false,
  });
});

test('документ без строки преподавателя и ошибочная метка перед ФИО сохраняют отдельные поля', () => {
  assert.deepEqual(splitLesson('10.00 Всероссийская проверочная работа предмет Общество ауд 411'), {
    subject: 'Всероссийская проверочная работа предмет Общество', teacher: 'Не указан в PDF', room: '411', remote: false,
  });
  assert.deepEqual(splitLesson('Теория государства и права ауд Егорова Ю.О. ауд 412'), {
    subject: 'Теория государства и права', teacher: 'Егорова Ю.О.', room: '412', remote: false,
  });
  assert.equal(splitLesson('Административное право преп Захарова Ю.С. Ауд 205, 205а')?.room, '205, 205а');
});

test('ячейка с colspan назначается всем перекрытым колонкам и обеим подгруппам без дубля', () => {
  const groups = [[0, 100], [100, 200], [200, 300], [300, 400]];
  const owners = (rules, left, right) => groups.map(([a, b]) =>
    cellsForGroup(rules, a, b, 0, 400).filter(c => c.left === left && c.right === right));
  assert.deepEqual(owners([0, 100, 200, 300, 400], 100, 200).map(x=>x.length), [0, 1, 0, 0]);
  assert.deepEqual(owners([0, 100, 300, 400], 100, 300).map(x=>x.length), [0, 1, 1, 0]);
  assert.deepEqual(owners([0, 300, 400], 0, 300).map(x=>x.length), [1, 1, 1, 0]);
  assert.deepEqual(cellsForGroup([0, 100, 200, 300, 400], 100, 200, 0, 400),
    [{left:100,right:200,subgroup:undefined}]);
  assert.deepEqual(cellsForGroup([0, 100, 150, 200, 300, 400], 100, 200, 0, 400),
    [{left:100,right:150,subgroup:'А'},{left:150,right:200,subgroup:'Б'}]);
  assert.deepEqual(owners([0, 400], 0, 400).map(x=>x.length), [1, 1, 1, 1]);
});

test('разные аудитории и второй преподаватель указывают на склейку соседних пар', () => {
  assert.equal(splitLesson('ауд 412 Индивидуальный проект преп Анохина С.А ауд 518'), null);
  assert.equal(splitLesson('Физическая культура преп Радова Н.Н Криминалистика преп Безуглов А.А ауд 119'), null);
  assert.equal(splitLesson('Общие компетенции профессионала Уголовный процесс ауд Ривкина А.И. преп Богомазова Е.В'), null);
  assert.deepEqual(splitLesson('ауд 119 Основы безопасности и защиты Родины преп Павлов А.А'), {
    subject: 'Основы безопасности и защиты Родины', teacher: 'Павлов А.А', room: '119', remote: false,
  });
});

test('граница строки отделяет кабинет от следующего предмета на цветном фоне', () => {
  // Horizontal rules in the official timetable separate adjacent slots even
  // when the printed time labels are not centered inside those slots.
  const color = (x, y) => {
    if (Math.abs(y - 70.5) < 0.26 || Math.abs(y - 92.5) < 0.26) return [25, 25, 25];
    return x > 200 ? [144, 204, 90] : [255, 255, 255];
  };
  assert.equal(rowBoundary(color, 100, 400, 55, 78), 70.5);
  assert.equal(rowBoundary(color, 100, 400, 78, 103), 92.5);
});

test('соседние К-ТЭ-19-1 и К-ИИ-19 сохраняют свои пары и аудитории', () => {
  // Monday's two columns and their contents are taken from the user's
  // screenshot of the official 28.09–03.10 timetable. The other day markers
  // only provide the surrounding table structure required by the parser.
  const items = [
    { str: 'К-ТЭ-19-1', x: 125, y: 35, width: 110, rot: false },
    { str: 'К-ТЭ-19-2, К-ИИ-19', x: 345, y: 35, width: 90, rot: false },
  ];
  const add = (str, x, y, width = 100) => items.push({ str, x, y, width, rot: false });
  for (let day = 0; day < 6; day++) {
    const shift = day * 120;
    for (let row = 0; row < 4; row++)
      add(['8.15-9.45', '9.55-11.25', '11.50-13.20', '13.30-15.00'][row], 25, 55 + shift + 22 * row, 65);
  }
  const left = [
    ['Информатика', 'Анохина С.А.', '412'],
    ['Индивидуальный проект', 'Анохина С.А.', '518'],
    ['Обществознание', 'Степанова О.П.', '516'],
    ['Физика', 'Зотова А.А.', '408'],
  ];
  const right = [
    ['9.00 Разговоры о важном', 'Степанова О.П.', '521'],
    ['Обществознание', 'Степанова О.П.', '516'],
    ['Физика', 'Зотова А.А.', '408'],
    ['Математика', 'Акимова К.В.', '411'],
  ];
  for (let row = 0; row < 4; row++) {
    // PDF.js canvas can place the subject only 0.95 pt below the rule.
    // A 1 pt top margin used to drop this subject while retaining its teacher.
    const y = row === 1 ? 70.95 : 58 + 22 * row;
    for (const [values, x] of [[left[row], 125], [right[row], 345]]) {
      add(values[0], x, y, 100);
      add(`преп ${values[1]}`, x, y + 4, 100);
      add(`ауд ${values[2]}`, x, y + 8, 65);
    }
  }
  const sample = (x, y) => {
    if ([160, 280, 400, 520, 640].some((line) => Math.abs(y - line) < .25)) return [255, 240, 0];
    if (Math.abs(x - 275) < .25 && y > 40 && y < 160) return [20, 20, 20];
    if ([70, 92, 114, 136].some((line) => Math.abs(y - line) < .25)) return [20, 20, 20];
    return x > 275 && y < 70 ? [140, 205, 90] : [255, 255, 255];
  };
  const page = { view: [0, 0, 595, 810] };
  const te = scheduleFromPage(page, items, sample, 'К-ТЭ-19-1')[0].pairs;
  const ii = scheduleFromPage(page, items, sample, 'К-ИИ-19')[0].pairs;
  assert.deepEqual(te.map(({ subject, room }) => [subject, room]), left.map(([subject, , room]) => [subject, room]));
  assert.deepEqual(ii.map(({ subject, room }) => [subject, room]), right.map(([subject, , room]) => [subject.replace('9.00 ', ''), room]));
  assert.equal(ii[0].time, '09:00');
  assert.equal(ii[0].remote, false);
  assert.ok([...te, ...ii].every(({ teacher }) => !/ауд|каб/i.test(teacher)));
  // PDF.js browser canvas can render a horizontal rule too faintly to sample;
  // the fallback must still keep the room line inside its own time slot.
  const faintRules = (x, y) => [70, 92, 114, 136].some((line) => Math.abs(y - line) < .25)
    ? [255, 255, 255] : sample(x, y);
  assert.deepEqual(scheduleFromPage(page, items, faintRules, 'К-ТЭ-19-1')[0].pairs
    .map(({ subject, room }) => [subject, room]), left.map(([subject, , room]) => [subject, room]));
});

test('семестры и три колонки объединённой таблицы различаются', () => {
  const t = (str, x, y, width = 80) => ({ str, x, y, width });
  const text = [t('К-ИСП-21 / К-ИСП-39-1, К-ИСП-39-2', 216, 248),
    t('ЭКЗАМЕНЫ', 117, 281, 72), t('ДИФФЕРЕНЦИРОВАННЫЕ', 238, 274, 161),
    t('ЗАЧЕТЫ', 463, 281, 52), t('3/', 293, 302, 9), t('5 семестр', 303, 302, 51),
    t('Численные методы (Э)', 85, 316), t('Общие компетенции', 232, 316),
    t('профессионала (ДЗ)', 232, 330), t('Физическая культура (З)', 417, 316),
    t('4/', 293, 457, 9), t('6 семестр', 303, 457, 51),
    t('Основы философии (ДЗ)', 232, 471), t('Физическая культура (З)', 417, 471)];
  const result = parseSessionPage(text, 'К-ИСП-39-1', 'college', 840);
  assert.equal(result?.verified, true);
  assert.deepEqual(result?.items.map(({ semester, kind, subject }) => [semester, kind, subject]), [
    [5, 'Экзамен', 'Численные методы'],
    [5, 'Дифференцированный зачёт', 'Общие компетенции профессионала'],
    [5, 'Зачёт', 'Физическая культура'],
    [6, 'Дифференцированный зачёт', 'Основы философии'],
    [6, 'Зачёт', 'Физическая культура'],
  ]);
});
