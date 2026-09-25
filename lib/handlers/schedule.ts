// 予定は iCloud カレンダー（自宅・職場・シフトボード）に直接読み書きする。
// 登録先の聞き返しと、変更・削除の確認は pending_action に保存して次のメッセージで受け取る。

import { savePendingAction, getPendingAction, clearPendingAction, getPendingScan, clearPendingScan } from '@/lib/db';
import {
  listEvents,
  searchEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  CalendarError,
  isWritableCalendar,
  type CalendarEvent,
  type EventInput,
  type WritableCalendar,
} from '@/lib/icloud';
import { jstDayRange } from '@/lib/jst';
import { iphoneCalendarUrl } from '@/lib/calendar-link';

export const CONFIRM_YES = /^(はい|yes|登録(して)?|ok|OK|オッケー|お願い(します?)?|よろしく)[!！。\s]*$/i;
export const CONFIRM_NO  = /^(いいえ|no|キャンセル|やめ(る|て|ます)?|不要|取消|取り消し)[!！。\s]*$/i;

const ASK_CALENDAR = '「職場」と「自宅」、どちらのカレンダーに入れますか？';

type PendingAction =
  | { type: 'add_schedule'; input: EventInput }
  | { type: 'delete_schedule'; id: string; label: string }
  | { type: 'update_schedule'; id: string; changes: Partial<EventInput>; before: string; after: string };

// iCloud カレンダーは中田さん（WEB_USER_ID）専用
export function isCalendarOwner(userId: string): boolean {
  return !!process.env.WEB_USER_ID && userId === process.env.WEB_USER_ID;
}

const NOT_OWNER = '📅 予定の機能は中田さん専用です。';

// ── 表示 ─────────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ja-JP', {
    month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo',
  });
}

export function fmtEventTime(e: Pick<CalendarEvent, 'start_time' | 'all_day'>): string {
  if (e.all_day) return '終日';
  return new Date(e.start_time).toLocaleTimeString('ja-JP', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo',
  });
}

function describe(e: Pick<CalendarEvent, 'title' | 'start_time' | 'all_day' | 'calendar'>): string {
  return `${fmtDate(e.start_time)} ${fmtEventTime(e)} ${e.title}（${e.calendar}）`;
}

// 聞き返しへの短い返事（「職場」「自宅で」「はい、職場にお願いします」など）だけを登録先として受け取る。
// 「明日10時に会議を職場に」のような新しい依頼を、前の予定の返事と取り違えないため
const CALENDAR_REPLY =
  /^(?:はい[、,\s]*)?(職場|自宅)(?:の?カレンダー)?(?:に|へ|で)?(?:お願い(?:します)?|入れて(?:ください)?|登録(?:して)?)?[!！。\s]*$/;

function parseCalendarReply(text: string): WritableCalendar | null {
  const m = text.trim().match(CALENDAR_REPLY);
  return m ? (m[1] as WritableCalendar) : null;
}

// 登録の依頼文に「職場に」「自宅のカレンダーへ」などの明示があるか
function explicitCalendar(text: string): WritableCalendar | null {
  const m = text.match(/(職場|自宅)(の?カレンダー)?(に|へ)/);
  return m ? (m[1] as WritableCalendar) : null;
}

async function withCalendarErrors(fn: () => Promise<string>): Promise<string> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CalendarError) return `⚠️ ${e.message}`;
    throw e;
  }
}

// ── 登録 ─────────────────────────────────────────────────────────────────────

function toInput(data: Record<string, unknown>): EventInput {
  return {
    title: String(data.title),
    start_time: String(data.start_time),
    end_time: data.end_time ? String(data.end_time) : null,
    all_day: data.all_day === true,
    location: data.location ? String(data.location) : null,
    description: data.description ? String(data.description) : null,
  };
}

async function registerEvent(calendar: WritableCalendar, input: EventInput): Promise<string> {
  const ev = await createEvent(calendar, input);
  let reply = `📅 ${calendar}のカレンダーに入れました！\n\n📌 ${ev.title}\n🗓 ${fmtDate(ev.start_time)} ${fmtEventTime(ev)}`;
  if (ev.location) reply += `\n📍 ${ev.location}`;
  if (ev.description) reply += `\n📝 ${ev.description}`;
  reply += ev.all_day
    ? '\n🔔 3日前・2日前・前日の朝9時にiPhoneで通知します'
    : '\n🔔 3日前・2日前・前日・1時間前・30分前にiPhoneで通知します';
  reply += `\n\n📱 カレンダーで見る\n${iphoneCalendarUrl(ev.start_time)}`;
  return reply;
}

