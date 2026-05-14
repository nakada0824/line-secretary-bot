import { supabase, getUserDisplayName, getUser } from '@/lib/supabase';
import { pushMessage, textMessage } from '@/lib/line';
import { generateMorningMessage, generateEveningMessage, generateWeeklySummary } from '@/lib/claude';
import { getWeather, formatWeather } from '@/lib/weather';
import { Schedule, Task, Habit, Birthday } from '@/types';

function jstNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
}

// ───────────────────────────── 朝のレポート（「おはよう」トリガー）─────────────────────────────

export async function getMorningReport(userId: string): Promise<string> {
  const now = jstNow();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  const in7days = new Date(now);
  in7days.setDate(in7days.getDate() + 7);

  const [user, schedulesRes, tasksRes, birthdaysRes, weather] = await Promise.all([
    getUser(userId),
    supabase
      .from('schedules')
      .select('title, start_time, location')
      .eq('user_id', userId)
      .gte('start_time', todayStart.toISOString())
      .lte('start_time', todayEnd.toISOString())
      .order('start_time', { ascending: true }),
    supabase
      .from('tasks')
      .select('title, priority, deadline')
      .eq('user_id', userId)
      .eq('completed', false)
      .not('deadline', 'is', null)
      .lte('deadline', in7days.toISOString())
      .order('deadline', { ascending: true })
      .limit(5),
    supabase.from('birthdays').select('name, birth_date').eq('user_id', userId),
    getWeather('Tokyo'),
  ]);

  const schedules = (schedulesRes.data ?? []) as Schedule[];
  const tasks = (tasksRes.data ?? []) as Task[];

  // 誕生日チェック
  const birthdayLines: string[] = [];
  for (const b of (birthdaysRes.data ?? []) as Birthday[]) {
    const bd = new Date(b.birth_date);
    const isToday = bd.getMonth() === now.getMonth() && bd.getDate() === now.getDate();
    if (isToday) {
      birthdayLines.push(`🎂 今日は${b.name}さんの誕生日です！お祝いを忘れずに！`);
    } else {
      const bdThisYear = new Date(now.getFullYear(), bd.getMonth(), bd.getDate());
      const in7d = new Date(now);
      in7d.setDate(in7d.getDate() + 7);
      if (bdThisYear > now && bdThisYear <= in7d) {
        const days = Math.ceil((bdThisYear.getTime() - now.getTime()) / 86400000);
        birthdayLines.push(`🎂 ${b.name}さんの誕生日まであと${days}日です！`);
      }
    }
  }

  const weatherText = formatWeather(weather);
  const message = await generateMorningMessage({
    displayName: user.display_name,
    schedules,
    tasks,
    weather: weatherText,
  });

  return birthdayLines.length > 0 ? `${message}\n\n${birthdayLines.join('\n')}` : message;
}

// ───────────────────────────── 夜の振り返りレポート ─────────────────────────────

export async function getEveningReport(userId: string): Promise<string> {
  const now = jstNow();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(now);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  tomorrowStart.setHours(0, 0, 0, 0);
  const tomorrowEnd = new Date(tomorrowStart);
  tomorrowEnd.setHours(23, 59, 59, 999);

  const [displayName, completedRes, pendingRes, tomorrowRes] = await Promise.all([
    getUserDisplayName(userId),
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('completed', true)
      .gte('completed_at', todayStart.toISOString()),
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('completed', false),
    supabase
      .from('schedules')
      .select('title, start_time, location')
      .eq('user_id', userId)
      .gte('start_time', tomorrowStart.toISOString())
      .lte('start_time', tomorrowEnd.toISOString())
      .order('start_time', { ascending: true }),
  ]);

  return generateEveningMessage({
    displayName,
    tomorrowSchedules: (tomorrowRes.data ?? []) as Schedule[],
    completedTasks: completedRes.count ?? 0,
    pendingTasks: pendingRes.count ?? 0,
  });
}

// ───────────────────────────── 週次サマリー ─────────────────────────────

