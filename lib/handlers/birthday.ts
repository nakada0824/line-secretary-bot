import { query } from '@/lib/db';
import { Birthday } from '@/types';

export async function addBirthday(userId: string, data: Record<string, unknown>): Promise<string> {
  if (!data.name || !data.birth_date) return '名前と誕生日を教えてください。\n\n例：「田中さんの誕生日を3月15日で登録」';

  await query('INSERT INTO birthdays (user_id, name, birth_date) VALUES ($1, $2, $3)', [
    userId,
    data.name,
    data.birth_date,
  ]);

  const date = new Date(data.birth_date as string);
  const dateStr = `${date.getMonth() + 1}月${date.getDate()}日`;
  return `🎂 誕生日を登録しました！\n\n・${data.name}さん: ${dateStr}\n\n誕生日の当日と1週間前にリマインドします！`;
}

export async function getBirthdays(userId: string): Promise<string> {
  const birthdays = await query<Birthday>(
    'SELECT * FROM birthdays WHERE user_id = $1 ORDER BY birth_date ASC',
    [userId]
  );

  if (!birthdays.length)
    return '🎂 誕生日はまだ登録されていません。\n\n「田中さんの誕生日を3月15日で登録」などで追加できます！';

  const today = new Date();
  const list = birthdays
    .map((b) => {
      const bd = new Date(b.birth_date);
      const thisYear = new Date(today.getFullYear(), bd.getMonth(), bd.getDate());
      if (thisYear < today) thisYear.setFullYear(today.getFullYear() + 1);
      const daysUntil = Math.ceil((thisYear.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const dateStr = `${bd.getMonth() + 1}月${bd.getDate()}日`;
      const status = daysUntil === 0 ? ' 🎉今日！' : daysUntil <= 7 ? ` (あと${daysUntil}日)` : '';
      return `・${b.name}: ${dateStr}${status}`;
    })
    .join('\n');

  return `🎂 誕生日リスト\n\n${list}`;
}
