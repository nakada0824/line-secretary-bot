import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import Anthropic from '@anthropic-ai/sdk';
import { logSecurity } from '@/lib/security';

export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<Response> {
  // シークレットトークンによる認証
  const token    = request.headers.get('x-health-token') ?? request.nextUrl.searchParams.get('token');
  const expected = process.env.HEALTH_CHECK_SECRET;

  if (!expected || !token || token !== expected) {
    logSecurity('suspicious_request', {
      reason  : 'health_unauthorized',
      ip      : request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown',
      hasToken: !!token,
    });
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Record<string, { ok: boolean; detail?: string }> = {};

  // 1. Supabase 接続確認
  try {
    const { error } = await supabase.from('users').select('user_id').limit(1);
    results.supabase = error
      ? { ok: false, detail: error.message }
      : { ok: true };
  } catch (e) {
    results.supabase = { ok: false, detail: String(e) };
  }

  // 2. Anthropic API 接続確認
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res    = await client.messages.create({
      model    : 'claude-sonnet-4-6',
      max_tokens: 16,
      messages  : [{ role: 'user', content: 'ping' }],
    });
    results.anthropic = { ok: true, detail: `tokens: ${res.usage.input_tokens}` };
  } catch (e) {
    results.anthropic = { ok: false, detail: String(e) };
  }

  // 3. LINE アクセストークン確認
  try {
    const res = await fetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    if (res.ok) {
      const data = await res.json();
      results.line = { ok: true, detail: `bot: ${data.displayName}` };
    } else {
      results.line = { ok: false, detail: `HTTP ${res.status}` };
    }
  } catch (e) {
    results.line = { ok: false, detail: String(e) };
  }

  // 4. 環境変数の存在確認（値は表示しない）
  const envKeys = [
    'LINE_CHANNEL_SECRET',
    'LINE_CHANNEL_ACCESS_TOKEN',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'ANTHROPIC_API_KEY',
    'HEALTH_CHECK_SECRET',
  ];
  results.env = {
    ok    : envKeys.every((k) => !!process.env[k]),
    detail: envKeys.map((k) => `${k}: ${process.env[k] ? '✅' : '❌'}`).join(', '),
  };

  const allOk = Object.values(results).every((r) => r.ok);
  return Response.json(
    { status: allOk ? 'ok' : 'error', checks: results },
    { status: allOk ? 200 : 500 }
  );
}
