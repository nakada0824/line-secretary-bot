import { query } from '@/lib/db';
import { Task } from '@/types';

const PRIORITY: Record<number, string> = { 1: '最低', 2: '低', 3: '中', 4: '高', 5: '最高' };
const ENCOURAGE = [
  '🎉 タスク完了！素晴らしい！',
  '✨ やったね！お疲れさまでした！',
  '🌟 完璧！継続は力なり！',
  '💪 さすが！どんどん進んでますね！',
];

export async function addTask(userId: string, data: Record<string, unknown>): Promise<string> {
  if (!data.title) return 'タスク名を教えてください。';

  const priority = Number(data.priority) || 3;

  await query(
    'INSERT INTO tasks (user_id, title, description, priority, deadline) VALUES ($1, $2, $3, $4, $5)',
    [userId, data.title, data.description ?? null, priority, data.deadline ?? null]
  );

  let reply = `✅ タスクを追加しました！\n\n📌 ${data.title}\n⚡ 優先度: ${PRIORITY[priority]}`;
  if (data.deadline) {
    const dl = new Date(data.deadline as string).toLocaleDateString('ja-JP', {
      month: 'long',
      day: 'numeric',
      weekday: 'short',
      timeZone: 'Asia/Tokyo',
    });
    reply += `\n📆 締め切り: ${dl}`;
  }
  return reply;
}

export async function getTasks(userId: string, data: Record<string, unknown>): Promise<string> {
  // null = 完了・未完了の両方
  const completed = data.filter === 'completed' ? true : data.filter === 'all' ? null : false;
  const tasks = await query<Task>(
    `SELECT * FROM tasks
     WHERE user_id = $1 AND ($2::boolean IS NULL OR completed = $2)
     ORDER BY priority DESC, deadline ASC NULLS LAST
     LIMIT 20`,
    [userId, completed]
  );

  if (!tasks.length) return '📋 タスクはありません。\n\n「〇〇のタスク追加 優先度4 締め切り来週金曜」などで追加できます！';

  const list = tasks
    .map((t) => {
      const icon = t.completed ? '✅' : '⬜';
      const p = PRIORITY[t.priority] ?? '中';
      let line = `${icon} ${t.title} [${p}]`;
      if (t.deadline && !t.completed) {
        const dl = new Date(t.deadline).toLocaleDateString('ja-JP', {
          month: 'numeric',
          day: 'numeric',
          timeZone: 'Asia/Tokyo',
        });
        line += ` 📆${dl}`;
      }
      return line;
    })
    .join('\n');

  const label = data.filter === 'completed' ? '完了済み' : data.filter === 'all' ? '全' : '未完了';
  return `📋 ${label}タスク（${tasks.length}件）\n\n${list}`;
}

export async function completeTask(userId: string, data: Record<string, unknown>): Promise<string> {
  if (!data.query) return '完了するタスク名を教えてください。';

  const tasks = await query<Task>(
    'SELECT * FROM tasks WHERE user_id = $1 AND completed = false AND title ILIKE $2 LIMIT 1',
    [userId, `%${data.query}%`]
  );

  if (!tasks.length) return `「${data.query}」に該当する未完了タスクが見つかりませんでした。`;

  const task = tasks[0];
  await query('UPDATE tasks SET completed = true, completed_at = NOW() WHERE id = $1', [task.id]);

  const msg = ENCOURAGE[Math.floor(Math.random() * ENCOURAGE.length)];
  return `${msg}\n\n「${task.title}」を達成しました！`;
}

export async function deleteTask(userId: string, data: Record<string, unknown>): Promise<string> {
  if (!data.query) return '削除するタスク名を教えてください。';

  const tasks = await query<Task>(
    'SELECT * FROM tasks WHERE user_id = $1 AND title ILIKE $2 LIMIT 1',
    [userId, `%${data.query}%`]
  );

  if (!tasks.length) return `「${data.query}」に該当するタスクが見つかりませんでした。`;

  const task = tasks[0];
  await query('DELETE FROM tasks WHERE id = $1', [task.id]);
  return `🗑️ タスクを削除しました\n\n「${task.title}」`;
}
