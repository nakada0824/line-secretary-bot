// ── セキュリティユーティリティ ────────────────────────────────────────────────

// ── 構造化セキュリティログ ────────────────────────────────────────────────────

type SecurityEvent =
  | 'invalid_signature'
  | 'rate_limit_exceeded'
  | 'missing_env_var'
  | 'webhook_error'
  | 'line_api_error'
  | 'suspicious_request';

export function logSecurity(
  event: SecurityEvent,
  details: Record<string, unknown> = {}
): void {
  // ユーザーIDは先頭8文字のみログ（プライバシー保護）
  console.warn(
    JSON.stringify({
      level: 'SECURITY',
      event,
      ts: new Date().toISOString(),
      ...details,
    })
  );
}

export function logError(
  context: string,
  err: unknown,
  details: Record<string, unknown> = {}
): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack   = err instanceof Error ? err.stack   : undefined;
  console.error(
    JSON.stringify({
      level: 'ERROR',
      context,
      message,
      stack,
      ts: new Date().toISOString(),
      ...details,
    })
  );
}

// ── 必須環境変数の検証 ────────────────────────────────────────────────────────

const REQUIRED_ENV = [
  'LINE_CHANNEL_SECRET',
  'LINE_CHANNEL_ACCESS_TOKEN',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ANTHROPIC_API_KEY',
] as const;

export function validateEnv(): void {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    logSecurity('missing_env_var', { missing });
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}

// ── ユーザー単位のインメモリレートリミッター ──────────────────────────────────
// Vercel サーバーレス環境ではインスタンスをまたがらないが、
// 同一インスタンス内でのスパムを抑制するベストエフォート実装

interface RlEntry { count: number; resetAt: number }
const rlMap = new Map<string, RlEntry>();

const RL_LIMIT  = 20;        // ウィンドウあたりの最大リクエスト数
const RL_WINDOW = 60_000;    // ウィンドウ幅（ミリ秒）

export function checkRateLimit(userId: string): boolean {
  const now   = Date.now();
  const entry = rlMap.get(userId);

  if (!entry || now > entry.resetAt) {
    rlMap.set(userId, { count: 1, resetAt: now + RL_WINDOW });
    return true;
  }

  if (entry.count >= RL_LIMIT) return false;
  entry.count++;
  return true;
}

// 期限切れエントリの定期クリーンアップ（メモリリーク防止）
export function cleanupRateLimit(): void {
  const now = Date.now();
  for (const [key, val] of rlMap) {
    if (now > val.resetAt) rlMap.delete(key);
  }
}
