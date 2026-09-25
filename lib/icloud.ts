// iCloud カレンダー（CalDAV）の読み書き。
// ※ secretary-app/lib/icloud.ts と同じ内容。変更するときは両方そろえる。
//
// 認証は Apple ID（ICLOUD_USERNAME）と App 用パスワード（ICLOUD_APP_PASSWORD）。
// 書き込みは「自宅」「職場」だけ。読み取りはそれに「シフトボード」を加えた3つ。
// 繰り返し予定とシフトボードは読み取り専用（変更は iPhone / Mac のカレンダーで行う）。

import { DAVClient, type DAVCalendar, type DAVCalendarObject } from 'tsdav';
import ICAL from 'ical.js';
import { randomUUID } from 'node:crypto';

export const WRITABLE_CALENDARS = ['自宅', '職場'] as const;
export const READABLE_CALENDARS = ['自宅', '職場', 'シフトボード'] as const;
export type WritableCalendar = (typeof WRITABLE_CALENDARS)[number];

export interface CalendarEvent {
  id: string;             // 変更・削除に使う識別子（イベントの URL と開始時刻をエンコード）
  calendar: string;
  title: string;
  start_time: string;     // ISO 8601（終日予定は JST 0:00）
  end_time: string | null;
  all_day: boolean;
  location: string | null;
  description: string | null;
  recurring: boolean;
  read_only: boolean;     // シフトボード・繰り返し予定は true
  uid: string;
}

export interface EventInput {
  title: string;
  start_time: string;
  end_time?: string | null;
  all_day?: boolean;
  location?: string | null;
  description?: string | null;
}

export class CalendarError extends Error {}

export function isWritableCalendar(name: unknown): name is WritableCalendar {
  return WRITABLE_CALENDARS.includes(name as WritableCalendar);
}

// ── 接続 ─────────────────────────────────────────────────────────────────────

let clientPromise: Promise<DAVClient> | null = null;
let calendarsCache: { at: number; list: DAVCalendar[] } | null = null;
const CALENDAR_CACHE_MS = 10 * 60 * 1000;

function getClient(): Promise<DAVClient> {
  const username = process.env.ICLOUD_USERNAME;
  const password = process.env.ICLOUD_APP_PASSWORD;
  if (!username || !password) {
    return Promise.reject(new CalendarError('ICLOUD_USERNAME / ICLOUD_APP_PASSWORD が未設定です'));
  }
  clientPromise ??= (async () => {
    const client = new DAVClient({
      serverUrl: 'https://caldav.icloud.com',
      credentials: { username, password },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });
    await client.login();
    return client;
  })().catch((e) => {
    clientPromise = null;
    throw e;
  });
  return clientPromise;
}

function displayName(cal: DAVCalendar): string {
  return typeof cal.displayName === 'string' ? cal.displayName : '';
}

async function getCalendars(): Promise<DAVCalendar[]> {
  if (calendarsCache && Date.now() - calendarsCache.at < CALENDAR_CACHE_MS) return calendarsCache.list;
  const client = await getClient();
  const list = await client.fetchCalendars();
  calendarsCache = { at: Date.now(), list };
  return list;
}

async function findCalendar(name: string): Promise<DAVCalendar> {
  const cal = (await getCalendars()).find((c) => displayName(c) === name);
  if (!cal) throw new CalendarError(`iCloud に「${name}」カレンダーが見つかりません`);
  return cal;
}

// 接続確認用：iCloud 上のカレンダー名一覧
export async function listCalendarNames(): Promise<string[]> {
  return (await getCalendars()).map(displayName);
}

// ── ID ───────────────────────────────────────────────────────────────────────

interface EventRef {
  url: string;
  start?: string; // 繰り返し予定の回の開始時刻
}

function encodeId(ref: EventRef): string {
  return Buffer.from(JSON.stringify(ref)).toString('base64url');
}

function decodeId(id: string): EventRef {
  try {
    const ref = JSON.parse(Buffer.from(id, 'base64url').toString('utf8'));
    if (typeof ref?.url === 'string') return ref;
  } catch { /* fallthrough */ }
  throw new CalendarError('予定の ID が正しくありません');
}

