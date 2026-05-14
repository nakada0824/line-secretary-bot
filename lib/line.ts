import crypto from 'crypto';
import { LineMessage } from '@/types';

const LINE_API = 'https://api.line.me/v2/bot';

export function verifySignature(body: string, signature: string): boolean {
  const hash = crypto
    .createHmac('sha256', process.env.LINE_CHANNEL_SECRET!)
    .update(body)
    .digest('base64');
  return hash === signature;
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
    console.error('LINE reply error:', err);
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
    console.error('LINE push error:', err);
  }
}
