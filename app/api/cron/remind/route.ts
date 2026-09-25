import { NextRequest } from 'next/server';
import { listEvents, type CalendarEvent } from '@/lib/icloud';
import { jstDayRange } from '@/lib/jst';
import { iphoneCalendarUrl } from '@/lib/calendar-link';
import { fmtEventTime } from '@/lib/handlers/schedule';
import { pushMessage, textMessage } from '@/lib/line';

export const runtime = 'nodejs';
export const maxDuration = 30;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'Asia/Tokyo',
  });
}

function line(e: CalendarEvent, prefix: string): string {
  return `・${prefix} ${fmtEventTime(e)} ${e.title}${e.location ? `（${e.location}）` : ''}`;
}

// 毎朝7時（vercel.json の Cron）に今日・明日・2日後・3日後の予定を iCloud から送る
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
  const today = jstDayRange(now, 0);
  const tomorrow = jstDayRange(now, 1);
  const in2d = jstDayRange(now, 2);
  const in3d = jstDayRange(now, 3);

  const events = await listEvents(today.start, in3d.end);
  const on = (range: { start: Date; end: Date }) =>
    events.filter((e) => {
      const s = new Date(e.start_time);
      return s >= range.start && s < range.end;
    });

  const todayScheds = on(today);
  const tomorrowScheds = on(tomorrow);
  const in2dScheds = on(in2d);
  const in3dScheds = on(in3d);

  if (!todayScheds.length && !tomorrowScheds.length && !in2dScheds.length && !in3dScheds.length) {
    return Response.json({ sent: false, reason: 'no schedules' });
  }

  const lines: string[] = [];
  lines.push('おはようございます、中田さん！☀️');
  lines.push('今日のリマインドです。');

  if (in3dScheds.length > 0) {
    lines.push('');
    lines.push('【3日後】');
    for (const e of in3dScheds) lines.push(line(e, fmtDate(e.start_time)));
  }

  if (in2dScheds.length > 0) {
    lines.push('');
    lines.push('【2日後】');
    for (const e of in2dScheds) lines.push(line(e, fmtDate(e.start_time)));
  }

  if (tomorrowScheds.length > 0) {
    lines.push('');
    lines.push('【明日】');
    for (const e of tomorrowScheds) lines.push(line(e, fmtDate(e.start_time)));
  }

  if (todayScheds.length > 0) {
    lines.push('');
    lines.push('【本日】');
    for (const e of todayScheds) lines.push(line(e, '本日'));
  }

  lines.push('', `📱 カレンダーを開く\n${iphoneCalendarUrl()}`);

  await pushMessage(userId, [textMessage(lines.join('\n'))]);
  console.log(`[remind cron] sent: today=${todayScheds.length} tomorrow=${tomorrowScheds.length} in2d=${in2dScheds.length} in3d=${in3dScheds.length}`);
  return Response.json({ sent: true });
}
