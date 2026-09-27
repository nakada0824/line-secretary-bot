import { NextRequest } from 'next/server';
import { ensureAlarms } from '@/lib/icloud';
import { buildMorningNotice } from '@/lib/morning-notice';
import { pushMessage, textMessage } from '@/lib/line';

export const runtime = 'nodejs';
export const maxDuration = 60;

const ALARM_LOOKAHEAD_MS = 60 * 24 * 60 * 60 * 1000; // 60日先まで

// 毎朝7時（vercel.json の Cron）に1日1通の通知を送る（出すものがない日は送らない）。中身は lib/morning-notice.ts
export async function GET(request: NextRequest): Promise<Response> {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response(null, { status: 401 });
  }

  const userId = process.env.WEB_USER_ID;
  if (!userId) {
    console.error('[remind cron] WEB_USER_ID is not set');
    return Response.json({ error: 'WEB_USER_ID not configured' }, { status: 500 });
  }

  const now = new Date();
  const text = await buildMorningNotice(userId, now);
  if (text) {
    await pushMessage(userId, [textMessage(text)]);
    console.log(`[remind cron] sent ${text.length} chars`);
  } else {
    console.log('[remind cron] nothing to send today');
  }

  // iPhone / Mac で直接入れた予定にも、決まった iPhone 通知を付け足す
  const alarms = await ensureAlarms(now, new Date(now.getTime() + ALARM_LOOKAHEAD_MS)).catch((e) => {
    console.error('[remind cron] ensureAlarms error', e);
    return null;
  });
  return Response.json({ sent: !!text, alarms });
}
