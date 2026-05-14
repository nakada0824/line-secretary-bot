import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function upsertUser(userId: string): Promise<void> {
  const { data: existing } = await supabase
    .from('users')
    .select('user_id')
    .eq('user_id', userId)
    .single();

  if (!existing) {
    const profile = await getLineProfile(userId);
    await supabase.from('users').insert({
      user_id: userId,
      display_name: profile?.displayName ?? 'ユーザー',
      picture_url: profile?.pictureUrl,
      location: 'Tokyo',
    });
  }
}

async function getLineProfile(userId: string) {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function getConversationHistory(
  userId: string,
  limit = 10
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const { data } = await supabase
    .from('conversations')
    .select('role, content')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit * 2);

  return ((data ?? []) as Array<{ role: string; content: string }>)
    .reverse()
    .map((c) => ({ role: c.role as 'user' | 'assistant', content: c.content }));
}

export async function saveConversation(
  userId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<void> {
  await supabase.from('conversations').insert({ user_id: userId, role, content });

  // Keep only last 50 messages per user
  const { data: old } = await supabase
    .from('conversations')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(50, 9999);

  if (old && old.length > 0) {
    const ids = (old as Array<{ id: string }>).map((r) => r.id);
    await supabase.from('conversations').delete().in('id', ids);
  }
}

export async function getAllUsers(): Promise<Array<{ user_id: string; display_name: string; location: string }>> {
  const { data } = await supabase.from('users').select('user_id, display_name, location');
  return (data ?? []) as Array<{ user_id: string; display_name: string; location: string }>;
}

export async function getUserDisplayName(userId: string): Promise<string> {
  const { data } = await supabase
    .from('users')
    .select('display_name')
    .eq('user_id', userId)
    .single();
  return (data as { display_name: string } | null)?.display_name ?? 'ユーザー';
}

export async function getUser(
  userId: string
): Promise<{ display_name: string; location: string }> {
  const { data } = await supabase
    .from('users')
    .select('display_name, location')
    .eq('user_id', userId)
    .single();
  const row = data as { display_name: string; location: string } | null;
  return { display_name: row?.display_name ?? 'ユーザー', location: row?.location ?? 'Tokyo' };
}
