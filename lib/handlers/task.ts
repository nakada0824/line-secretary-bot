import { supabase } from '@/lib/supabase';
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

  const { error } = await supabase.from('tasks').insert({
    user_id: userId,
    title: data.title,
    description: data.description ?? null,
    priority,
    deadline: data.deadline ?? null,
    completed: false,
    reminded_week: false,
    reminded_3days: false,
    reminded_1day: false,
  });

  if (error) throw error;

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
  let query = supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .order('priority', { ascending: false })
    .order('deadline', { ascending: true, nullsFirst: false });

  if (data.filter === 'completed') {
    query = query.eq('completed', true);
  } else if (data.filter !== 'all') {
    query = query.eq('completed', false);
  }

  const { data: tasks, error } = await query.limit(20);
  if (error) throw error;
  if (!tasks?.length) return '📋 タスクはありません。\n\n「〇〇のタスク追加 優先度4 締め切り来週金曜」などで追加できます！';

  const list = (tasks as Task[])
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

  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .eq('completed', false)
    .ilike('title', `%${data.query}%`)
    .limit(1);

  if (error) throw error;
  if (!tasks?.length) return `「${data.query}」に該当する未完了タスクが見つかりませんでした。`;

  const task = tasks[0] as Task;
  await supabase
    .from('tasks')
    .update({ completed: true, completed_at: new Date().toISOString() })
    .eq('id', task.id);

  const msg = ENCOURAGE[Math.floor(Math.random() * ENCOURAGE.length)];
  return `${msg}\n\n「${task.title}」を達成しました！`;
}

export async function deleteTask(userId: string, data: Record<string, unknown>): Promise<string> {
  if (!data.query) return '削除するタスク名を教えてください。';

  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .ilike('title', `%${data.query}%`)
    .limit(1);

  if (error) throw error;
  if (!tasks?.length) return `「${data.query}」に該当するタスクが見つかりませんでした。`;

  const task = tasks[0] as Task;
  await supabase.from('tasks').delete().eq('id', task.id);
  return `🗑️ タスクを削除しました\n\n「${task.title}」`;
}
