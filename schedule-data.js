// Roster dòng số 6: Code 4127179 - Phan Thị Thảo Vy.
export const defaultSchedule = {
  '2026-09-26': '18', '2026-09-27': 'eAD', '2026-09-28': 'D', '2026-09-29': 'N', '2026-09-30': '18',
  '2026-10-01': 'D', '2026-10-02': '18', '2026-10-03': 'N', '2026-10-04': 'N', '2026-10-05': '18',
  '2026-10-06': 'D', '2026-10-07': 'N', '2026-10-08': '18', '2026-10-09': 'D', '2026-10-10': 'D',
  '2026-10-11': 'N', '2026-10-12': '9', '2026-10-13': '9', '2026-10-14': 'D', '2026-10-15': 'N',
  '2026-10-16': '9', '2026-10-17': 'N', '2026-10-18': '9', '2026-10-19': 'N', '2026-10-20': '9',
  '2026-10-21': '9', '2026-10-22': 'D', '2026-10-23': 'N', '2026-10-24': 'N', '2026-10-25': '9'
};

export const RECURRING_SCHEDULE_START = '2026-10-26';

export function getRecurringScheduleCode(dateKey) {
  if (typeof dateKey !== 'string' || dateKey < RECURRING_SCHEDULE_START) return null;
  const weekday = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
  return weekday === 0 ? '18' : 'HC';
}

export function getScheduleCode(schedule, dateKey) {
  if (Object.prototype.hasOwnProperty.call(schedule || {}, dateKey)) return schedule[dateKey];
  return getRecurringScheduleCode(dateKey);
}
