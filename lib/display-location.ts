/** Краткая подпись площадки в интерфейсе; исходное значение остаётся в расписании. */
export function displayLessonLocation(room: string): string {
  return /(?:^|[\s,])стадион\s+Локомотив(?=$|[\s,.;])/iu.test(room) ? 'Локомотив' : room;
}