export async function getWeeklySummaryReport(userId: string): Promise<string> {
  const now = jstNow();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const nextWeekEnd = new Date(now);
  nextWeekEnd.setDate(nextWeekEnd.getDate() + 7);

  const [displayName, completedRes, pendingRes, habitsRes, upcomingRes] = await Promise.all([
    getUserDisplayName(userId),
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('completed', true)
      .gte('completed_at', weekAgo.toISOString()),
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('completed', false),
    supabase
      .from('habits')
      .select('name, streak')
      .eq('user_id', userId)
      .order('streak', { ascending: false })
      .limit(5),
    supabase
      .from('schedules')
      .select('title, start_time')
      .eq('user_id', userId)
      .gte('start_time', now.toISOString())
      .lte('start_time', nextWeekEnd.toISOString())
      .order('start_time', { ascending: true })
      .limit(5),
  ]);

  return generateWeeklySummary({
    displayName,
    completedTasks: completedRes.count ?? 0,
    pendingTasks: pendingRes.count ?? 0,
    habits: (habitsRes.data ?? []) as Habit[],
    upcomingSchedules: (upcomingRes.data ?? []) as Schedule[],
  });
}

// ───────────────────────────── 手動リマインド確認 ─────────────────────────────

export async function getCheckReminders(userId: string): Promise<string> {
  const now = jstNow();
  const in24h = new Date(now);
  in24h.setHours(in24h.getHours() + 24);

  const [scheduleRes, taskRes] = await Promise.all([
    supabase
      .from('schedules')
      .select('title, start_time, location')
      .eq('user_id', userId)
      .gte('start_time', now.toISOString())
      .lte('start_time', in24h.toISOString())
      .order('start_time', { ascending: true })
      .limit(5),
    supabase
      .from('tasks')
      .select('title, deadline')
      .eq('user_id', userId)
      .eq('completed', false)
      .not('deadline', 'is', null)
      .lte('deadline', in24h.toISOString())
      .order('deadline', { ascending: true })
      .limit(5),
  ]);

  const lines: string[] = [];

  if (scheduleRes.data?.length) {
    lines.push('📅 今後24時間の予定:');
    for (const s of scheduleRes.data as Schedule[]) {
      const t = new Date(s.start_time).toLocaleTimeString('ja-JP', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Tokyo',
      });
      lines.push(`・${t} ${s.title}${s.location ? ` (${s.location})` : ''}`);
    }
  }

  if (taskRes.data?.length) {
    if (lines.length) lines.push('');
    lines.push('✅ 期限が迫っているタスク:');
    for (const t of taskRes.data as Task[]) {
      const dl = new Date(t.deadline!).toLocaleDateString('ja-JP', {
        month: 'numeric',
        day: 'numeric',
        timeZone: 'Asia/Tokyo',
      });
      lines.push(`・${t.title} [締め切り: ${dl}]`);
    }
  }

  if (!lines.length) return '🎉 今後24時間の予定・期限はありません！ゆっくりできますね。';
  return `⏰ リマインド確認\n\n${lines.join('\n')}`;
}

// ───────────────────────────── 自動バックグラウンドリマインド ─────────────────────────────
// メッセージ受信ごとに呼ばれる。DBフラグ制御で重複送信を防ぐ。

export async function runBackgroundReminders(userId: string): Promise<void> {
  const now = new Date();
  await Promise.all([
    checkScheduleReminders(userId, now),
    checkTaskReminders(userId, now),
  ]);
}

