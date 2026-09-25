// iPhone のカレンダーアプリを開くリンク。
// secretary-app の /open-calendar が calshow: に飛ばす（LINE 内ブラウザでは開けないので Safari で開かせる）
const BASE = 'https://secretary-app-bay.vercel.app';

export function iphoneCalendarUrl(date?: string | Date): string {
  const params = new URLSearchParams({ openExternalBrowser: '1' });
  if (date) {
    const d = typeof date === 'string' ? new Date(date) : date;
    params.set('d', d.toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' }));
  }
  return `${BASE}/open-calendar?${params}`;
}
