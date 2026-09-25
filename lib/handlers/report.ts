import { query, getUserDisplayName, getUser, getAllUsers, claimEventReminder, cleanupEventReminders } from '@/lib/db';
import { pushMessage, textMessage } from '@/lib/line';
import { generateEveningMessage, generateWeeklySummary } from '@/lib/claude';
import { listEvents, type CalendarEvent } from '@/lib/icloud';
import { jstDayRange, jstWeekday } from '@/lib/jst';
import { iphoneCalendarUrl } from '@/lib/calendar-link';
import { isCalendarOwner, fmtEventTime } from '@/lib/handlers/schedule';
import { Task, ShoppingItem, Habit } from '@/types';

// 朝の一言（Claude API不要・曜日ベースでローテーション）
const MORNING_ONE_LINERS = [
  '今日も一日よろしくお願いします！💪',       // 日
  '今週もいいスタートが切れそうですね✨',       // 月
  '順調に進んでいますよ、頑張りましょう！😊',  // 火
  '折り返し地点です。引き続き頑張って！☀️',    // 水
  'もう少しで週末ですね。ラストスパートです！', // 木
  '今週もよく頑張りました！あと一日☺️',        // 金
  'お休みの日もゆっくり充電してくださいね🌿',  // 土
];

function pickOneLiner(): string {
  return MORNING_ONE_LINERS[jstWeekday()];
}

const PRIORITY_LABEL: Record<number, string> = { 1: '最低', 2: '低', 3: '中', 4: '高', 5: '最高' };

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
}

