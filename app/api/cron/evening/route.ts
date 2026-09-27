import { NextRequest } from 'next/server';
import { buildEveningNotice } from '@/lib/evening-notice';
import { pushMessage, textMessage } from '@/lib/line';

export const runtime = 'nodejs';
export const maxDuration = 60;

// 毎晩22時（vercel.json の Cron）に1日1通の通知を送る。中身は lib/evening-notice.ts
export async function GET(request: NextRequest): Promise<Response> {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response(null, { status: 401 });
  }

  const userId = process.env.WEB_USER_ID;
  if (!userId) {
    console.error('[evening cron] WEB_USER_ID is not set');
    return Response.json({ error: 'WEB_USER_ID not configured' }, { status: 500 });
  }

  const text = await buildEveningNotice(userId);
  await pushMessage(userId, [textMessage(text)]);
  console.log(`[evening cron] sent ${text.length} chars`);
  return Response.json({ sent: true });
}
