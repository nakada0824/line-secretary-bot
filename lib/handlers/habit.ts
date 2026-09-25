import { query } from '@/lib/db';
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

  const habits = await query<Habit>(
    'SELECT * FROM habits WHERE user_id = $1 AND name ILIKE $2 LIMIT 1',
    [userId, `%${data.habit_name}%`]
  );

  let habit: Habit;
  const today = todayJST();

  if (!habits.length) {
    const [newHabit] = await query<Habit>(
      'INSERT INTO habits (user_id, name, streak) VALUES ($1, $2, 0) RETURNING *',
      [userId, data.habit_name]
    );
    habit = newHabit;
  } else {
    habit = habits[0];
  }

  if (habit.last_logged === today) {
    return `${habit.name}は今日すでに記録済みです！ 🎯\n連続${habit.streak}日継続中！`;
  }

  const newStreak = habit.last_logged === yesterdayJST() ? habit.streak + 1 : 1;

  await query('UPDATE habits SET streak = $2, last_logged = $3 WHERE id = $1', [habit.id, newStreak, today]);
  await query('INSERT INTO habit_logs (habit_id, user_id) VALUES ($1, $2)', [habit.id, userId]);

  let msg = `🎯 「${habit.name}」を記録しました！\n連続${newStreak}日目！`;
  if (newStreak >= 100) msg += '\n\n🏆 100日達成！本当にすごい！あなたは最高です！';
  else if (newStreak >= 30) msg += '\n\n🌟 30日継続！素晴らしい意志の強さですね！';
  else if (newStreak >= 7) msg += '\n\n✨ 1週間継続！絶好調ですね！';
  else if (newStreak === 1 && habit.streak > 1) msg += '\n\n💪 新しいスタートです！また頑張りましょう！';
  else msg += '\n\n続けて偉い！その調子！';

  return msg;
}

export async function getHabits(userId: string): Promise<string> {
  const habits = await query<Habit>(
    'SELECT * FROM habits WHERE user_id = $1 ORDER BY streak DESC',
    [userId]
  );

  if (!habits.length)
    return '🎯 習慣はまだ登録されていません。\n\n「筋トレした」「読書した」などと送ると自動で記録できます！';

  const today = todayJST();
  const list = habits
    .map((h) => {
      const loggedToday = h.last_logged === today;
      const icon = loggedToday ? '✅' : '⬜';
      return `${icon} ${h.name}: ${h.streak}日連続`;
    })
    .join('\n');

  return `🎯 習慣トラッカー\n\n${list}`;
}
