import { query, getUserDisplayName, getUser } from '@/lib/db';
import { pushMessage, textMessage } from '@/lib/line';
import { generateEveningMessage, generateWeeklySummary } from '@/lib/claude';
import { Schedule, Task, ShoppingItem, Habit } from '@/types';

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
  return MORNING_ONE_LINERS[new Date().getDay()];
}

const PRIORITY_LABEL: Record<number, string> = { 1: '最低', 2: '低', 3: '中', 4: '高', 5: '最高' };

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
}

function fmtTimeOrAllDay(iso: string): string {
  const t = fmtTime(iso);
  return t === '00:00' ? '終日' : t;
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

  // 今週末（日曜）23:59:59 を計算（月〜日を1週間とする）
  const dow = now.getDay(); // 0=日, 1=月, ..., 6=土
  const daysUntilSunday = dow === 0 ? 0 : 7 - dow;
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + daysUntilSunday);
  weekEnd.setHours(23, 59, 59, 999);

  const [
    todayScheds,
    weekScheds,
    todayTasks,
    weekTasks,
    importantTasks,
    shoppingItems,
    restockItems,
  ] = await Promise.all([
    // 今日の予定（時間順）
    query<Schedule>(
      `SELECT id, title, start_time, location FROM schedules
       WHERE user_id = $1 AND start_time >= $2 AND start_time <= $3
       ORDER BY start_time`,
      [userId, todayStart.toISOString(), todayEnd.toISOString()]
    ),
    // 今週の予定（今日〜今週末）
    query<Schedule>(
      `SELECT id, title, start_time, location FROM schedules
       WHERE user_id = $1 AND start_time >= $2 AND start_time <= $3
       ORDER BY start_time`,
      [userId, todayStart.toISOString(), weekEnd.toISOString()]
    ),
    // 今日締め切りのタスク
    query<Task>(
      `SELECT id, title, priority, deadline FROM tasks
       WHERE user_id = $1 AND completed = false AND deadline IS NOT NULL AND deadline <= $2
       ORDER BY priority DESC`,
      [userId, todayEnd.toISOString()]
    ),
    // 今週締め切りのタスク（明日〜今週末）
    query<Task>(
      `SELECT id, title, priority, deadline FROM tasks
       WHERE user_id = $1 AND completed = false AND deadline > $2 AND deadline <= $3
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

  // 今日・今週締め切りに既出のタスクIDを除外して重複を防ぐ
  const shownTaskIds = new Set([
    ...todayTasks.map((t) => t.id),
    ...weekTasks.map((t) => t.id),
  ]);
  const topTasks = importantTasks.filter((t) => !shownTaskIds.has(t.id));

  const lines: string[] = [];

  // ── ヘッダー ──
  const dateLabel = now.toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });
  lines.push(`おはようございます、中田さん！☀️`);
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

  // ── 今週の予定（今日〜週末） ──
  lines.push('');
  lines.push('━━━ 📆 今週の予定 ━━━');
  if (weekScheds.length === 0) {
    lines.push('今週の予定はまだありません');
  } else {
    for (const s of weekScheds) {
      lines.push(`・${fmtDateShort(s.start_time)} ${fmtTimeOrAllDay(s.start_time)} ${s.title}${s.location ? `（${s.location}）` : ''}`);
    }
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
  lines.push('📅 カレンダーで詳しく見る');
  lines.push('https://secretary-app-bay.vercel.app/calendar');

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

  const [displayName, counts, tomorrowSchedules] = await Promise.all([
    getUserDisplayName(userId),
    countTasks(userId, todayStart),
    query<Schedule>(
      `SELECT title, start_time, location FROM schedules
       WHERE user_id = $1 AND start_time >= $2 AND start_time <= $3
       ORDER BY start_time ASC`,
      [userId, tomorrowStart.toISOString(), tomorrowEnd.toISOString()]
    ),
  ]);

  return generateEveningMessage({
    displayName,
    tomorrowSchedules,
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
  const now = jstNow();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const nextWeekEnd = new Date(now);
  nextWeekEnd.setDate(nextWeekEnd.getDate() + 7);

  const [displayName, counts, habits, upcomingSchedules] = await Promise.all([
    getUserDisplayName(userId),
    countTasks(userId, weekAgo),
    query<Habit>(
      'SELECT name, streak FROM habits WHERE user_id = $1 ORDER BY streak DESC LIMIT 5',
      [userId]
    ),
    query<Schedule>(
      `SELECT title, start_time FROM schedules
       WHERE user_id = $1 AND start_time >= $2 AND start_time <= $3
       ORDER BY start_time ASC LIMIT 5`,
      [userId, now.toISOString(), nextWeekEnd.toISOString()]
    ),
  ]);

  return generateWeeklySummary({
    displayName,
    completedTasks: counts.completed,
    pendingTasks: counts.pending,
    habits,
    upcomingSchedules,
  });
}

// ───────────────────────────── 手動リマインド確認 ─────────────────────────────

export async function getCheckReminders(userId: string): Promise<string> {
  const now = jstNow();
  const in24h = new Date(now);
  in24h.setHours(in24h.getHours() + 24);

  const [schedules, tasks] = await Promise.all([
    query<Schedule>(
      `SELECT title, start_time, location FROM schedules
       WHERE user_id = $1 AND start_time >= $2 AND start_time <= $3
       ORDER BY start_time ASC LIMIT 5`,
      [userId, now.toISOString(), in24h.toISOString()]
    ),
    query<Task>(
      `SELECT title, deadline FROM tasks
       WHERE user_id = $1 AND completed = false AND deadline IS NOT NULL AND deadline <= $2
       ORDER BY deadline ASC LIMIT 5`,
      [userId, in24h.toISOString()]
    ),
  ]);

  const lines: string[] = [];

  if (schedules.length) {
    lines.push('📅 今後24時間の予定:');
    for (const s of schedules) {
      const t = new Date(s.start_time).toLocaleTimeString('ja-JP', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Tokyo',
      });
      lines.push(`・${t} ${s.title}${s.location ? ` (${s.location})` : ''}`);
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
    query<ScheduleRow>(
      `SELECT id, title, start_time, location FROM schedules
       WHERE user_id = $1 AND reminded_1h = false AND start_time >= $2 AND start_time <= $3`,
      [userId, in55m.toISOString(), in65m.toISOString()]
    ),
    query<ScheduleRow>(
      `SELECT id, title, start_time, location FROM schedules
       WHERE user_id = $1 AND reminded_30m = false AND start_time >= $2 AND start_time <= $3`,
      [userId, in25m.toISOString(), in35m.toISOString()]
    ),
  ]);

  for (const s of res1h) {
    const t = new Date(s.start_time).toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Tokyo',
    });
    await Promise.all([
      pushMessage(userId, [
        textMessage(`⏰ 1時間前リマインド\n\n📌 ${s.title}\n🕐 ${t}${s.location ? `\n📍 ${s.location}` : ''}\n\n準備はいいですか？`),
      ]),
      query('UPDATE schedules SET reminded_1h = true WHERE id = $1', [s.id]),
    ]);
  }

  for (const s of res30m) {
    const t = new Date(s.start_time).toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Tokyo',
    });
    await Promise.all([
      pushMessage(userId, [
        textMessage(`⏰ 30分前リマインド\n\n📌 ${s.title}\n🕐 ${t}${s.location ? `\n📍 ${s.location}` : ''}\n\nもうすぐです！`),
      ]),
      query('UPDATE schedules SET reminded_30m = true WHERE id = $1', [s.id]),
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

  type TaskRow = { id: string; title: string; deadline?: string };

  const [week, three, one] = await Promise.all([
    query<TaskRow>(
      `SELECT id, title, deadline FROM tasks
       WHERE user_id = $1 AND completed = false AND reminded_week = false
         AND deadline >= $2 AND deadline <= $3`,
      [userId, in3d.toISOString(), in7d.toISOString()]
    ),
    query<TaskRow>(
      `SELECT id, title, deadline FROM tasks
       WHERE user_id = $1 AND completed = false AND reminded_3days = false
         AND deadline >= $2 AND deadline <= $3`,
      [userId, in1d.toISOString(), in3d.toISOString()]
    ),
    query<TaskRow>(
      `SELECT id, title FROM tasks
       WHERE user_id = $1 AND completed = false AND reminded_1day = false
         AND deadline >= $2 AND deadline <= $3`,
      [userId, jst.toISOString(), in1d.toISOString()]
    ),
  ]);

  for (const t of week) {
    const dl = new Date(t.deadline!).toLocaleDateString('ja-JP', {
      month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo',
    });
    await Promise.all([
      pushMessage(userId, [textMessage(`📋 タスクリマインド（1週間前）\n\n「${t.title}」\n📆 締め切り: ${dl}\n\n計画的に進めましょう！`)]),
      query('UPDATE tasks SET reminded_week = true WHERE id = $1', [t.id]),
    ]);
  }

  for (const t of three) {
    const dl = new Date(t.deadline!).toLocaleDateString('ja-JP', {
      month: 'numeric', day: 'numeric', timeZone: 'Asia/Tokyo',
    });
    await Promise.all([
      pushMessage(userId, [textMessage(`⚠️ タスクリマインド（3日前）\n\n「${t.title}」\n📆 締め切り: ${dl}\n\nそろそろ本格的に取り組みましょう！`)]),
      query('UPDATE tasks SET reminded_3days = true WHERE id = $1', [t.id]),
    ]);
  }

  for (const t of one) {
    await Promise.all([
      pushMessage(userId, [textMessage(`🔴 タスクリマインド（前日・当日）\n\n「${t.title}」\n\n締め切りが迫っています！頑張れ！💪`)]),
      query('UPDATE tasks SET reminded_1day = true WHERE id = $1', [t.id]),
    ]);
  }
}
