import { query } from '@/lib/db';
import { Memo, Template } from '@/types';

export async function addMemo(userId: string, data: Record<string, unknown>): Promise<string> {
  if (!data.content) return 'メモの内容を教えてください。';

  await query('INSERT INTO memos (user_id, content, tags) VALUES ($1, $2, $3)', [
    userId,
    data.content,
    data.tags ?? [],
  ]);
  return `📝 メモを保存しました！\n\n「${data.content}」`;
}

export async function getMemo(userId: string, data: Record<string, unknown>): Promise<string> {
  const memos = await query<Memo>(
    `SELECT * FROM memos
     WHERE user_id = $1 AND ($2::text IS NULL OR content ILIKE $2)
     ORDER BY created_at DESC LIMIT 10`,
    [userId, data.query ? `%${data.query}%` : null]
  );

  if (!memos.length) {
    return data.query
      ? `「${data.query}」に関するメモが見つかりませんでした。`
      : '📝 メモはまだありません。\n\n「〇〇をメモ」などで保存できます！';
  }

  const list = memos
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

  const templates = await query<Template>(
    'SELECT * FROM templates WHERE user_id = $1 AND name ILIKE $2 LIMIT 1',
    [userId, `%${data.name}%`]
  );

  if (!templates.length) {
    return `「${data.name}」という定型文が見つかりませんでした。\n\n定型文を登録するには「〇〇という定型文を登録：内容」とメモしてください。`;
  }

  const template = templates[0];
  return `📋 定型文「${template.name}」\n\n${template.content}`;
}
