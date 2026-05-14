import { supabase, getUserDisplayName, getUser } from '@/lib/supabase';
import { pushMessage, textMessage } from '@/lib/line';
import { generateMorningOneLiner, generateEveningMessage, generateWeeklySummary } from '@/lib/claude';
import { getWeather, formatWeather } from '@/lib/weather';
import { Schedule, Task, Habit, Birthday } from '@/types';

const PRIORITY_LABEL: Record<number, string> = { 1: '最低', 2: '低', 3: '中', 4: '高', 5: '最高' };

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
}

function fmtDateShort(iso: string) {
  const d = new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}(${weekday})`;
}

function jstNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
}

// ───────────────────────────── 朝のレポート（「おはよう」トリガー）─────────────────────────────

export async function getMorningReport(userId: string): Promise<string> {
  const user = await getUser(userId);
  const now = jstNow();

  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(now); todayEnd.setHours(23, 59, 59, 999);
  const weekEnd    = new Date(now); weekEnd.setDate(weekEnd.getDate() + 7); weekEnd.setHours(23, 59, 59, 999);
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const [
    todaySchedRes, weekSchedRes, monthSchedRes,
    todayTaskRes, weekTaskRes,
    birthdaysRes, weather, oneLiner,
  ] = await Promise.all([
    // 今日の予定
    supabase.from('schedules').select('title, start_time, location')
      .eq('user_id', userId)
      .gte('start_time', todayStart.toISOString())
      .lte('start_time', todayEnd.toISOString())
      .order('start_time'),
    // 今週の予定（明日〜7日後）
    supabase.from('schedules').select('title, start_time, location')
      .eq('user_id', userId)
      .gt('start_time', todayEnd.toISOString())
      .lte('start_time', weekEnd.toISOString())
      .order('start_time'),
    // 今月の予定（7日後〜月末）
    supabase.from('schedules').select('title, start_time')
      .eq('user_id', userId)
      .gt('start_time', weekEnd.toISOString())
      .lte('start_time', monthEnd.toISOString())
      .order('start_time'),
    // 今日締め切りのタスク
    supabase.from('tasks').select('title, priority, deadline')
      .eq('user_id', userId).eq('completed', false)
      .not('deadline', 'is', null)
      .lte('deadline', todayEnd.toISOString())
      .order('priority', { ascending: false }),
    // 今週締め切りのタスク（今日を除く）
    supabase.from('tasks').select('title, priority, deadline')
      .eq('user_id', userId).eq('completed', false)
      .not('deadline', 'is', null)
      .gt('deadline', todayEnd.toISOString())
      .lte('deadline', weekEnd.toISOString())
      .order('deadline'),
    supabase.from('birthdays').select('name, birth_date').eq('user_id', userId),
    getWeather(user.location || 'Tokyo'),
    generateMorningOneLiner(user.display_name),
  ]);

  const todayScheds = (todaySchedRes.data ?? []) as Schedule[];
  const weekScheds  = (weekSchedRes.data  ?? []) as Schedule[];
  const monthScheds = (monthSchedRes.data ?? []) as Schedule[];
  const todayTasks  = (todayTaskRes.data  ?? []) as Task[];
  const weekTasks   = (weekTaskRes.data   ?? []) as Task[];

  const lines: string[] = [];

  // ヘッダー
  const dateLabel = now.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  lines.push(`おはようございます、${user.display_name}さん！🌅`);
  lines.push(dateLabel);

  // ── 今日の予定 ──
  lines.push('');
  lines.push('━━━ 📅 今日の予定 ━━━');
  if (todayScheds.length === 0) {
    lines.push('（予定なし）');
  } else {
    for (const s of todayScheds) {
      lines.push(`・${fmtTime(s.start_time)} ${s.title}${s.location ? `（${s.location}）` : ''}`);
    }
  }

  // ── 今週の予定 ──
  lines.push('');
  lines.push('━━━ 📆 今週の予定 ━━━');
  if (weekScheds.length === 0) {
    lines.push('（予定なし）');
  } else {
    for (const s of weekScheds) {
      lines.push(`・${fmtDateShort(s.start_time)} ${fmtTime(s.start_time)} ${s.title}${s.location ? `（${s.location}）` : ''}`);
    }
  }

  // ── 今月の予定 ──
  lines.push('');
  lines.push('━━━ 🗓️ 今月の予定 ━━━');
  if (monthScheds.length === 0) {
    lines.push('（予定なし）');
  } else {
    for (const s of monthScheds.slice(0, 10)) {
      lines.push(`・${fmtDateShort(s.start_time)} ${s.title}`);
    }
    if (monthScheds.length > 10) lines.push(`  他${monthScheds.length - 10}件…`);
  }

  // ── 期限が近いタスク ──
  if (todayTasks.length > 0 || weekTasks.length > 0) {
    lines.push('');
    lines.push('━━━ ✅ 期限が近いタスク ━━━');
    if (todayTasks.length > 0) {
      lines.push('🔴 今日まで');
      for (const t of todayTasks) {
        lines.push(`・${t.title} [優先度: ${PRIORITY_LABEL[t.priority] ?? '中'}]`);
      }
    }
    if (weekTasks.length > 0) {
      if (todayTasks.length > 0) lines.push('');
      lines.push('📌 今週まで');
      for (const t of weekTasks) {
        const dl = t.deadline
          ? new Date(t.deadline).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Tokyo' })
          : '';
        lines.push(`・${t.title}${dl ? ` [${dl}締め]` : ''}`);
      }
    }
  }

  // ── 天気・傘アラート ──
  lines.push('');
  lines.push('━━━ 🌤️ 天気・傘アラート ━━━');
  lines.push(formatWeather(weather));

  // ── 誕生日 ──
  const birthdayLines: string[] = [];
  for (const b of (birthdaysRes.data ?? []) as Birthday[]) {
    const bd = new Date(b.birth_date);
    if (bd.getMonth() === now.getMonth() && bd.getDate() === now.getDate()) {
      birthdayLines.push(`🎂 今日は${b.name}さんの誕生日です！お祝いを忘れずに！`);
    } else {
      const bdThisYear = new Date(now.getFullYear(), bd.getMonth(), bd.getDate());
      if (bdThisYear > now && bdThisYear <= weekEnd) {
        const days = Math.ceil((bdThisYear.getTime() - now.getTime()) / 86400000);
        birthdayLines.push(`🎂 ${b.name}さんの誕生日まであと${days}日！`);
      }
    }
  }
  if (birthdayLines.length > 0) {
    lines.push('');
    lines.push('━━━ 🎂 誕生日 ━━━');
    lines.push(...birthdayLines);
  }

  // ── 一言メッセージ ──
  lines.push('');
  lines.push('━━━ 💬 一言 ━━━');
  lines.push(oneLiner);

  return lines.join('\n');
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
  // 個別の失敗が全体を止めないよう allSettled で実行
  await Promise.allSettled([
    checkScheduleReminders(userId, now).catch((e) =>
      console.error('[schedule reminder error]', e)
    ),
    checkTaskReminders(userId, now).catch((e) =>
      console.error('[task reminder error]', e)
    ),
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
