import { NextRequest } from 'next/server';
import { supabase, getAllUsers } from '@/lib/supabase';
import { pushMessage, textMessage } from '@/lib/line';
import { generateEveningMessage } from '@/lib/claude';
import { Schedule } from '@/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<Response> {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const users = await getAllUsers();
  if (!users.length) return Response.json({ sent: 0 });

  const jstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const tomorrowStart = new Date(jstNow);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  tomorrowStart.setHours(0, 0, 0, 0);
  const tomorrowEnd = new Date(tomorrowStart);
  tomorrowEnd.setHours(23, 59, 59, 999);

  const todayStart = new Date(jstNow);
  todayStart.setHours(0, 0, 0, 0);

  const results = await Promise.allSettled(
    users.map((user) => sendEvening(user, todayStart, tomorrowStart, tomorrowEnd))
  );

  const sent = results.filter((r) => r.status === 'fulfilled').length;
  return Response.json({ sent, total: users.length });
}

async function sendEvening(
  user: { user_id: string; display_name: string; location: string },
  todayStart: Date,
  tomorrowStart: Date,
  tomorrowEnd: Date
) {
  const [completedRes, pendingRes, tomorrowRes] = await Promise.all([
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.user_id)
      .eq('completed', true)
      .gte('completed_at', todayStart.toISOString()),
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.user_id)
      .eq('completed', false),
    supabase
      .from('schedules')
      .select('title, start_time, location')
      .eq('user_id', user.user_id)
      .gte('start_time', tomorrowStart.toISOString())
      .lte('start_time', tomorrowEnd.toISOString())
      .order('start_time', { ascending: true }),
  ]);

  const message = await generateEveningMessage({
    displayName: user.display_name,
    tomorrowSchedules: (tomorrowRes.data ?? []) as Schedule[],
    completedTasks: completedRes.count ?? 0,
    pendingTasks: pendingRes.count ?? 0,
  });

  await pushMessage(user.user_id, [textMessage(message)]);
}
