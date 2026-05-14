import { NextRequest } from 'next/server';
import { supabase, getAllUsers } from '@/lib/supabase';
import { pushMessage, textMessage } from '@/lib/line';
import { generateWeeklySummary } from '@/lib/claude';
import { Habit, Schedule } from '@/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<Response> {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const users = await getAllUsers();
  if (!users.length) return Response.json({ sent: 0 });

  const results = await Promise.allSettled(users.map(sendWeeklySummary));
  const sent = results.filter((r) => r.status === 'fulfilled').length;
  return Response.json({ sent, total: users.length });
}

async function sendWeeklySummary(user: { user_id: string; display_name: string }) {
  const jstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const weekAgo = new Date(jstNow);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const nextWeekEnd = new Date(jstNow);
  nextWeekEnd.setDate(nextWeekEnd.getDate() + 7);

  const [completedRes, pendingRes, habitsRes, upcomingRes] = await Promise.all([
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.user_id)
      .eq('completed', true)
      .gte('completed_at', weekAgo.toISOString()),
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.user_id)
      .eq('completed', false),
    supabase
      .from('habits')
      .select('name, streak')
      .eq('user_id', user.user_id)
      .order('streak', { ascending: false })
      .limit(5),
    supabase
      .from('schedules')
      .select('title, start_time')
      .eq('user_id', user.user_id)
      .gte('start_time', jstNow.toISOString())
      .lte('start_time', nextWeekEnd.toISOString())
      .order('start_time', { ascending: true })
      .limit(5),
  ]);

  const message = await generateWeeklySummary({
    displayName: user.display_name,
    completedTasks: completedRes.count ?? 0,
    pendingTasks: pendingRes.count ?? 0,
    habits: (habitsRes.data ?? []) as Habit[],
    upcomingSchedules: (upcomingRes.data ?? []) as Schedule[],
  });

  await pushMessage(user.user_id, [textMessage(message)]);
}
