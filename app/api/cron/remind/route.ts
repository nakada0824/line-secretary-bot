import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { pushMessage, textMessage } from '@/lib/line';
import { Schedule } from '@/types';

export const runtime = 'nodejs';
export const maxDuration = 30;

function jstNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
}

function dayRange(base: Date, offsetDays: number): { start: string; end: string } {
  const start = new Date(base);
  start.setDate(start.getDate() + offsetDays);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'Asia/Tokyo',
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  });
}

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

  const now = jstNow();
  const todayRange   = dayRange(now, 0);
  const tomorrowRange = dayRange(now, 1);
  const in3dRange    = dayRange(now, 3);

  const schedulesIn = (range: { start: string; end: string }) =>
    query<Schedule>(
      `SELECT id, title, start_time, location FROM schedules
       WHERE user_id = $1 AND start_time >= $2 AND start_time <= $3
       ORDER BY start_time`,
      [userId, range.start, range.end]
    );

  const [todayScheds, tomorrowScheds, in3dScheds] = await Promise.all([
    schedulesIn(todayRange),
    schedulesIn(tomorrowRange),
    schedulesIn(in3dRange),
  ]);

  if (!todayScheds.length && !tomorrowScheds.length && !in3dScheds.length) {
    return Response.json({ sent: false, reason: 'no schedules' });
  }

  const lines: string[] = [];
  lines.push('おはようございます、中田さん！☀️');
  lines.push('今日のリマインドです。');

  if (in3dScheds.length > 0) {
    lines.push('');
    lines.push('【3日後】');
    for (const s of in3dScheds) {
      lines.push(`・${fmtDate(s.start_time)} ${fmtTime(s.start_time)} ${s.title}${s.location ? `（${s.location}）` : ''}`);
    }
  }

  if (tomorrowScheds.length > 0) {
    lines.push('');
    lines.push('【明日】');
    for (const s of tomorrowScheds) {
      lines.push(`・${fmtDate(s.start_time)} ${fmtTime(s.start_time)} ${s.title}${s.location ? `（${s.location}）` : ''}`);
    }
  }

  if (todayScheds.length > 0) {
    lines.push('');
    lines.push('【本日】');
    for (const s of todayScheds) {
      lines.push(`・本日 ${fmtTime(s.start_time)} ${s.title}${s.location ? `（${s.location}）` : ''}`);
    }
  }

  await pushMessage(userId, [textMessage(lines.join('\n'))]);
  console.log(`[remind cron] sent: today=${todayScheds.length} tomorrow=${tomorrowScheds.length} in3d=${in3dScheds.length}`);
  return Response.json({ sent: true });
}
