import test from 'node:test';
import assert from 'node:assert/strict';
import { rowBoundary, splitLesson } from '../lib/pdf-data.ts';
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
