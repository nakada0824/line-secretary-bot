import { supabase } from '@/lib/supabase';
import { Memo, Template } from '@/types';

export async function addMemo(userId: string, data: Record<string, unknown>): Promise<string> {
  if (!data.content) return 'メモの内容を教えてください。';

  const { error } = await supabase.from('memos').insert({
    user_id: userId,
    content: data.content,
    tags: data.tags ?? [],
  });

  if (error) throw error;
  return `📝 メモを保存しました！\n\n「${data.content}」`;
}

export async function getMemo(userId: string, data: Record<string, unknown>): Promise<string> {
  let query = supabase
    .from('memos')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (data.query) {
    query = query.ilike('content', `%${data.query}%`);
  }

  const { data: memos, error } = await query;
  if (error) throw error;
  if (!memos?.length) {
    return data.query
      ? `「${data.query}」に関するメモが見つかりませんでした。`
      : '📝 メモはまだありません。\n\n「〇〇をメモ」などで保存できます！';
  }

  const list = (memos as Memo[])
    .map((m) => {
      const date = new Date(m.created_at).toLocaleDateString('ja-JP', {
        month: 'numeric',
        day: 'numeric',
        timeZone: 'Asia/Tokyo',
      });
      return `・[${date}] ${m.content}`;
    })
    .join('\n');

  return `📝 メモ一覧${data.query ? `（「${data.query}」の検索結果）` : ''}\n\n${list}`;
}

export async function getTemplate(userId: string, data: Record<string, unknown>): Promise<string> {
  if (!data.name) return '呼び出す定型文名を教えてください。';

  const { data: templates, error } = await supabase
    .from('templates')
    .select('*')
    .eq('user_id', userId)
    .ilike('name', `%${data.name}%`)
    .limit(1);

  if (error) throw error;
  if (!templates?.length) {
    return `「${data.name}」という定型文が見つかりませんでした。\n\n定型文を登録するには「〇〇という定型文を登録：内容」とメモしてください。`;
  }

  const template = templates[0] as Template;
  return `📋 定型文「${template.name}」\n\n${template.content}`;
}
