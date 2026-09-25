import { neon, types, type NeonQueryFunction } from '@neondatabase/serverless';
import type { ScannedSchedule, App } from '@/types';

// Supabase時代と同じく日付・日時は文字列で返す
// DATE → 'YYYY-MM-DD'、TIMESTAMPTZ → ISO 8601 文字列
const DATE_OID = 1082;
const TIMESTAMPTZ_OID = 1184;
const parseTimestamptz = types.getTypeParser(TIMESTAMPTZ_OID);
const typeParsers = {
  getTypeParser: ((oid: number, format?: 'text' | 'binary') => {
    if (oid === DATE_OID) return (v: string) => v;
    if (oid === TIMESTAMPTZ_OID) return (v: string) => new Date(parseTimestamptz(v)).toISOString();
    return types.getTypeParser(oid, format);
  }) as typeof types.getTypeParser,
};

let client: NeonQueryFunction<false, false> | null = null;

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  client ??= neon(process.env.DATABASE_URL!);
  return (await client.query(text, params, { types: typeParsers })) as T[];
}

export async function upsertUser(userId: string): Promise<void> {
  try {
    const existing = await query('SELECT user_id FROM users WHERE user_id = $1', [userId]);

    if (!existing.length) {
      const profile = await getLineProfile(userId);
      await query(
        `INSERT INTO users (user_id, display_name, picture_url, location)
         VALUES ($1, $2, $3, 'Tokyo') ON CONFLICT (user_id) DO NOTHING`,
        [userId, profile?.displayName ?? 'ユーザー', profile?.pictureUrl ?? null]
      );
    }
  } catch (e) {
    // テーブル未作成など初期化前でも処理を続行する
    console.error('[upsertUser error]', e);
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
  limit = 5
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  try {
    const data = await query<{ role: 'user' | 'assistant'; content: string }>(
      `SELECT role, content FROM conversations
       WHERE user_id = $1 AND role IN ('user', 'assistant')
       ORDER BY created_at DESC LIMIT $2`,
      [userId, limit * 2]
    );
    return data.reverse();
  } catch {
    return [];
  }
}

export async function saveConversation(
  userId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<void> {
  try {
    await query('INSERT INTO conversations (user_id, role, content) VALUES ($1, $2, $3)', [
      userId,
      role,
      content,
    ]);

    // 新しい50件だけ残す
    await query(
      `DELETE FROM conversations WHERE id IN (
         SELECT id FROM conversations WHERE user_id = $1
         ORDER BY created_at DESC OFFSET 50
       )`,
      [userId]
    );
  } catch (e) {
    console.error('[saveConversation error]', e);
  }
}

export async function getAllUsers(): Promise<
  Array<{ user_id: string; display_name: string; location: string }>
> {
  return query('SELECT user_id, display_name, location FROM users');
}

export async function getUserDisplayName(userId: string): Promise<string> {
  try {
    const rows = await query<{ display_name: string }>(
      'SELECT display_name FROM users WHERE user_id = $1',
      [userId]
    );
    return rows[0]?.display_name ?? 'ユーザー';
  } catch {
    return 'ユーザー';
  }
}

export async function getUser(
  userId: string
): Promise<{ display_name: string; location: string }> {
  try {
    const rows = await query<{ display_name: string; location: string }>(
      'SELECT display_name, location FROM users WHERE user_id = $1',
      [userId]
    );
    const row = rows[0];
    return { display_name: row?.display_name ?? 'ユーザー', location: row?.location ?? 'Tokyo' };
  } catch {
    return { display_name: 'ユーザー', location: 'Tokyo' };
  }
}

// ── 画像スキャン保留スケジュール ──────────────────────────────────────────────

export async function savePendingScan(userId: string, schedules: ScannedSchedule[]): Promise<void> {
  await clearPendingScan(userId);
  await query(
    `INSERT INTO conversations (user_id, role, content) VALUES ($1, 'pending_scan', $2)`,
    [userId, JSON.stringify(schedules)]
  );
}

export async function getPendingScan(userId: string): Promise<ScannedSchedule[] | null> {
  const data = await query<{ content: string }>(
    `SELECT content FROM conversations
     WHERE user_id = $1 AND role = 'pending_scan'
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  if (!data.length) return null;
  try {
    return JSON.parse(data[0].content) as ScannedSchedule[];
  } catch {
    return null;
  }
}

export async function clearPendingScan(userId: string): Promise<void> {
  await query(`DELETE FROM conversations WHERE user_id = $1 AND role = 'pending_scan'`, [userId]);
}

// ── アプリ登録 ─────────────────────────────────────────────────────────────────

export async function getApps(userId: string): Promise<App[]> {
  return query<App>('SELECT * FROM apps WHERE user_id = $1 ORDER BY created_at ASC', [userId]);
}

export async function findAppByKeyword(userId: string, message: string): Promise<App | null> {
  try {
    const apps = await getApps(userId);
    const lower = message.toLowerCase();
    for (const app of apps) {
      for (const kw of (app.keywords ?? [])) {
        if (kw && lower.includes(kw.toLowerCase())) return app;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function insertApp(
  userId: string,
  name: string,
  url: string,
  keywords: string[]
): Promise<{ error: string | null }> {
  try {
    await query('INSERT INTO apps (user_id, name, url, keywords) VALUES ($1, $2, $3, $4)', [
      userId,
      name,
      url,
      keywords,
    ]);
    return { error: null };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

async function findAppByName(userId: string, query_: string) {
  const rows = await query<{ id: string; name: string }>(
    `SELECT id, name FROM apps WHERE user_id = $1 AND name ILIKE $2 LIMIT 1`,
    [userId, `%${query_}%`]
  );
  return rows[0] ?? null;
}

export async function deleteAppByName(
  userId: string,
  query_: string
): Promise<{ deleted: string | null; error: string | null }> {
  const target = await findAppByName(userId, query_);
  if (!target) return { deleted: null, error: 'not_found' };
  try {
    await query('DELETE FROM apps WHERE id = $1', [target.id]);
    return { deleted: target.name, error: null };
  } catch (e) {
    return { deleted: null, error: errorMessage(e) };
  }
}

export async function updateAppByName(
  userId: string,
  query_: string,
  updates: { url?: string; keywords?: string[] }
): Promise<{ updated: string | null; error: string | null }> {
  const target = await findAppByName(userId, query_);
  if (!target) return { updated: null, error: 'not_found' };
  try {
    await query(
      `UPDATE apps SET url = COALESCE($2, url), keywords = COALESCE($3, keywords) WHERE id = $1`,
      [target.id, updates.url ?? null, updates.keywords ?? null]
    );
    return { updated: target.name, error: null };
  } catch (e) {
    return { updated: null, error: errorMessage(e) };
  }
}

// ── 確認待ちの操作（予定の登録先の聞き返し・変更/削除の確認）───────────────────
// 15分以内の返事だけ受け付ける。古いものは無視する

const PENDING_ACTION_TTL = "15 minutes";

export async function savePendingAction(userId: string, action: unknown): Promise<void> {
  await clearPendingAction(userId);
  await query(
    `INSERT INTO conversations (user_id, role, content) VALUES ($1, 'pending_action', $2)`,
    [userId, JSON.stringify(action)]
  );
}

export async function getPendingAction<T>(userId: string): Promise<T | null> {
  const rows = await query<{ content: string }>(
    `SELECT content FROM conversations
     WHERE user_id = $1 AND role = 'pending_action'
       AND created_at > NOW() - INTERVAL '${PENDING_ACTION_TTL}'
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  if (!rows.length) return null;
  try {
    return JSON.parse(rows[0].content) as T;
  } catch {
    return null;
  }
}

export async function clearPendingAction(userId: string): Promise<void> {
  await query(`DELETE FROM conversations WHERE user_id = $1 AND role = 'pending_action'`, [userId]);
}

// ── iCloud 予定の LINE リマインド送信済み記録 ────────────────────────────────

// まだ送っていなければ記録して true。同時実行でも片方だけが true になる
export async function claimEventReminder(eventKey: string, kind: '1h' | '30m'): Promise<boolean> {
  const rows = await query(
    `INSERT INTO event_reminders (event_key, kind) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING event_key`,
    [eventKey, kind]
  );
  return rows.length > 0;
}

export async function cleanupEventReminders(): Promise<void> {
  await query(`DELETE FROM event_reminders WHERE created_at < NOW() - INTERVAL '7 days'`);
}
