import { supabase } from '@/lib/supabase';
import { ShoppingItem, Consumable } from '@/types';

export async function addShopping(userId: string, data: Record<string, unknown>): Promise<string> {
  const items = data.items as Array<{ item: string; quantity?: string }>;
  if (!items?.length) return '追加する商品名を教えてください。';

  const rows = items.map((i) => ({
    user_id: userId,
    item: i.item,
    quantity: i.quantity ?? null,
    checked: false,
  }));

  const { error } = await supabase.from('shopping_list').insert(rows);
  if (error) throw error;

  const list = items.map((i) => `・${i.item}${i.quantity ? ` (${i.quantity})` : ''}`).join('\n');
  return `🛒 買い物リストに追加しました！\n\n${list}`;
}

export async function getShopping(userId: string): Promise<string> {
  const { data: items, error } = await supabase
    .from('shopping_list')
    .select('*')
    .eq('user_id', userId)
    .order('checked', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;
  if (!items?.length) return '🛒 買い物リストは空です。\n\n「牛乳と卵を買い物リストに追加」などで追加できます！';

  const list = (items as ShoppingItem[])
    .map((i) => {
      const icon = i.checked ? '✅' : '⬜';
      return `${icon} ${i.item}${i.quantity ? ` (${i.quantity})` : ''}`;
    })
    .join('\n');

  const unchecked = (items as ShoppingItem[]).filter((i) => !i.checked).length;
  return `🛒 買い物リスト（未購入: ${unchecked}件）\n\n${list}`;
}

export async function deleteShopping(userId: string, data: Record<string, unknown>): Promise<string> {
  if (!data.item) return '削除する商品名を教えてください。';

  const { data: items, error } = await supabase
    .from('shopping_list')
    .select('*')
    .eq('user_id', userId)
    .ilike('item', `%${data.item}%`)
    .limit(1);

  if (error) throw error;
  if (!items?.length) return `「${data.item}」がリストに見つかりませんでした。`;

  const item = items[0] as ShoppingItem;
  await supabase.from('shopping_list').delete().eq('id', item.id);
  return `🗑️ 「${item.item}」を買い物リストから削除しました。`;
}

export async function completeShopping(userId: string, data: Record<string, unknown>): Promise<string> {
  if (!data.item) return '購入済みにする商品名を教えてください。';

  const { data: items, error } = await supabase
    .from('shopping_list')
    .select('*')
    .eq('user_id', userId)
    .eq('checked', false)
    .ilike('item', `%${data.item}%`)
    .limit(1);

  if (error) throw error;
  if (!items?.length) return `「${data.item}」が未購入リストに見つかりませんでした。`;

  const item = items[0] as ShoppingItem;
  await supabase.from('shopping_list').update({ checked: true }).eq('id', item.id);
  return `✅ 「${item.item}」を購入済みにしました！`;
}

export async function addConsumable(userId: string, data: Record<string, unknown>): Promise<string> {
  if (!data.name) return '消耗品名を教えてください。';

  const reminderDays = Number(data.reminder_days) || 30;

  const { error } = await supabase.from('consumables').insert({
    user_id: userId,
    name: data.name,
    reminder_days: reminderDays,
    last_purchase_date: null,
  });

  if (error) throw error;
  return `🗂️ 消耗品を登録しました！\n\n・${data.name}\n・補充リマインド: ${reminderDays}日ごと\n\n「${data.name}を補充した」と送ると購入日を更新できます！`;
}

export async function getConsumables(userId: string): Promise<string> {
  const { data: items, error } = await supabase
    .from('consumables')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  if (!items?.length) return '🗂️ 消耗品リストは空です。\n\n「シャンプー 補充リマインド30日」などで登録できます！';

  const today = new Date();
  const list = (items as Consumable[])
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
