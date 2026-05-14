import { supabase } from '@/lib/supabase';
import { Habit } from '@/types';

function todayJST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' }); // YYYY-MM-DD
}

function yesterdayJST(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
}

export async function logHabit(userId: string, data: Record<string, unknown>): Promise<string> {
  if (!data.habit_name) return '記録する習慣名を教えてください。';

  const { data: habits } = await supabase
    .from('habits')
    .select('*')
    .eq('user_id', userId)
    .ilike('name', `%${data.habit_name}%`)
    .limit(1);

  let habit: Habit;
  const today = todayJST();

  if (!habits?.length) {
    const { data: newHabit, error } = await supabase
      .from('habits')
      .insert({ user_id: userId, name: data.habit_name, streak: 0, last_logged: null })
      .select()
      .single();
    if (error) throw error;
    habit = newHabit as Habit;
  } else {
    habit = habits[0] as Habit;
  }

  if (habit.last_logged === today) {
    return `${habit.name}は今日すでに記録済みです！ 🎯\n連続${habit.streak}日継続中！`;
  }

  const newStreak = habit.last_logged === yesterdayJST() ? habit.streak + 1 : 1;

  await supabase.from('habits').update({ streak: newStreak, last_logged: today }).eq('id', habit.id);
  await supabase.from('habit_logs').insert({ habit_id: habit.id, user_id: userId });

  let msg = `🎯 「${habit.name}」を記録しました！\n連続${newStreak}日目！`;
  if (newStreak >= 100) msg += '\n\n🏆 100日達成！本当にすごい！あなたは最高です！';
  else if (newStreak >= 30) msg += '\n\n🌟 30日継続！素晴らしい意志の強さですね！';
  else if (newStreak >= 7) msg += '\n\n✨ 1週間継続！絶好調ですね！';
  else if (newStreak === 1 && habit.streak > 1) msg += '\n\n💪 新しいスタートです！また頑張りましょう！';
  else msg += '\n\n続けて偉い！その調子！';

  return msg;
}

export async function getHabits(userId: string): Promise<string> {
  const { data: habits, error } = await supabase
    .from('habits')
    .select('*')
    .eq('user_id', userId)
    .order('streak', { ascending: false });

  if (error) throw error;
  if (!habits?.length)
    return '🎯 習慣はまだ登録されていません。\n\n「筋トレした」「読書した」などと送ると自動で記録できます！';

  const today = todayJST();
  const list = (habits as Habit[])
    .map((h) => {
      const loggedToday = h.last_logged === today;
      const icon = loggedToday ? '✅' : '⬜';
      return `${icon} ${h.name}: ${h.streak}日連続`;
    })
    .join('\n');

  return `🎯 習慣トラッカー\n\n${list}`;
}
