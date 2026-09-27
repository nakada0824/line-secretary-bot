// secretary_status：本体（塾の Mac の Claude Code）と Bot の状態の受け渡し
import { query } from '@/lib/db';

export interface StatusRow<T> {
  value: T;
  updated_at: string;
}

export async function getStatus<T>(key: string): Promise<StatusRow<T> | null> {
  const rows = await query<StatusRow<T>>(
    'SELECT value, updated_at FROM secretary_status WHERE key = $1',
    [key]
  );
  return rows[0] ?? null;
}

export async function setStatus(key: string, value: unknown): Promise<void> {
  await query(
    `INSERT INTO secretary_status (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(value)]
  );
}
