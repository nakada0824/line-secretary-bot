import { query } from '@/lib/db';
import { Schedule } from '@/types';

function jstDate(dateStr: string, opts: Intl.DateTimeFormatOptions) {
  return new Date(dateStr).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', ...opts });
}

export async function addSchedule(userId: string, data: Record<string, unknown>): Promise<string> {
  if (!data.title || !data.start_time) return '予定のタイトルと日時を教えてください。';

  await query(
    `INSERT INTO schedules (user_id, title, description, start_time, end_time, location)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, data.title, data.description ?? null, data.start_time, data.end_time ?? null, data.location ?? null]
  );

  const dateStr = jstDate(data.start_time as string, { month: 'long', day: 'numeric', weekday: 'short' });
  const timeStr = jstDate(data.start_time as string, { hour: '2-digit', minute: '2-digit' });

  let reply = `📅 予定を追加しました！\n\n📌 ${data.title}\n🗓 ${dateStr} ${timeStr}`;
  if (data.location) reply += `\n📍 ${data.location}`;
  if (data.description) reply += `\n📝 ${data.description}`;
  return reply;
}

export async function getSchedules(userId: string, data: Record<string, unknown>): Promise<string> {
  const jstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));

  let start: Date;
  let end: Date;
  let label: string;

  if (data.date === 'tomorrow') {
    start = new Date(jstNow);
    start.setDate(start.getDate() + 1);
    start.setHours(0, 0, 0, 0);
    end = new Date(start);
    end.setHours(23, 59, 59, 999);
    label = '明日';
  } else if (data.date === 'week') {
    start = new Date(jstNow);
    start.setHours(0, 0, 0, 0);
    end = new Date(start);
    end.setDate(end.getDate() + 7);
    label = '今後1週間';
  } else {
    start = new Date(jstNow);
    start.setHours(0, 0, 0, 0);
    end = new Date(jstNow);
    end.setHours(23, 59, 59, 999);
    label = '今日';
  }

  const schedules = await query<Schedule>(
    `SELECT * FROM schedules
     WHERE user_id = $1 AND start_time >= $2 AND start_time <= $3
     ORDER BY start_time ASC`,
    [userId, start.toISOString(), end.toISOString()]
  );

  if (!schedules.length) return `📅 ${label}の予定はありません。\n\n「明日14時に会議」などと送ると追加できます！`;

  const list = schedules
    .map((s) => {
      const t = jstDate(s.start_time, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `・${t} ${s.title}${s.location ? ` 📍${s.location}` : ''}`;
    })
    .join('\n');

  return `📅 ${label}の予定（${schedules.length}件）\n\n${list}`;
}

export async function deleteSchedule(userId: string, data: Record<string, unknown>): Promise<string> {
  if (!data.query) return '削除する予定名を教えてください。';

  const schedules = await query<Schedule>(
    `SELECT * FROM schedules WHERE user_id = $1 AND title ILIKE $2
     ORDER BY start_time ASC LIMIT 1`,
    [userId, `%${data.query}%`]
  );

  if (!schedules.length) return `「${data.query}」に該当する予定が見つかりませんでした。`;

  const s = schedules[0];
  await query('DELETE FROM schedules WHERE id = $1', [s.id]);

  return `🗑️ 予定を削除しました\n\n「${s.title}」`;
}