// ── iCalendar の解析 ─────────────────────────────────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// ICAL.Time → Date。終日・タイムゾーンなし（floating）の時刻は JST とみなす
function toDate(t: ICAL.Time): Date {
  if (t.isDate) return new Date(`${t.year}-${pad(t.month)}-${pad(t.day)}T00:00:00+09:00`);
  const tzid = t.zone?.tzid;
  if (!tzid || tzid === 'floating') {
    return new Date(
      `${t.year}-${pad(t.month)}-${pad(t.day)}T${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}+09:00`
    );
  }
  return t.toJSDate();
}

function parseCalendarData(data: string): ICAL.Component {
  const vcal = new ICAL.Component(ICAL.parse(data));
  for (const tz of vcal.getAllSubcomponents('vtimezone')) {
    const tzid = tz.getFirstPropertyValue('tzid');
    if (typeof tzid === 'string' && !ICAL.TimezoneService.has(tzid)) {
      ICAL.TimezoneService.register(tz);
    }
  }
  return vcal;
}

function textOrNull(value: string | null | undefined): string | null {
  return value ? String(value) : null;
}

// テスト・内部用：カレンダーオブジェクト1件から from〜to の予定（回）を取り出す
export function occurrencesOf(
  obj: DAVCalendarObject,
  calendar: string,
  from: Date,
  to: Date
): CalendarEvent[] {
  if (!obj.data) return [];
  let vcal: ICAL.Component;
  try {
    vcal = parseCalendarData(obj.data);
  } catch (e) {
    console.error('[icloud] parse error', obj.url, e);
    return [];
  }

  const vevents = vcal.getAllSubcomponents('vevent');
  const master = vevents.find((v) => !v.hasProperty('recurrence-id'));
  const readOnlyCalendar = !isWritableCalendar(calendar);

  const build = (ev: ICAL.Event, start: ICAL.Time, end: ICAL.Time | null, recurring: boolean): CalendarEvent => {
    const startDate = toDate(start);
    return {
      id: encodeId({ url: obj.url, ...(recurring ? { start: startDate.toISOString() } : {}) }),
      calendar,
      title: ev.summary || '（無題）',
      start_time: startDate.toISOString(),
      end_time: end ? toDate(end).toISOString() : null,
      all_day: start.isDate,
      location: textOrNull(ev.location),
      description: textOrNull(ev.description),
      recurring,
      read_only: readOnlyCalendar || recurring,
      uid: ev.uid,
    };
  };

  const overlaps = (s: Date, e: Date) => s < to && e > from;
  const result: CalendarEvent[] = [];

  if (!master) {
    // 親のない単発の変更回だけが入っているケース
    for (const v of vevents) {
      const ev = new ICAL.Event(v);
      const s = toDate(ev.startDate);
      const e = ev.endDate ? toDate(ev.endDate) : s;
      if (overlaps(s, e.getTime() === s.getTime() ? new Date(s.getTime() + 1) : e)) result.push(build(ev, ev.startDate, ev.endDate, true));
    }
    return result;
  }

  const ev = new ICAL.Event(master, { exceptions: vevents.filter((v) => v !== master) });

  if (!ev.isRecurring()) {
    const s = toDate(ev.startDate);
    const e = ev.endDate ? toDate(ev.endDate) : s;
    if (overlaps(s, e.getTime() === s.getTime() ? new Date(s.getTime() + 1) : e)) {
      result.push(build(ev, ev.startDate, ev.endDate, false));
    }
    return result;
  }

  const it = ev.iterator();
  for (let i = 0, next = it.next(); next && i < 5000; i++, next = it.next()) {
    const d = ev.getOccurrenceDetails(next);
    const s = toDate(d.startDate);
    if (s >= to) break;
    const e = toDate(d.endDate);
    if (overlaps(s, e.getTime() === s.getTime() ? new Date(s.getTime() + 1) : e)) {
      result.push(build(d.item, d.startDate, d.endDate, true));
    }
  }
  return result;
}

// ── 読み取り ─────────────────────────────────────────────────────────────────

// from 〜 to に重なる予定（開始時刻順）。見つからないカレンダーは飛ばす
export async function listEvents(
  from: Date,
  to: Date,
  calendars: readonly string[] = READABLE_CALENDARS
): Promise<CalendarEvent[]> {
  const client = await getClient();
  const all = await getCalendars();

  const perCalendar = await Promise.all(
    calendars.map(async (name) => {
      const cal = all.find((c) => displayName(c) === name);
      if (!cal) {
        console.warn(`[icloud] calendar not found: ${name}`);
        return [];
      }
      const objects = await client.fetchCalendarObjects({
        calendar: cal,
        timeRange: { start: from.toISOString(), end: to.toISOString() },
      });
      return objects.flatMap((o) => occurrencesOf(o, name, from, to));
    })
  );

  return perCalendar.flat().sort((a, b) => a.start_time.localeCompare(b.start_time));
}

