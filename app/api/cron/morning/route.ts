import { NextRequest } from 'next/server';
import { supabase, getAllUsers } from '@/lib/supabase';
import { pushMessage, textMessage } from '@/lib/line';
import { getWeather, formatWeather } from '@/lib/weather';
import { generateMorningMessage } from '@/lib/claude';
import { Schedule, Task, Birthday } from '@/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<Response> {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const users = await getAllUsers();
  if (!users.length) return Response.json({ sent: 0 });

  const jstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const todayStart = new Date(jstNow);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(jstNow);
  todayEnd.setHours(23, 59, 59, 999);

  const results = await Promise.allSettled(
    users.map((user) => sendMorning(user, jstNow, todayStart, todayEnd))
  );

  const sent = results.filter((r) => r.status === 'fulfilled').length;
  return Response.json({ sent, total: users.length });
}

async function sendMorning(
  user: { user_id: string; display_name: string; location: string },
  jstNow: Date,
  todayStart: Date,
  todayEnd: Date
) {
  const [schedulesRes, tasksRes, birthdays, weather] = await Promise.all([
    supabase
      .from('schedules')
      .select('title, start_time, location')
      .eq('user_id', user.user_id)
      .gte('start_time', todayStart.toISOString())
      .lte('start_time', todayEnd.toISOString())
      .order('start_time', { ascending: true }),
    supabase
      .from('tasks')
      .select('title, priority, deadline')
      .eq('user_id', user.user_id)
      .eq('completed', false)
      .not('deadline', 'is', null)
      .lte('deadline', new Date(jstNow.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString())
      .order('deadline', { ascending: true })
      .limit(5),
    supabase
      .from('birthdays')
      .select('name, birth_date')
      .eq('user_id', user.user_id),
    getWeather(user.location || 'Tokyo'),
  ]);

  const schedules = (schedulesRes.data ?? []) as Schedule[];
  const tasks = (tasksRes.data ?? []) as Task[];

  // Birthday check
  const birthdayMessages: string[] = [];
  const today = jstNow;
  for (const b of (birthdays.data ?? []) as Birthday[]) {
    const bd = new Date(b.birth_date);
    const sameDay = bd.getMonth() === today.getMonth() && bd.getDate() === today.getDate();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const bdThisYear = new Date(today.getFullYear(), bd.getMonth(), bd.getDate());

    if (sameDay) birthdayMessages.push(`🎂 今日は${b.name}さんの誕生日です！お祝いを忘れずに！`);
    else if (
      bdThisYear.getTime() > today.getTime() &&
      bdThisYear.getTime() <= nextWeek.getTime()
    ) {
      const daysLeft = Math.ceil((bdThisYear.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      birthdayMessages.push(`🎂 ${b.name}さんの誕生日まであと${daysLeft}日です！`);
    }
  }

  const weatherText = formatWeather(weather);
  const message = await generateMorningMessage({
    displayName: user.display_name,
    schedules,
    tasks,
    weather: weatherText,
  });

  const fullMessage = birthdayMessages.length > 0
    ? `${message}\n\n${birthdayMessages.join('\n')}`
    : message;

  await pushMessage(user.user_id, [textMessage(fullMessage)]);
}
