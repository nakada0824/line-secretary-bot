// 日本時間（JST）の日付計算。サーバー（Vercel）は UTC で動くので、
// setHours などローカル時刻 API に頼らず +09:00 を明示して組み立てる。

const JST_OFFSET = '+09:00';

// 基準時刻の JST での日付（YYYY-MM-DD）
export function jstDateString(base: Date = new Date(), offsetDays = 0): string {
  const d = new Date(base.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
}

// JST の その日 0:00 〜 翌日 0:00（end は含まない）
export function jstDayRange(base: Date = new Date(), offsetDays = 0): { start: Date; end: Date } {
  const start = new Date(`${jstDateString(base, offsetDays)}T00:00:00${JST_OFFSET}`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

// JST の曜日（0=日 … 6=土）
export function jstWeekday(base: Date = new Date()): number {
  return new Date(`${jstDateString(base)}T12:00:00${JST_OFFSET}`).getUTCDay();
}