export async function addSchedule(
  userId: string,
  data: Record<string, unknown>,
  userMessage: string
): Promise<string> {
  if (!isCalendarOwner(userId)) return NOT_OWNER;
  if (!data.title || !data.start_time) return '予定のタイトルと日時を教えてください。';

  const input = toInput(data);
  const calendar = isWritableCalendar(data.calendar) ? data.calendar : explicitCalendar(userMessage);

  if (!calendar) {
    await savePendingAction(userId, { type: 'add_schedule', input } satisfies PendingAction);
    return `📅 「${input.title}」（${fmtDate(input.start_time)} ${fmtEventTime({ start_time: input.start_time, all_day: !!input.all_day })}）\n\n${ASK_CALENDAR}`;
  }
  return withCalendarErrors(() => registerEvent(calendar, input));
}

// ── 確認 ─────────────────────────────────────────────────────────────────────

export async function getSchedules(userId: string, data: Record<string, unknown>): Promise<string> {
  if (!isCalendarOwner(userId)) return NOT_OWNER;

  let from: Date;
  let to: Date;
  let label: string;
  if (data.date === 'tomorrow') {
    ({ start: from, end: to } = jstDayRange(new Date(), 1));
    label = '明日';
  } else if (data.date === 'week') {
    from = jstDayRange().start;
    to = jstDayRange(new Date(), 7).start;
    label = '今後1週間';
  } else {
    ({ start: from, end: to } = jstDayRange());
    label = '今日';
  }

  return withCalendarErrors(async () => {
    const events = await listEvents(from, to);
    const link = `📱 カレンダーを開く\n${iphoneCalendarUrl(from)}`;
    if (!events.length) return `📅 ${label}の予定はありません。\n\n「明日14時に会議を職場に」などと送ると追加できます！\n\n${link}`;

    const multiDay = data.date === 'week';
    const list = events
      .map((e) => {
        const when = multiDay ? `${fmtDate(e.start_time)} ${fmtEventTime(e)}` : fmtEventTime(e);
        return `・${when} ${e.title}${e.location ? ` 📍${e.location}` : ''}［${e.calendar}］`;
      })
      .join('\n');
    return `📅 ${label}の予定（${events.length}件）\n\n${list}\n\n${link}`;
  });
}

// ── 変更・削除（確認してから実行）──────────────────────────────────────────────

async function findTarget(query: string): Promise<CalendarEvent | string> {
  const from = jstDayRange().start;
  const to = new Date(from.getTime() + 365 * 24 * 60 * 60 * 1000);
  const hits = await searchEvents(query, from, to);
  if (!hits.length) return `「${query}」に該当する予定が見つかりませんでした（職場・自宅の今日以降の予定から探しています）。`;
  const target = hits.find((e) => !e.read_only);
  if (!target) return `「${hits[0].title}」は繰り返し予定なので、iPhoneのカレンダーから変更してください🙏`;
  return target;
}

export async function deleteSchedule(userId: string, data: Record<string, unknown>): Promise<string> {
  if (!isCalendarOwner(userId)) return NOT_OWNER;
  if (!data.query) return '削除する予定名を教えてください。';

  return withCalendarErrors(async () => {
    const target = await findTarget(String(data.query));
    if (typeof target === 'string') return target;

    const label = describe(target);
    await savePendingAction(userId, { type: 'delete_schedule', id: target.id, label } satisfies PendingAction);
    return `🗑️ この予定を削除しますか？\n\n${label}\n\n「はい」で削除、「いいえ」でキャンセル`;
  });
}

