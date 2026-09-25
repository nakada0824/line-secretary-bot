import { query } from '@/lib/db';
import { ShoppingItem, Consumable } from '@/types';

export async function addShopping(userId: string, data: Record<string, unknown>): Promise<string> {
  const items = data.items as Array<{ item: string; quantity?: string }>;
  if (!items?.length) return '追加する商品名を教えてください。';

  await query(
    `INSERT INTO shopping_list (user_id, item, quantity)
     SELECT $1, * FROM UNNEST($2::text[], $3::text[])`,
    [userId, items.map((i) => i.item), items.map((i) => i.quantity ?? null)]
  );

  const list = items.map((i) => `・${i.item}${i.quantity ? ` (${i.quantity})` : ''}`).join('\n');
  return `🛒 買い物リストに追加しました！\n\n${list}`;
}

export async function getShopping(userId: string): Promise<string> {
  const items = await query<ShoppingItem>(
    'SELECT * FROM shopping_list WHERE user_id = $1 ORDER BY checked ASC, created_at ASC',
    [userId]
  );

  if (!items.length) return '🛒 買い物リストは空です。\n\n「牛乳と卵を買い物リストに追加」などで追加できます！';

  const list = items
    .map((i) => {
      const icon = i.checked ? '✅' : '⬜';
      return `${icon} ${i.item}${i.quantity ? ` (${i.quantity})` : ''}`;
    })
    .join('\n');

  const unchecked = items.filter((i) => !i.checked).length;
  return `🛒 買い物リスト（未購入: ${unchecked}件）\n\n${list}`;
}

export async function deleteShopping(userId: string, data: Record<string, unknown>): Promise<string> {
  if (!data.item) return '削除する商品名を教えてください。';

  const items = await query<ShoppingItem>(
    'SELECT * FROM shopping_list WHERE user_id = $1 AND item ILIKE $2 LIMIT 1',
    [userId, `%${data.item}%`]
  );

  if (!items.length) return `「${data.item}」がリストに見つかりませんでした。`;

  const item = items[0];
  await query('DELETE FROM shopping_list WHERE id = $1', [item.id]);
  return `🗑️ 「${item.item}」を買い物リストから削除しました。`;
}

export async function completeShopping(userId: string, data: Record<string, unknown>): Promise<string> {
  if (!data.item) return '購入済みにする商品名を教えてください。';

  const items = await query<ShoppingItem>(
    'SELECT * FROM shopping_list WHERE user_id = $1 AND checked = false AND item ILIKE $2 LIMIT 1',
    [userId, `%${data.item}%`]
  );

  if (!items.length) return `「${data.item}」が未購入リストに見つかりませんでした。`;

  const item = items[0];
  await query('UPDATE shopping_list SET checked = true WHERE id = $1', [item.id]);
  return `✅ 「${item.item}」を購入済みにしました！`;
}

export async function markRestock(userId: string, data: Record<string, unknown>): Promise<string> {
  if (!data.name) return '補充が必要な備品名を教えてください。';

  const existing = await query<{ id: string }>(
    'SELECT id FROM consumables WHERE user_id = $1 AND name ILIKE $2 LIMIT 1',
    [userId, String(data.name)]
  );

  if (existing.length) {
    await query('UPDATE consumables SET need_restock = true WHERE id = $1', [existing[0].id]);
  } else {
    await query(
      'INSERT INTO consumables (user_id, name, reminder_days, need_restock) VALUES ($1, $2, 0, true)',
      [userId, data.name]
    );
  }

  const phrases = [
    `了解しました！朝のリマインドでお伝えしますね✨`,
    `わかりました、「${data.name}」を補充リストに入れておきますね😊`,
    `はい！「${data.name}」、朝のレポートでリマインドします。`,
  ];
  return phrases[Math.floor(Math.random() * phrases.length)];
}

export async function completeRestock(userId: string, data: Record<string, unknown>): Promise<string> {
  if (!data.name) return '補充した備品名を教えてください。';

  const items = await query<{ id: string; name: string }>(
    'SELECT id, name FROM consumables WHERE user_id = $1 AND need_restock = true AND name ILIKE $2 LIMIT 1',
    [userId, `%${data.name}%`]
  );

  if (!items.length) {
    return `「${data.name}」は補充リストに見つかりませんでした。`;
  }

  const item = items[0];
  await query(
    'UPDATE consumables SET need_restock = false, last_purchase_date = CURRENT_DATE WHERE id = $1',
    [item.id]
  );

  const phrases = [
    `お疲れさまです！リストから消しておきますね😊`,
    `「${item.name}」購入済みにしました！✅`,
    `了解です、「${item.name}」の補充完了ですね✨`,
  ];
  return phrases[Math.floor(Math.random() * phrases.length)];
}

export async function addConsumable(userId: string, data: Record<string, unknown>): Promise<string> {
  if (!data.name) return '消耗品名を教えてください。';

  const reminderDays = Number(data.reminder_days) || 30;

  await query('INSERT INTO consumables (user_id, name, reminder_days) VALUES ($1, $2, $3)', [
    userId,
    data.name,
    reminderDays,
  ]);
  return `🗂️ 消耗品を登録しました！\n\n・${data.name}\n・補充リマインド: ${reminderDays}日ごと\n\n「${data.name}を補充した」と送ると購入日を更新できます！`;
}

export async function getConsumables(userId: string): Promise<string> {
  const items = await query<Consumable>(
    'SELECT * FROM consumables WHERE user_id = $1 ORDER BY created_at ASC',
    [userId]
  );

  if (!items.length) return '🗂️ 消耗品リストは空です。\n\n「シャンプー 補充リマインド30日」などで登録できます！';

  const today = new Date();
  const list = items
    .map((c) => {
      if (!c.last_purchase_date) return `・${c.name} (未購入)`;
      const last = new Date(c.last_purchase_date);
      const next = new Date(last);
      next.setDate(next.getDate() + c.reminder_days);
      const daysLeft = Math.ceil((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const status = daysLeft <= 0 ? '⚠️ 補充時期' : daysLeft <= 7 ? '🔶 もうすぐ' : '✅';
      return `${status} ${c.name} (次回補充: ${next.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })})`;
    })
    .join('\n');

  return `🗂️ 消耗品リスト\n\n${list}`;
}
