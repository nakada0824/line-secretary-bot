import crypto from 'crypto';
import { LineMessage } from '@/types';
import { logSecurity } from '@/lib/security';

const LINE_API = 'https://api.line.me/v2/bot';

export function verifySignature(body: string, signature: string): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) {
    logSecurity('missing_env_var', { var: 'LINE_CHANNEL_SECRET' });
    return false;
  }

  const hash = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64');

  // タイミング攻撃対策：定長比較を使用
  try {
    const hashBuf = Buffer.from(hash, 'base64');
    const sigBuf  = Buffer.from(signature, 'base64');
    if (hashBuf.length !== sigBuf.length) return false;
    return crypto.timingSafeEqual(hashBuf, sigBuf);
  } catch {
    return false;
  }
}

export function textMessage(text: string): LineMessage {
  return { type: 'text', text };
}

export async function replyMessage(replyToken: string, messages: LineMessage[]): Promise<void> {
  const res = await fetch(`${LINE_API}/message/reply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!res.ok) {
    const err = await res.text();
    logSecurity('line_api_error', { op: 'reply', status: res.status, body: err.slice(0, 200) });
  }
}

export async function pushMessage(userId: string, messages: LineMessage[]): Promise<void> {
  const res = await fetch(`${LINE_API}/message/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ to: userId, messages }),
  });
  if (!res.ok) {
    const err = await res.text();
    logSecurity('line_api_error', { op: 'push', status: res.status, body: err.slice(0, 200) });
  }
}