// タイトルに query を含む予定（書き込み可能なカレンダーのみ、近い順）
export async function searchEvents(query: string, from: Date, to: Date): Promise<CalendarEvent[]> {
  const q = query.toLowerCase();
  const events = await listEvents(from, to, WRITABLE_CALENDARS);
  return events.filter((e) => e.title.toLowerCase().includes(q));
}

async function fetchObject(ref: EventRef): Promise<{ object: DAVCalendarObject; calendar: string }> {
  const client = await getClient();
  const cal = (await getCalendars()).find((c) => ref.url.startsWith(c.url));
  if (!cal) throw new CalendarError('予定のカレンダーが見つかりません');
  const [object] = await client.fetchCalendarObjects({ calendar: cal, objectUrls: [ref.url] });
  if (!object?.data) throw new CalendarError('予定が見つかりません（削除された可能性があります）');
  return { object, calendar: displayName(cal) };
}

export async function getEvent(id: string): Promise<CalendarEvent | null> {
  const ref = decodeId(id);
  const { object, calendar } = await fetchObject(ref);
  const events = occurrencesOf(object, calendar, new Date(0), new Date('2100-01-01'));
  return events.find((e) => e.id === id) ?? events[0] ?? null;
}

// ── 書き込み ─────────────────────────────────────────────────────────────────

function toICalTime(iso: string, allDay: boolean): ICAL.Time {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new CalendarError(`日時が正しくありません: ${iso}`);
  if (allDay) {
    const [y, m, day] = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' }).split('-').map(Number);
    return ICAL.Time.fromData({ year: y, month: m, day, isDate: true });
  }
  return ICAL.Time.fromJSDate(d, true);
}

function setText(comp: ICAL.Component, name: string, value: string | null | undefined) {
  if (value) comp.updatePropertyWithValue(name, value);
  else comp.removeAllProperties(name);
}

function applyTimes(comp: ICAL.Component, start: string, end: string | null | undefined, allDay: boolean) {
  const ev = new ICAL.Event(comp);
  const startTime = toICalTime(start, allDay);
  let endTime: ICAL.Time;
  if (end) {
    endTime = toICalTime(end, allDay);
  } else {
    endTime = startTime.clone();
    if (allDay) endTime.adjust(1, 0, 0, 0);
    else endTime.adjust(0, 1, 0, 0);
  }
  if (allDay && endTime.compare(startTime) <= 0) {
    endTime = startTime.clone();
    endTime.adjust(1, 0, 0, 0);
  }
  comp.removeAllProperties('duration');
  ev.startDate = startTime;
  ev.endDate = endTime;
}

function utcNow(): ICAL.Time {
  return ICAL.Time.fromJSDate(new Date(), true);
}

function touch(comp: ICAL.Component) {
  comp.updatePropertyWithValue('dtstamp', utcNow());
  comp.updatePropertyWithValue('last-modified', utcNow());
}

// 新しい予定の VCALENDAR を組み立てる
export function buildNewEvent(
  uid: string,
  input: EventInput,
  alarmMinutes: readonly number[]
): ICAL.Component {
  const vcal = new ICAL.Component(['vcalendar', [], []]);
  vcal.updatePropertyWithValue('version', '2.0');
  vcal.updatePropertyWithValue('prodid', '-//nakada//line-secretary-bot//JA');
  vcal.updatePropertyWithValue('calscale', 'GREGORIAN');

  const vevent = new ICAL.Component('vevent');
  vevent.updatePropertyWithValue('uid', uid);
  vevent.updatePropertyWithValue('created', utcNow());
  touch(vevent);
  vevent.updatePropertyWithValue('summary', input.title);
  applyTimes(vevent, input.start_time, input.end_time, !!input.all_day);
  setText(vevent, 'location', input.location);
  setText(vevent, 'description', input.description);

  // 終日予定には「◯分前」の通知を付けない
  if (!input.all_day) {
    for (const min of alarmMinutes) {
      const alarm = new ICAL.Component('valarm');
      alarm.updatePropertyWithValue('action', 'DISPLAY');
      alarm.updatePropertyWithValue('description', input.title);
      alarm.updatePropertyWithValue('trigger', ICAL.Duration.fromSeconds(-min * 60));
      vevent.addSubcomponent(alarm);
    }
  }
  vcal.addSubcomponent(vevent);
  return vcal;
}