function fmtDateShort(iso: string) {
  const d = new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}(${weekday})`;
}

// iCloud の予定。中田さん以外は空、読み込めなければ null（レポートの他の部分は出す）
async function calendarEvents(userId: string, from: Date, to: Date): Promise<CalendarEvent[] | null> {
  if (!isCalendarOwner(userId)) return [];
  try {
    return await listEvents(from, to);
  } catch (e) {
    console.error('[report calendar error]', e);
    return null;
  }
}

const CALENDAR_UNAVAILABLE = '（カレンダーを読み込めませんでした）';

function eventLine(e: CalendarEvent, withDate: boolean): string {
  const when = withDate ? `${fmtDateShort(e.start_time)} ${fmtEventTime(e)}` : fmtEventTime(e);
  return `・${when} ${e.title}${e.location ? `（${e.location}）` : ''}`;
}

// ───────────────────────────── 朝のレポート（「おはよう」トリガー）─────────────────────────────

export async function getMorningReport(userId: string): Promise<string> {
  const user = await getUser(userId);
  const now = new Date();

  const { start: todayStart, end: todayEnd } = jstDayRange(now);

  // 今週末（日曜）の終わりまで（月〜日を1週間とする）
  const dow = jstWeekday(now); // 0=日, 1=月, ..., 6=土
  const daysUntilSunday = dow === 0 ? 0 : 7 - dow;
  const weekEnd = jstDayRange(now, daysUntilSunday).end;

  const [
    weekEvents,
    todayTasks,
    weekTasks,
    importantTasks,
    shoppingItems,
    restockItems,
  ] = await Promise.all([
    // 今日〜今週末の予定（iCloud）
    calendarEvents(userId, todayStart, weekEnd),
    // 今日締め切りのタスク
    query<Task>(
      `SELECT id, title, priority, deadline FROM tasks
       WHERE user_id = $1 AND completed = false AND deadline IS NOT NULL AND deadline < $2
       ORDER BY priority DESC`,
      [userId, todayEnd.toISOString()]
    ),
    // 今週締め切りのタスク（明日〜今週末）
    query<Task>(
      `SELECT id, title, priority, deadline FROM tasks
       WHERE user_id = $1 AND completed = false AND deadline >= $2 AND deadline < $3
       ORDER BY deadline`,
      [userId, todayEnd.toISOString(), weekEnd.toISOString()]
    ),
    // 優先度4〜5の重要タスク
    query<Task>(
      `SELECT id, title, priority, deadline FROM tasks
       WHERE user_id = $1 AND completed = false AND priority >= 4
       ORDER BY priority DESC`,
      [userId]
    ),
    // 未購入の買い物リスト
    query<ShoppingItem>(
      `SELECT item, quantity FROM shopping_list
       WHERE user_id = $1 AND checked = false ORDER BY created_at ASC`,
      [userId]
    ),
    // 要補充の備品
    query<{ name: string }>(
      `SELECT name FROM consumables
       WHERE user_id = $1 AND need_restock = true ORDER BY created_at ASC`,
      [userId]
    ),
  ]);

  const todayScheds = weekEvents?.filter((e) => new Date(e.start_time) < todayEnd) ?? null;

  // 今日・今週締め切りに既出のタスクIDを除外して重複を防ぐ
  const shownTaskIds = new Set([
    ...todayTasks.map((t) => t.id),
    ...weekTasks.map((t) => t.id),
  ]);
  const topTasks = importantTasks.filter((t) => !shownTaskIds.has(t.id));

  const lines: string[] = [];

  // ── ヘッダー ──
  const dateLabel = now.toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'Asia/Tokyo',
  });
  lines.push(`おはようございます、中田さん！☀️`);
  lines.push(dateLabel);

  // ── 今日の予定 ──
  lines.push('');
  lines.push('━━━ 📅 今日の予定 ━━━');
  if (!todayScheds) {
    lines.push(CALENDAR_UNAVAILABLE);
  } else if (todayScheds.length === 0) {
    lines.push('（予定なし）');
  } else {
    for (const e of todayScheds) lines.push(eventLine(e, false));
  }

  // ── 今週の予定（今日〜週末） ──
  lines.push('');
  lines.push('━━━ 📆 今週の予定 ━━━');
  if (!weekEvents) {
    lines.push(CALENDAR_UNAVAILABLE);
  } else if (weekEvents.length === 0) {
    lines.push('今週の予定はまだありません');
  } else {
    for (const e of weekEvents) lines.push(eventLine(e, true));
  }

  // ── 要補充の備品 ──
  if (restockItems.length > 0) {
    lines.push('');
    lines.push('━━━ 🔔 そろそろ補充 ━━━');
    for (const item of restockItems) {
      lines.push(`・${item.name}`);
    }
  }

  // ── タスク ──
  lines.push('');
  lines.push('━━━ ✅ タスク ━━━');

  if (todayTasks.length === 0 && weekTasks.length === 0 && topTasks.length === 0) {
    lines.push('（期限・重要タスクなし）');
  } else {
    if (todayTasks.length > 0) {
      lines.push('🔴 今日期限');
      for (const t of todayTasks) {
        lines.push(`・${t.title} [優先度: ${PRIORITY_LABEL[t.priority] ?? '中'}]`);
      }
    }
    if (weekTasks.length > 0) {
      if (todayTasks.length > 0) lines.push('');
      lines.push('📌 今週期限');
      for (const t of weekTasks) {
        const dl = t.deadline
          ? new Date(t.deadline).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Tokyo' })
          : '';
        lines.push(`・${t.title}${dl ? ` [${dl}締め]` : ''}`);
      }
    }
    if (topTasks.length > 0) {
      if (todayTasks.length > 0 || weekTasks.length > 0) lines.push('');
      lines.push('⭐ 重要タスク（優先度4以上）');
      for (const t of topTasks) {
        const dl = t.deadline
          ? new Date(t.deadline).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Tokyo' })
          : '';
        lines.push(`・${t.title} [優先度: ${PRIORITY_LABEL[t.priority] ?? '高'}${dl ? `、${dl}締め` : ''}]`);
      }
    }
  }

  // ── 買い物リスト ──
  lines.push('');
  lines.push('━━━ 🛒 買い物リスト ━━━');
  if (shoppingItems.length === 0) {
    lines.push('（なし）');
  } else {
    for (const item of shoppingItems) {
      lines.push(`・${item.item}${item.quantity ? `（${item.quantity}）` : ''}`);
    }
  }

  // ── 一言 ──
  lines.push('');
  lines.push('━━━ 💬 一言 ━━━');
  lines.push(pickOneLiner());

  // ── カレンダーリンク ──
  lines.push('');
  lines.push('📱 カレンダーを開く');
  lines.push(iphoneCalendarUrl());

  return lines.join('\n');
}

// ───────────────────────────── 夜の振り返りレポート ─────────────────────────────

export async function getEveningReport(userId: string): Promise<string> {
  const todayStart = jstDayRange().start;
  const tomorrow = jstDayRange(new Date(), 1);

  const [displayName, counts, tomorrowSchedules] = await Promise.all([
    getUserDisplayName(userId),
    countTasks(userId, todayStart),
    calendarEvents(userId, tomorrow.start, tomorrow.end),
  ]);

  return generateEveningMessage({
    displayName,
    tomorrowSchedules: tomorrowSchedules ?? [],
    completedTasks: counts.completed,
    pendingTasks: counts.pending,
  });
}

// completedSince 以降に完了したタスク数と、未完了タスク数
async function countTasks(
  userId: string,
  completedSince: Date
): Promise<{ completed: number; pending: number }> {
  const [row] = await query<{ completed: number; pending: number }>(
    `SELECT
       COUNT(*) FILTER (WHERE completed = true AND completed_at >= $2)::int AS completed,
       COUNT(*) FILTER (WHERE completed = false)::int AS pending
     FROM tasks WHERE user_id = $1`,
    [userId, completedSince.toISOString()]
  );
  return row;
}

// ───────────────────────────── 週次サマリー ─────────────────────────────

export async function getWeeklySummaryReport(userId: string): Promise<string> {
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const now = new Date();
  const weekAgo = new Date(now.getTime() - WEEK);
  const nextWeekEnd = new Date(now.getTime() + WEEK);

  const [displayName, counts, habits, upcomingSchedules] = await Promise.all([
    getUserDisplayName(userId),
    countTasks(userId, weekAgo),
    query<Habit>(
      'SELECT name, streak FROM habits WHERE user_id = $1 ORDER BY streak DESC LIMIT 5',
      [userId]
    ),
    calendarEvents(userId, now, nextWeekEnd),
  ]);

  return generateWeeklySummary({
    displayName,
    completedTasks: counts.completed,
    pendingTasks: counts.pending,
    habits,
    upcomingSchedules: (upcomingSchedules ?? []).slice(0, 5),
  });
}

// ───────────────────────────── 手動リマインド確認 ─────────────────────────────

export async function getCheckReminders(userId: string): Promise<string> {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const [events, tasks] = await Promise.all([
    calendarEvents(userId, now, in24h),
    query<Task>(
      `SELECT title, deadline FROM tasks
       WHERE user_id = $1 AND completed = false AND deadline IS NOT NULL AND deadline <= $2
       ORDER BY deadline ASC LIMIT 5`,
      [userId, in24h.toISOString()]
    ),
  ]);

  const lines: string[] = [];

  const schedules = (events ?? []).filter((e) => new Date(e.start_time) >= now).slice(0, 5);
  if (!events) lines.push(`📅 ${CALENDAR_UNAVAILABLE}`);
  if (schedules.length) {
    lines.push('📅 今後24時間の予定:');
    for (const e of schedules) {
      lines.push(`・${fmtEventTime(e)} ${e.title}${e.location ? ` (${e.location})` : ''}`);
    }
  }

  if (tasks.length) {
    if (lines.length) lines.push('');
    lines.push('✅ 期限が迫っているタスク:');
    for (const t of tasks) {
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
// 5分おきの定期実行（/api/cron/reminders）から呼ばれる。タスクはメッセージ受信時にも確認する。
// 送信済みの記録を先に取る（UPDATE ... RETURNING / INSERT ... ON CONFLICT）ので、同時に動いても二重送信しない。

export async function runAllReminders(): Promise<{ users: number }> {
  const users = await getAllUsers();
  await Promise.allSettled([
    runScheduleReminders().catch((e) => console.error('[schedule reminder error]', e)),
    ...users.map((u) => runTaskReminders(u.user_id)),
    cleanupEventReminders().catch((e) => console.error('[reminder cleanup error]', e)),
  ]);
  return { users: users.length };
}

export async function runTaskReminders(userId: string): Promise<void> {
  await checkTaskReminders(userId, new Date()).catch((e) =>
    console.error('[task reminder error]', e)
  );
}

// iCloud の予定（自宅・職場・シフトボード）を中田さんに LINE でリマインド
async function runScheduleReminders(): Promise<void> {
  const owner = process.env.WEB_USER_ID;
  if (!owner || !process.env.ICLOUD_USERNAME) return;

  const now = new Date();
  const in35m = new Date(now.getTime() + 35 * 60 * 1000);
  const in65m = new Date(now.getTime() + 65 * 60 * 1000);

  const events = (await listEvents(now, in65m)).filter(
    (e) => !e.all_day && new Date(e.start_time) > now
  );

  for (const e of events) {
    const start = new Date(e.start_time);
    // 開始35分前を切ったもの → 30分前、35〜65分前 → 1時間前
    const kind = start <= in35m ? '30m' : '1h';
    if (!(await claimEventReminder(`${e.uid}|${e.start_time}`, kind))) continue;

    const t = fmtTime(e.start_time);
    const place = e.location ? `\n📍 ${e.location}` : '';
    const text =
      kind === '1h'
        ? `⏰ 1時間前リマインド\n\n📌 ${e.title}\n🕐 ${t}${place}\n\n準備はいいですか？`
        : `⏰ 30分前リマインド\n\n📌 ${e.title}\n🕐 ${t}${place}\n\nもうすぐです！`;
    await pushMessage(owner, [textMessage(text)]);
  }
}

async function checkTaskReminders(userId: string, now: Date): Promise<void> {
  // 締め切りが「◯日後の終わり」までに入ったら、その段階のリマインドを1回だけ送る
  const endOfDay = (days: number) => jstDayRange(now, days).end;
  const in1d = endOfDay(1);
  const in2d = endOfDay(2);
  const in3d = endOfDay(3);
  const in7d = endOfDay(7);

  type TaskRow = { id: string; title: string; deadline?: string };
  type Flag = 'reminded_week' | 'reminded_3days' | 'reminded_2days' | 'reminded_1day';

  const claim = (flag: Flag, from: Date, to: Date) =>
    query<TaskRow>(
      `UPDATE tasks SET ${flag} = true
       WHERE user_id = $1 AND completed = false AND ${flag} = false
         AND deadline > $2 AND deadline <= $3
       RETURNING id, title, deadline`,
      [userId, from.toISOString(), to.toISOString()]
    );

  const [week, three, two, one] = await Promise.all([
    claim('reminded_week', in3d, in7d),
    claim('reminded_3days', in2d, in3d),
    claim('reminded_2days', in1d, in2d),
    claim('reminded_1day', now, in1d),
  ]);

  const fmtDeadline = (t: TaskRow) =>
    new Date(t.deadline!).toLocaleDateString('ja-JP', {
      month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo',
    });

  for (const t of week) {
    await pushMessage(userId, [textMessage(`📋 タスクリマインド（1週間前）\n\n「${t.title}」\n📆 締め切り: ${fmtDeadline(t)}\n\n計画的に進めましょう！`)]);
  }

  for (const t of three) {
    await pushMessage(userId, [textMessage(`⚠️ タスクリマインド（3日前）\n\n「${t.title}」\n📆 締め切り: ${fmtDeadline(t)}\n\nそろそろ本格的に取り組みましょう！`)]);
  }

  for (const t of two) {
    await pushMessage(userId, [textMessage(`⚠️ タスクリマインド（2日前）\n\n「${t.title}」\n📆 締め切り: ${fmtDeadline(t)}\n\nあと2日です、仕上げに入りましょう！`)]);
  }

  for (const t of one) {
    await pushMessage(userId, [textMessage(`🔴 タスクリマインド（前日・当日）\n\n「${t.title}」\n📆 締め切り: ${fmtDeadline(t)}\n\n締め切りが迫っています！頑張れ！💪`)]);
  }
}
