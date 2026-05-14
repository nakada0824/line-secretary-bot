import { supabase } from '@/lib/supabase';
import { Birthday } from '@/types';

export async function addBirthday(userId: string, data: Record<string, unknown>): Promise<string> {
  if (!data.name || !data.birth_date) return '名前と誕生日を教えてください。\n\n例：「田中さんの誕生日を3月15日で登録」';

  const { error } = await supabase.from('birthdays').insert({
    user_id: userId,
    name: data.name,
    birth_date: data.birth_date,
  });

  if (error) throw error;

  const date = new Date(data.birth_date as string);
  const dateStr = `${date.getMonth() + 1}月${date.getDate()}日`;
  return `🎂 誕生日を登録しました！\n\n・${data.name}さん: ${dateStr}\n\n誕生日の当日と1週間前にリマインドします！`;
}

export async function getBirthdays(userId: string): Promise<string> {
  const { data: birthdays, error } = await supabase
    .from('birthdays')
    .select('*')
    .eq('user_id', userId)
    .order('birth_date', { ascending: true });

  if (error) throw error;
  if (!birthdays?.length)
    return '🎂 誕生日はまだ登録されていません。\n\n「田中さんの誕生日を3月15日で登録」などで追加できます！';

  const today = new Date();
  const list = (birthdays as Birthday[])
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