export async function createEvent(
  calendarName: WritableCalendar,
  input: EventInput,
  alarmMinutes: readonly number[] = [60, 30]
): Promise<CalendarEvent> {
  if (!isWritableCalendar(calendarName)) throw new CalendarError(`「${calendarName}」には書き込めません`);
  const client = await getClient();
  const cal = await findCalendar(calendarName);

  const uid = randomUUID().toUpperCase();
  const vcal = buildNewEvent(uid, input, alarmMinutes);

  const filename = `${uid}.ics`;
  const res = await client.createCalendarObject({ calendar: cal, filename, iCalString: vcal.toString() });
  if (!res.ok) throw new CalendarError(`iCloud への登録に失敗しました（HTTP ${res.status}）`);

  const url = new URL(filename, cal.url.endsWith('/') ? cal.url : `${cal.url}/`).href;
  const startDate = toDate(toICalTime(input.start_time, !!input.all_day));
  return {
    id: encodeId({ url }),
    calendar: calendarName,
    title: input.title,
    start_time: startDate.toISOString(),
    end_time: input.end_time ? new Date(input.end_time).toISOString() : null,
    all_day: !!input.all_day,
    location: input.location ?? null,
    description: input.description ?? null,
    recurring: false,
    read_only: false,
    uid,
  };
}

async function editableObject(id: string) {
  const ref = decodeId(id);
  if (ref.start) throw new CalendarError('繰り返し予定は iPhone のカレンダーから変更してください');
  const { object, calendar } = await fetchObject(ref);
  if (!isWritableCalendar(calendar)) throw new CalendarError(`「${calendar}」の予定は変更できません`);
  const vcal = parseCalendarData(object.data);
  const vevents = vcal.getAllSubcomponents('vevent');
  const master = vevents.find((v) => !v.hasProperty('recurrence-id'));
  if (!master || vevents.length > 1 || master.hasProperty('rrule')) {
    throw new CalendarError('繰り返し予定は iPhone のカレンダーから変更してください');
  }
  return { object, calendar, vcal, master };
}

export async function updateEvent(id: string, changes: Partial<EventInput>): Promise<CalendarEvent> {
  const client = await getClient();
  const { object, calendar, vcal, master } = await editableObject(id);
  const current = new ICAL.Event(master);

  if (changes.title !== undefined) master.updatePropertyWithValue('summary', changes.title);
  if (changes.location !== undefined) setText(master, 'location', changes.location);
  if (changes.description !== undefined) setText(master, 'description', changes.description);

  if (changes.start_time !== undefined || changes.end_time !== undefined || changes.all_day !== undefined) {
    const allDay = changes.all_day ?? current.startDate.isDate;
    const oldStart = toDate(current.startDate);
    const oldEnd = current.endDate ? toDate(current.endDate) : oldStart;
    const start = changes.start_time ?? oldStart.toISOString();
    // 開始だけ変えたときは長さを保つ
    const end =
      changes.end_time !== undefined
        ? changes.end_time
        : changes.start_time !== undefined
          ? new Date(new Date(start).getTime() + (oldEnd.getTime() - oldStart.getTime())).toISOString()
          : oldEnd.toISOString();
    applyTimes(master, start, end, allDay);
  }

  const seq = Number(master.getFirstPropertyValue('sequence') ?? 0);
  master.updatePropertyWithValue('sequence', seq + 1);
  touch(master);

  const res = await client.updateCalendarObject({
    calendarObject: { url: object.url, etag: object.etag, data: vcal.toString() },
  });
  if (!res.ok) throw new CalendarError(`iCloud の予定の変更に失敗しました（HTTP ${res.status}）`);

  const [updated] = occurrencesOf({ ...object, data: vcal.toString() }, calendar, new Date(0), new Date('2100-01-01'));
  return updated;
}

export async function deleteEvent(id: string): Promise<void> {
  const client = await getClient();
  const { object } = await editableObject(id);
  const res = await client.deleteCalendarObject({ calendarObject: { url: object.url, etag: object.etag } });
  if (!res.ok && res.status !== 404) {
    throw new CalendarError(`iCloud の予定の削除に失敗しました（HTTP ${res.status}）`);
  }
}
