// 毎朝7時に LINE で送る通知の本文（app/api/cron/remind から呼ぶ）。1日1通。
// 「あるときだけ出す」：見張り・（月曜だけ）今週のまとめ・今日の予定・今日/今週の締め切り・（いれば）今週の誕生日。
// 明日の予定と天気は前の晩22時の通知で送っているので、ここでは出さない。
// 出すものが何もない日は null を返し、送らない（LINE の無料枠を節約）。

import { query } from '@/lib/db';
import { listEvents, type CalendarEvent } from '@/lib/icloud';
import { jstDayRange, jstWeekday, jstDateString } from '@/lib/jst';
import { iphoneCalendarUrl } from '@/lib/calendar-link';
import { fmtEventTime } from '@/lib/handlers/schedule';
import { checkHeartbeat } from '@/lib/watchdog';

const WEEK_SUMMARY_EVENTS = 3;
const LIST_MAX = 5; // 締め切りの一覧はこれ以上は「ほか◯件」

// 件名にこれらが入っている予定を「大事そう」とみなす（月曜のまとめ用）
const IMPORTANT = /テスト|試験|模試|検定|面談|懇談|保護者|会議|説明会|締切|〆切|締め切り|提出|発表|本番|病院|歯医者|健診|手術|支払|振込|契約|引っ越し|旅行|式|誕生日|記念日|面接/;

function fmtDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('ja-JP', {
    month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo',
  });
}

function fmtShortDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Tokyo' });
}

function byImportance(events: CalendarEvent[]): CalendarEvent[] {
  const score = (e: CalendarEvent) => (IMPORTANT.test(e.title) ? 2 : 0) + (e.calendar === '職場' ? 1 : 0);
  return [...events].sort((a, b) => score(b) - score(a) || a.start_time.localeCompare(b.start_time));
}

async function birthdaysThisWeek(userId: string, now: Date, weekEnd: Date) {
  const rows = await query<{ name: string; birth_date: string }>(
    'SELECT name, birth_date FROM birthdays WHERE user_id = $1',
    [userId]
  );
  const todayStr = jstDateString(now);
  const year = Number(todayStr.slice(0, 4));
  return rows
    .map((b) => {
      const md = b.birth_date.slice(5, 10);
      let next = new Date(`${year}-${md}T00:00:00+09:00`);
      if (jstDateString(next) < todayStr) next = new Date(`${year + 1}-${md}T00:00:00+09:00`);
      return { name: b.name, date: next };
    })
    .filter((b) => b.date < weekEnd)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

export async function buildMorningNotice(userId: string, now: Date = new Date()): Promise<string | null> {
  const today = jstDayRange(now, 0);
  const weekday = jstWeekday(now); // 0=日 … 6=土
  const weekEnd = jstDayRange(now, weekday === 0 ? 0 : 7 - weekday).end; // 今週の日曜の終わり
  const todayStr = jstDateString(now);
  const isMonday = weekday === 1;

  const [eventsRes, tasksRes, birthdaysRes, watchRes] = await Promise.allSettled([
    listEvents(today.start, isMonday ? weekEnd : today.end),
    query<{ title: string; deadline: string }>(
      `SELECT title, deadline FROM tasks
       WHERE user_id = $1 AND completed = false AND deadline IS NOT NULL AND deadline < $2
       ORDER BY deadline`,
      [userId, weekEnd.toISOString()]
    ),
    birthdaysThisWeek(userId, now, weekEnd),
    checkHeartbeat(userId, now, 'collect'),
  ]);
  for (const r of [eventsRes, tasksRes, birthdaysRes, watchRes]) {
    if (r.status === 'rejected') console.error('[morning notice]', r.reason);
  }

  const events = eventsRes.status === 'fulfilled' ? eventsRes.value : null;
  const tasks = tasksRes.status === 'fulfilled' ? tasksRes.value : [];
  const todayEvents = (events ?? []).filter((e) => {
    const s = new Date(e.start_time);
    return s >= today.start && s < today.end;
  });
  const dueToday = tasks.filter((t) => new Date(t.deadline) < today.end); // 期限切れも含む
  const dueThisWeek = tasks.filter((t) => new Date(t.deadline) >= today.end);

  const body: string[] = [];

  // ── 見張り（止まっている・夜中に止まっていた）──
  const watch = watchRes.status === 'fulfilled' ? watchRes.value : [];
  if (watch.length) body.push('', ...watch);

  // ── 月曜：今週のまとめ ──
  if (isMonday) {
    const week = (events ?? []).filter((e) => e.calendar !== 'シフトボード');
    const big = byImportance(week).slice(0, WEEK_SUMMARY_EVENTS);
    const summary: string[] = [];
    if (big.length) {
      summary.push(`📅 ${big.map((e) => `${fmtShortDate(e.start_time)} ${e.title}`).join('、')}${week.length > big.length ? ` ほか${week.length - big.length}件` : ''}`);
    }
    if (tasks.length) {
      summary.push(`⏰ 締め切り${tasks.length}件：${tasks.slice(0, 2).map((t) => `${t.title}（${fmtShortDate(t.deadline)}）`).join('、')}${tasks.length > 2 ? ' ほか' : ''}`);
    }
    if (summary.length) body.push('', '【今週のまとめ】', ...summary);
  }

  // ── 今日の予定 ──
  if (!events) {
    body.push('', '📅 カレンダーを読み込めませんでした');
  } else if (todayEvents.length) {
    body.push('', '【今日の予定】');
    for (const e of todayEvents) body.push(`・${fmtEventTime(e)} ${e.title}${e.location ? `（${e.location}）` : ''}`);
  }

  // ── 締め切り（月曜の「今週」はまとめに入れたので、今日の分だけ）──
  if (dueToday.length) {
    body.push('', '【今日までの締め切り】');
    for (const t of dueToday.slice(0, LIST_MAX)) {
      const overdue = jstDateString(new Date(t.deadline)) < todayStr;
      body.push(`・${t.title}${overdue ? `（${fmtShortDate(t.deadline)}〆・期限切れ）` : ''}`);
    }
    if (dueToday.length > LIST_MAX) body.push(`（ほか${dueToday.length - LIST_MAX}件）`);
  }
  if (!isMonday && dueThisWeek.length) {
    body.push('', '【今週の締め切り】');
    for (const t of dueThisWeek.slice(0, LIST_MAX)) body.push(`・${fmtDate(t.deadline)} ${t.title}`);
    if (dueThisWeek.length > LIST_MAX) body.push(`（ほか${dueThisWeek.length - LIST_MAX}件）`);
  }

  // ── 今週の誕生日 ──
  const birthdays = birthdaysRes.status === 'fulfilled' ? birthdaysRes.value : [];
  if (birthdays.length) {
    body.push('', '🎂 今週の誕生日');
    for (const b of birthdays) {
      const isToday = jstDateString(b.date) === todayStr;
      body.push(`・${b.name}さん ${fmtDate(b.date)}${isToday ? '（今日！）' : ''}`);
    }
  }

  if (!body.length) return null;
  const calendarLink = todayEvents.length ? ['', `📱 カレンダーを開く\n${iphoneCalendarUrl()}`] : [];
  return ['おはようございます、中田さん！☀️', ...body, ...calendarLink].join('\n');
}