async function checkScheduleReminders(userId: string, now: Date): Promise<void> {
  const in25m = new Date(now.getTime() + 25 * 60 * 1000);
  const in35m = new Date(now.getTime() + 35 * 60 * 1000);
  const in55m = new Date(now.getTime() + 55 * 60 * 1000);
  const in65m = new Date(now.getTime() + 65 * 60 * 1000);

  type ScheduleRow = { id: string; title: string; start_time: string; location?: string };

  const [res1h, res30m] = await Promise.all([
    supabase
      .from('schedules')
      .select('id, title, start_time, location')
      .eq('user_id', userId)
      .eq('reminded_1h', false)
      .gte('start_time', in55m.toISOString())
      .lte('start_time', in65m.toISOString()),
    supabase
      .from('schedules')
      .select('id, title, start_time, location')
      .eq('user_id', userId)
      .eq('reminded_30m', false)
      .gte('start_time', in25m.toISOString())
      .lte('start_time', in35m.toISOString()),
  ]);

  for (const s of (res1h.data ?? []) as ScheduleRow[]) {
    const t = new Date(s.start_time).toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Tokyo',
    });
    await Promise.all([
      pushMessage(userId, [
        textMessage(`⏰ 1時間前リマインド\n\n📌 ${s.title}\n🕐 ${t}${s.location ? `\n📍 ${s.location}` : ''}\n\n準備はいいですか？`),
      ]),
      supabase.from('schedules').update({ reminded_1h: true }).eq('id', s.id),
    ]);
  }

  for (const s of (res30m.data ?? []) as ScheduleRow[]) {
    const t = new Date(s.start_time).toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Tokyo',
    });
    await Promise.all([
      pushMessage(userId, [
        textMessage(`⏰ 30分前リマインド\n\n📌 ${s.title}\n🕐 ${t}${s.location ? `\n📍 ${s.location}` : ''}\n\nもうすぐです！`),
      ]),
      supabase.from('schedules').update({ reminded_30m: true }).eq('id', s.id),
    ]);
  }
}

async function checkTaskReminders(userId: string, now: Date): Promise<void> {
  const jst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));

  const in1d = new Date(jst);
  in1d.setDate(in1d.getDate() + 1);
  in1d.setHours(23, 59, 59, 999);

  const in3d = new Date(jst);
  in3d.setDate(in3d.getDate() + 3);
  in3d.setHours(23, 59, 59, 999);

  const in7d = new Date(jst);
  in7d.setDate(in7d.getDate() + 7);
  in7d.setHours(23, 59, 59, 999);

  const [week, three, one] = await Promise.all([
    supabase
      .from('tasks')
      .select('id, title, deadline')
      .eq('user_id', userId)
      .eq('completed', false)
      .eq('reminded_week', false)
      .gte('deadline', in3d.toISOString())
      .lte('deadline', in7d.toISOString()),
    supabase
      .from('tasks')
      .select('id, title, deadline')
      .eq('user_id', userId)
      .eq('completed', false)
      .eq('reminded_3days', false)
      .gte('deadline', in1d.toISOString())
      .lte('deadline', in3d.toISOString()),
    supabase
      .from('tasks')
      .select('id, title')
      .eq('user_id', userId)
      .eq('completed', false)
      .eq('reminded_1day', false)
      .gte('deadline', jst.toISOString())
      .lte('deadline', in1d.toISOString()),
  ]);

  type TaskRow = { id: string; title: string; deadline?: string };

  for (const t of (week.data ?? []) as TaskRow[]) {
    const dl = new Date(t.deadline!).toLocaleDateString('ja-JP', {
      month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo',
    });
    await Promise.all([
      pushMessage(userId, [textMessage(`📋 タスクリマインド（1週間前）\n\n「${t.title}」\n📆 締め切り: ${dl}\n\n計画的に進めましょう！`)]),
      supabase.from('tasks').update({ reminded_week: true }).eq('id', t.id),
    ]);
  }

  for (const t of (three.data ?? []) as TaskRow[]) {
    const dl = new Date(t.deadline!).toLocaleDateString('ja-JP', {
      month: 'numeric', day: 'numeric', timeZone: 'Asia/Tokyo',
    });
    await Promise.all([
      pushMessage(userId, [textMessage(`⚠️ タスクリマインド（3日前）\n\n「${t.title}」\n📆 締め切り: ${dl}\n\nそろそろ本格的に取り組みましょう！`)]),
      supabase.from('tasks').update({ reminded_3days: true }).eq('id', t.id),
    ]);
  }

  for (const t of (one.data ?? []) as TaskRow[]) {
    await Promise.all([
      pushMessage(userId, [textMessage(`🔴 タスクリマインド（前日・当日）\n\n「${t.title}」\n\n締め切りが迫っています！頑張れ！💪`)]),
      supabase.from('tasks').update({ reminded_1day: true }).eq('id', t.id),
    ]);
  }
}
