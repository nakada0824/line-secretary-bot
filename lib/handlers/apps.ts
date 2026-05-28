import { getApps, insertApp, deleteAppByName, updateAppByName } from '@/lib/supabase';

export async function addApp(userId: string, data: Record<string, unknown>): Promise<string> {
  const name = String(data.name ?? '').trim();
  const url  = String(data.url  ?? '').trim();
  const keywords = Array.isArray(data.keywords)
    ? (data.keywords as string[]).map((k) => String(k).trim()).filter(Boolean)
    : [];

  if (!name) return 'アプリ名を教えてください。';
  if (!url || !/^https?:\/\//.test(url)) return 'URLを正しく教えてください（https://...）。';

  const { error } = await insertApp(userId, name, url, keywords);
  if (error) return 'アプリの登録に失敗しました🙇 もう一度お試しください。';

  const kwText = keywords.length > 0 ? `\nキーワード: ${keywords.join('、')}` : '';
  return `✅ ${name}を登録しました！${kwText}\n\nキーワードを送るとURLが届きます😊`;
}

export async function listApps(userId: string): Promise<string> {
  const apps = await getApps(userId);
  if (!apps.length) {
    return [
      '登録されているアプリはありません。',
      '',
      '「〇〇を登録して。URLはhttps://... キーワードは△△」で追加できます！',
    ].join('\n');
  }

  const lines = ['📱 登録アプリ一覧', ''];
  for (const app of apps) {
    const kw = app.keywords?.length ? ` [${app.keywords.join('/')}]` : '';
    lines.push(`・${app.name}${kw}`);
    lines.push(`  ${app.url}`);
  }
  return lines.join('\n');
}

export async function deleteApp(userId: string, data: Record<string, unknown>): Promise<string> {
  const query = String(data.query ?? data.name ?? '').trim();
  if (!query) return '削除するアプリ名を教えてください。';

  const { deleted, error } = await deleteAppByName(userId, query);
  if (error === 'not_found') return `「${query}」というアプリが見つかりませんでした。`;
  if (error) return '削除に失敗しました🙇 もう一度お試しください。';
  return `✅ ${deleted}を削除しました。`;
}

export async function updateApp(userId: string, data: Record<string, unknown>): Promise<string> {
  const query = String(data.query ?? data.name ?? '').trim();
  if (!query) return '更新するアプリ名を教えてください。';

  const updates: { url?: string; keywords?: string[] } = {};
  if (typeof data.url === 'string' && data.url) updates.url = data.url;
  if (Array.isArray(data.keywords)) {
    updates.keywords = (data.keywords as string[]).map((k) => String(k).trim()).filter(Boolean);
  }
  if (Object.keys(updates).length === 0) return '更新するURLまたはキーワードを教えてください。';

  const { updated, error } = await updateAppByName(userId, query, updates);
  if (error === 'not_found') return `「${query}」というアプリが見つかりませんでした。`;
  if (error) return '更新に失敗しました🙇 もう一度お試しください。';
  return `✅ ${updated}を更新しました。`;
}
