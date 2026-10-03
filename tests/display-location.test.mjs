import test from 'node:test';
import assert from 'node:assert/strict';
import { displayLessonLocation } from '../lib/display-location.ts';
import { splitLesson } from '../lib/pdf-data.ts';

test('стадион Локомотив в расписании показывается кратко, исходное место сохраняется', () => {
  const source = 'Агибалова 7А, стадион Локомотив баскетбольный зал';
  const pair = splitLesson(`Физическая культура преп Рудакова И.А ${source}`);
  assert.equal(pair?.room, source);
  assert.equal(displayLessonLocation(pair.room), 'Локомотив');
  assert.equal(displayLessonLocation('СТАДИОН ЛОКОМОТИВ'), 'Локомотив');
});

test('другие аудитории и места не меняются', () => {
  assert.equal(displayLessonLocation('521'), '521');
  assert.equal(displayLessonLocation('стадион Динамо'), 'стадион Динамо');
  assert.equal(displayLessonLocation('ул. Локомотивная, 7'), 'ул. Локомотивная, 7');
});
