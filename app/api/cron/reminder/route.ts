import { NextRequest } from 'next/server';
import { supabase, getAllUsers } from '@/lib/supabase';
import { pushMessage, textMessage } from '@/lib/line';
import { Schedule, Task } from '@/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<Response> {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const users = await getAllUsers();
  if (!users.length) return Response.json({ processed: 0 });

  const results = await Promise.allSettled(users.map(processUserReminders));
  const processed = results.filter((r) => r.status === 'fulfilled').length;
  return Response.json({ processed, total: users.length });
}

async function processUserReminders(user: { user_id: string; display_name: string }) {
  const now = new Date();

  await Promise.all([
    checkScheduleReminders(user.user_id, now),
    checkTaskReminders(user.user_id, now),
    checkConsumableReminders(user.user_id),
  ]);
}

async function checkScheduleReminders(userId: string, now: Date) {
  const in30min = new Date(now.getTime() + 30 * 60 * 1000);
  const in65min = new Date(now.getTime() + 65 * 60 * 1000);
  const in25min = new Date(now.getTime() + 25 * 60 * 1000);

  // 1-hour reminder (check window: events starting in 60-65 min)
  const { data: upcoming1h } = await supabase
    .from('schedules')
    .select('*')
    .eq('user_id', userId)
    .eq('reminded_1h', false)
    .gte('start_time', in30min.toISOString())
    .lte('start_time', in65min.toISOString());

  for (const s of (upcoming1h ?? []) as Schedule[]) {
    const t = new Date(s.start_time).toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Tokyo',
    });
    await pushMessage(userId, [
      textMessage(`⏰ 1時間前リマインド\n\n📌 ${s.title}\n🕐 ${t}${s.location ? `\n📍 ${s.location}` : ''}\n\n準備はいいですか？`),
    ]);
    await supabase.from('schedules').update({ reminded_1h: true }).eq('id', s.id);
  }

  // 30-min reminder (check window: events starting in 25-35 min)
  const in35min = new Date(now.getTime() + 35 * 60 * 1000);
  const { data: upcoming30m } = await supabase
    .from('schedules')
    .select('*')
    .eq('user_id', userId)
    .eq('reminded_30m', false)
    .gte('start_time', in25min.toISOString())
    .lte('start_time', in35min.toISOString());

  for (const s of (upcoming30m ?? []) as Schedule[]) {
    const t = new Date(s.start_time).toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Tokyo',
    });
    await pushMessage(userId, [
      textMessage(`⏰ 30分前リマインド\n\n📌 ${s.title}\n🕐 ${t}${s.location ? `\n📍 ${s.location}` : ''}\n\nもうすぐです！`),
    ]);
    await supabase.from('schedules').update({ reminded_30m: true }).eq('id', s.id);
  }
}

async function checkTaskReminders(userId: string, now: Date) {
  const jstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const todayEnd = new Date(jstNow);
  todayEnd.setHours(23, 59, 59, 999);

  const in1day = new Date(jstNow);
  in1day.setDate(in1day.getDate() + 1);
  in1day.setHours(23, 59, 59, 999);

  const in3days = new Date(jstNow);
  in3days.setDate(in3days.getDate() + 3);
  in3days.setHours(23, 59, 59, 999);

  const in7days = new Date(jstNow);
  in7days.setDate(in7days.getDate() + 7);
  in7days.setHours(23, 59, 59, 999);

  // 1-week reminder
  const { data: weekTasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .eq('completed', false)
    .eq('reminded_week', false)
    .gte('deadline', in3days.toISOString())
    .lte('deadline', in7days.toISOString());

  for (const t of (weekTasks ?? []) as Task[]) {
    const dl = new Date(t.deadline!).toLocaleDateString('ja-JP', {
      month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo',
    });
    await pushMessage(userId, [
      textMessage(`📋 タスクリマインド（1週間前）\n\n「${t.title}」\n📆 締め切り: ${dl}\n\n計画的に進めましょう！`),
    ]);
    await supabase.from('tasks').update({ reminded_week: true }).eq('id', t.id);
  }

  // 3-day reminder
  const { data: threeDayTasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .eq('completed', false)
    .eq('reminded_3days', false)
    .gte('deadline', in1day.toISOString())
    .lte('deadline', in3days.toISOString());

  for (const t of (threeDayTasks ?? []) as Task[]) {
    const dl = new Date(t.deadline!).toLocaleDateString('ja-JP', {
      month: 'numeric', day: 'numeric', timeZone: 'Asia/Tokyo',
    });
    await pushMessage(userId, [
      textMessage(`⚠️ タスクリマインド（3日前）\n\n「${t.title}」\n📆 締め切り: ${dl}\n\nそろそろ本格的に取り組みましょう！`),
    ]);
    await supabase.from('tasks').update({ reminded_3days: true }).eq('id', t.id);
  }

  // 1-day reminder
  const { data: oneDayTasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .eq('completed', false)
    .eq('reminded_1day', false)
    .gte('deadline', jstNow.toISOString())
    .lte('deadline', in1day.toISOString());

  for (const t of (oneDayTasks ?? []) as Task[]) {
    await pushMessage(userId, [
      textMessage(`🔴 タスクリマインド（前日・当日）\n\n「${t.title}」\n\n締め切りが迫っています！頑張れ！💪`),
    ]);
    await supabase.from('tasks').update({ reminded_1day: true }).eq('id', t.id);
  }
}

async function checkConsumableReminders(userId: string) {
  const { data: consumables } = await supabase
    .from('consumables')
    .select('*')
    .eq('user_id', userId)
    .not('last_purchase_date', 'is', null);

  const today = new Date();
  const reminders: string[] = [];

  for (const c of consumables ?? []) {
    const last = new Date(c.last_purchase_date);
    const nextDate = new Date(last);
    nextDate.setDate(nextDate.getDate() + c.reminder_days);

    const daysLeft = Math.ceil((nextDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (daysLeft <= 0) {
      reminders.push(`・${c.name}（補充時期を過ぎています）`);
    } else if (daysLeft <= 3) {
      reminders.push(`・${c.name}（あと${daysLeft}日で補充時期）`);
    }
  }

  if (reminders.length > 0) {
    await pushMessage(userId, [
      textMessage(`🗂️ 消耗品補充リマインド\n\n${reminders.join('\n')}\n\n購入したら「〇〇を補充した」と送ってください！`),
    ]);
  }
}
