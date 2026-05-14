import { supabase } from '@/lib/supabase';
import { Schedule } from '@/types';

function jstDate(dateStr: string, opts: Intl.DateTimeFormatOptions) {
  return new Date(dateStr).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', ...opts });
}

export async function addSchedule(userId: string, data: Record<string, unknown>): Promise<string> {
  if (!data.title || !data.start_time) return '予定のタイトルと日時を教えてください。';

  const { error } = await supabase.from('schedules').insert({
    user_id: userId,
    title: data.title,
    description: data.description ?? null,
    start_time: data.start_time,
    end_time: data.end_time ?? null,
    location: data.location ?? null,
    reminded_1h: false,
    reminded_30m: false,
  });

  if (error) throw error;

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

  const { data: schedules, error } = await supabase
    .from('schedules')
    .select('*')
    .eq('user_id', userId)
    .gte('start_time', start.toISOString())
    .lte('start_time', end.toISOString())
    .order('start_time', { ascending: true });

  if (error) throw error;
  if (!schedules?.length) return `📅 ${label}の予定はありません。\n\n「明日14時に会議」などと送ると追加できます！`;

  const list = (schedules as Schedule[])
    .map((s) => {
      const t = jstDate(s.start_time, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `・${t} ${s.title}${s.location ? ` 📍${s.location}` : ''}`;
    })
    .join('\n');

  return `📅 ${label}の予定（${schedules.length}件）\n\n${list}`;
}

export async function deleteSchedule(userId: string, data: Record<string, unknown>): Promise<string> {
  if (!data.query) return '削除する予定名を教えてください。';

  const { data: schedules, error } = await supabase
    .from('schedules')
    .select('*')
    .eq('user_id', userId)
    .ilike('title', `%${data.query}%`)
    .order('start_time', { ascending: true })
    .limit(1);

  if (error) throw error;
  if (!schedules?.length) return `「${data.query}」に該当する予定が見つかりませんでした。`;

  const s = schedules[0] as Schedule;
  await supabase.from('schedules').delete().eq('id', s.id);

  return `🗑️ 予定を削除しました\n\n「${s.title}」`;
}