export async function updateSchedule(userId: string, data: Record<string, unknown>): Promise<string> {
  if (!isCalendarOwner(userId)) return NOT_OWNER;
  if (!data.query) return '変更する予定名を教えてください。';

  const changes: Partial<EventInput> = {};
  if (data.title) changes.title = String(data.title);
  if (data.start_time) changes.start_time = String(data.start_time);
  if (data.end_time) changes.end_time = String(data.end_time);
  if (data.location) changes.location = String(data.location);
  if (!Object.keys(changes).length) return 'どう変更するか教えてください。\n\n例：「会議を15時に変更」';

  return withCalendarErrors(async () => {
    const target = await findTarget(String(data.query));
    if (typeof target === 'string') return target;

    const before = describe(target);
    const startChanged = changes.start_time ?? target.start_time;
    const after =
      `${fmtDate(startChanged)} ${changes.start_time ? fmtEventTime({ start_time: startChanged, all_day: false }) : fmtEventTime(target)} ` +
      `${changes.title ?? target.title}（${target.calendar}）` +
      (changes.location ? ` 📍${changes.location}` : '');
    await savePendingAction(userId, { type: 'update_schedule', id: target.id, changes, before, after } satisfies PendingAction);
    return `✏️ この予定を変更しますか？\n\n変更前：${before}\n変更後：${after}\n\n「はい」で変更、「いいえ」でキャンセル`;
  });
}

// 確認待ちへの返事なら処理して返信文を返す。関係ないメッセージなら null（確認待ちは破棄）
export async function handlePendingScheduleReply(userId: string, message: string): Promise<string | null> {
  const pending = await getPendingAction<PendingAction>(userId);
  if (!pending) return null;

  if (CONFIRM_NO.test(message)) {
    await clearPendingAction(userId);
    return 'キャンセルしました👌';
  }

  if (pending.type === 'add_schedule') {
    const calendar = parseCalendarReply(message);
    if (!calendar) {
      if (CONFIRM_YES.test(message)) return ASK_CALENDAR;
      await clearPendingAction(userId);
      return null;
    }
    await clearPendingAction(userId);
    return withCalendarErrors(() => registerEvent(calendar, pending.input));
  }

  if (!CONFIRM_YES.test(message)) {
    await clearPendingAction(userId);
    return null;
  }
  await clearPendingAction(userId);

  if (pending.type === 'delete_schedule') {
    return withCalendarErrors(async () => {
      await deleteEvent(pending.id);
      return `🗑️ 予定を削除しました\n\n${pending.label}`;
    });
  }

  return withCalendarErrors(async () => {
    await updateEvent(pending.id, pending.changes);
    return `✏️ 予定を変更しました\n\n${pending.after}`;
  });
}

// ── 画像から読み取った予定の一括登録 ─────────────────────────────────────────

export const ASK_SCAN_CALENDAR = '登録するなら「職場」か「自宅」と返信してください（「いいえ」でキャンセル）';

// 画像スキャンの確認待ちへの返事なら処理して返信文を返す。関係ないメッセージなら null
export async function handlePendingScanReply(userId: string, message: string): Promise<string | null> {
  const calendar = parseCalendarReply(message);
  const isYes = CONFIRM_YES.test(message);
  const isNo = CONFIRM_NO.test(message);
  if (!calendar && !isYes && !isNo) return null;

  const pending = await getPendingScan(userId);
  if (!pending) return null;

  if (isNo) {
    await clearPendingScan(userId);
    return 'キャンセルしました。また画像を送ってください😊';
  }
  if (!calendar) return ASK_SCAN_CALENDAR;
  if (!isCalendarOwner(userId)) {
    await clearPendingScan(userId);
    return NOT_OWNER;
  }

  await clearPendingScan(userId);
  const targets = pending.filter((s) => s.start_time && !s.needs_confirmation);
  if (!targets.length) return '日時が確定している予定がありませんでした。\n別の画像をお試しください。';

  return withCalendarErrors(async () => {
    let registered = 0;
    for (const s of targets) {
      try {
        await createEvent(calendar, {
          title: s.title,
          start_time: s.start_time!,
          end_time: s.end_time,
          location: s.location,
          description: s.description,
        });
        registered++;
      } catch (e) {
        console.error('[scan register error]', e);
      }
    }
    const failed = targets.length - registered;
    return `✅ ${calendar}のカレンダーに${registered}件の予定を登録しました！${failed ? `\n⚠️ ${failed}件は登録できませんでした` : ''}\n\n📱 カレンダーで見る\n${iphoneCalendarUrl(targets[0].start_time!)}`;
  });
}
