// 毎朝7時に LINE で送る通知の本文（app/api/cron/remind から呼ぶ）。
// 1日1通にまとめる：（月曜だけ）今週のまとめ → 天気 → 3日後〜本日の予定 → 今月のこの先 → 今週の誕生日。
// どこかの取得に失敗しても、その部分だけ省いて残りは送る。

import { query } from '@/lib/db';
import { listEvents, type CalendarEvent } from '@/lib/icloud';
import { jstDayRange, jstWeekday, jstDateString } from '@/lib/jst';
import { iphoneCalendarUrl } from '@/lib/calendar-link';
import { fmtEventTime } from '@/lib/handlers/schedule';

// 三芳町
const LAT = 35.83;
const LON = 139.53;
const JMA_URL = 'https://www.jma.go.jp/bosai/forecast/data/forecast/110000.json'; // 埼玉県
const JMA_AREA = '南部';

const MONTH_LIST_MAX = 5;
const WEEK_SUMMARY_EVENTS = 3;

// 件名にこれらが入っている予定を「大事そう」とみなして先に出す
const IMPORTANT = /テスト|試験|模試|検定|面談|懇談|保護者|会議|説明会|締切|〆切|締め切り|提出|発表|本番|病院|歯医者|健診|手術|支払|振込|契約|引っ越し|旅行|式|誕生日|記念日|面接/;

function fmtDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('ja-JP', {
    month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo',
  });
}

function fmtShortDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Tokyo' });
}

function eventLine(e: CalendarEvent, prefix: string): string {
  return `・${prefix} ${fmtEventTime(e)} ${e.title}${e.location ? `（${e.location}）` : ''}`;
}

// 大事そうな予定を先に、同じなら日付順
function byImportance(events: CalendarEvent[]): CalendarEvent[] {
  const score = (e: CalendarEvent) => (IMPORTANT.test(e.title) ? 2 : 0) + (e.calendar === '職場' ? 1 : 0);
  return [...events].sort((a, b) => score(b) - score(a) || a.start_time.localeCompare(b.start_time));
}

function startsIn(events: CalendarEvent[], range: { start: Date; end: Date }): CalendarEvent[] {
  return events.filter((e) => {
    const s = new Date(e.start_time);
    return s >= range.start && s < range.end;
  });
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ── 天気 ─────────────────────────────────────────────────────────────────────

interface Weather {
  text: string | null;     // 気象庁の天気文（「くもり 時々 晴れ」）
  max: number | null;
  min: number | null;
  morningPop: number | null; // 7〜9時の降水確率の最大
  eveningPop: number | null; // 16〜19時の降水確率の最大
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await withTimeout(fetch(url, { cache: 'no-store' }), 8000);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function jmaWeatherText(today: string): Promise<string | null> {
  type Jma = Array<{ timeSeries: Array<{ timeDefines: string[]; areas: Array<{ area: { name: string }; weathers?: string[] }> }> }>;
  const data = (await fetchJson(JMA_URL)) as Jma;
  const series = data[0]?.timeSeries?.[0];
  const area = series?.areas.find((a) => a.area.name === JMA_AREA);
  const i = series?.timeDefines.findIndex((t) => t.startsWith(today)) ?? -1;
  const text = i >= 0 ? area?.weathers?.[i] : undefined;
  return text ? text.replace(/\s+/g, ' ').trim() : null;
}

async function openMeteo(): Promise<Pick<Weather, 'max' | 'min' | 'morningPop' | 'eveningPop'>> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    '&hourly=precipitation_probability&daily=temperature_2m_max,temperature_2m_min' +
    '&timezone=Asia%2FTokyo&forecast_days=1';
  const j = (await fetchJson(url)) as {
    hourly: { time: string[]; precipitation_probability: (number | null)[] };
    daily: { temperature_2m_max: number[]; temperature_2m_min: number[] };
  };
  const popBetween = (from: number, to: number) => {
    const values = j.hourly.time
      .map((t, i) => ({ hour: Number(t.slice(11, 13)), pop: j.hourly.precipitation_probability[i] }))
      .filter((h) => h.hour >= from && h.hour <= to && h.pop != null)
      .map((h) => h.pop as number);
    return values.length ? Math.max(...values) : null;
  };
  return {
    max: Math.round(j.daily.temperature_2m_max[0]),
    min: Math.round(j.daily.temperature_2m_min[0]),
    morningPop: popBetween(7, 9),
    eveningPop: popBetween(16, 19),
  };
}

async function getWeather(today: string): Promise<Weather | null> {
  const [text, meteo] = await Promise.allSettled([jmaWeatherText(today), openMeteo()]);
  if (text.status === 'rejected') console.error('[morning weather] jma', text.reason);
  if (meteo.status === 'rejected') console.error('[morning weather] open-meteo', meteo.reason);
  const w: Weather = {
    text: text.status === 'fulfilled' ? text.value : null,
    max: null, min: null, morningPop: null, eveningPop: null,
    ...(meteo.status === 'fulfilled' ? meteo.value : {}),
  };
  return w.text || w.max != null ? w : null;
}

function weatherLines(w: Weather | null): string[] {
  if (!w) return ['🌤 天気：取得できませんでした'];
  const lines = [`🌤 三芳町：${w.text ?? '—'}`];
  if (w.max != null && w.min != null) lines[0] += `（${w.max}℃ / ${w.min}℃）`;
  if (w.morningPop != null || w.eveningPop != null) {
    lines.push(`☂️ 降水確率 朝${w.morningPop ?? '—'}% ／ 夕方${w.eveningPop ?? '—'}%`);
  }
  // 「くもり 夕方から雨」のような文もあるので、判定は朝の降水確率で。取れないときだけ天気文の書き出しで
  const morningRain = w.morningPop != null ? w.morningPop >= 50 : /^雨/.test(w.text ?? '');
  if (morningRain) lines.push('☔ 傘を忘れずに');
  return lines;
}

// ── 誕生日 ───────────────────────────────────────────────────────────────────

async function birthdaysThisWeek(userId: string, today: Date, weekEnd: Date) {
  const rows = await query<{ name: string; birth_date: string }>(
    'SELECT name, birth_date FROM birthdays WHERE user_id = $1',
    [userId]
  );
  const todayStr = jstDateString(today);
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

// ── 本文 ─────────────────────────────────────────────────────────────────────

export async function buildMorningNotice(userId: string, now: Date = new Date()): Promise<string> {
  const today = jstDayRange(now, 0);
  const tomorrow = jstDayRange(now, 1);
  const in2d = jstDayRange(now, 2);
  const in3d = jstDayRange(now, 3);

  const weekday = jstWeekday(now); // 0=日 … 6=土
  const weekEnd = jstDayRange(now, weekday === 0 ? 0 : 7 - weekday).end; // 今週の日曜の終わり
  const todayStr = jstDateString(now);
  const [y, m] = todayStr.split('-').map(Number);
  const monthEnd = new Date(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01T00:00:00+09:00`);
  const until = new Date(Math.max(monthEnd.getTime(), weekEnd.getTime(), in3d.end.getTime()));

  const [eventsRes, weatherRes, birthdaysRes, tasksRes] = await Promise.allSettled([
    listEvents(today.start, until),
    getWeather(todayStr),
    birthdaysThisWeek(userId, now, weekEnd),
    weekday === 1
      ? query<{ title: string; deadline: string }>(
          `SELECT title, deadline FROM tasks
           WHERE user_id = $1 AND completed = false AND deadline >= $2 AND deadline < $3
           ORDER BY deadline`,
          [userId, today.start.toISOString(), weekEnd.toISOString()]
        )
      : Promise.resolve([]),
  ]);
  for (const r of [eventsRes, birthdaysRes, tasksRes]) {
    if (r.status === 'rejected') console.error('[morning notice]', r.reason);
  }

  const events = eventsRes.status === 'fulfilled' ? eventsRes.value : null;
  const lines: string[] = ['おはようございます、中田さん！☀️'];

  // ── 月曜：今週のまとめ ──
  if (weekday === 1) {
    lines.push('', '【今週のまとめ】');
    if (events) {
      const week = startsIn(events, { start: today.start, end: weekEnd }).filter((e) => e.calendar !== 'シフトボード');
      const big = byImportance(week).slice(0, WEEK_SUMMARY_EVENTS);
      lines.push(
        week.length
          ? `📅 予定${week.length}件：${big.map((e) => `${fmtShortDate(e.start_time)} ${e.title}`).join('、')}`
          : '📅 今週は予定が入っていません'
      );
    } else {
      lines.push('📅 予定：カレンダーを読み込めませんでした');
    }
    const tasks = tasksRes.status === 'fulfilled' ? tasksRes.value : [];
    lines.push(
      tasks.length
        ? `⏰ 締め切り${tasks.length}件：${tasks.slice(0, 2).map((t) => `${t.title}（${fmtShortDate(t.deadline)}）`).join('、')}${tasks.length > 2 ? ` ほか${tasks.length - 2}件` : ''}`
        : '⏰ 今週締め切りのタスクはありません'
    );
  }

  // ── 天気 ──
  lines.push('', ...weatherLines(weatherRes.status === 'fulfilled' ? weatherRes.value : null));

  // ── 3日後〜本日の予定 ──
  if (!events) {
    lines.push('', '📅 カレンダーを読み込めませんでした');
  } else {
    const sections: Array<[string, CalendarEvent[], (e: CalendarEvent) => string]> = [
      ['【3日後】', startsIn(events, in3d), (e) => fmtDate(e.start_time)],
      ['【2日後】', startsIn(events, in2d), (e) => fmtDate(e.start_time)],
      ['【明日】', startsIn(events, tomorrow), (e) => fmtDate(e.start_time)],
      ['【本日】', startsIn(events, today), () => '本日'],
    ];
    if (sections.every(([, list]) => !list.length)) {
      lines.push('', '今日から3日後まで、予定は入っていません🌿');
    }
    for (const [label, list, prefix] of sections) {
      if (!list.length) continue;
      lines.push('', label, ...list.map((e) => eventLine(e, prefix(e))));
    }

    // ── 今月のこの先（4日後〜月末）──
    const rest = startsIn(events, { start: in3d.end, end: monthEnd });
    if (rest.length) {
      const shifts = rest.filter((e) => e.calendar === 'シフトボード');
      const others = rest.filter((e) => e.calendar !== 'シフトボード');
      const shown = byImportance(others).slice(0, MONTH_LIST_MAX).sort((a, b) => a.start_time.localeCompare(b.start_time));
      const more = others.length - shown.length;
      lines.push('', `【今月のこの先】`);
      lines.push(...shown.map((e) => `・${fmtDate(e.start_time)} ${e.title}`));
      const tail = [more > 0 ? `ほか${more}件` : '', shifts.length ? `シフト${shifts.length}件` : ''].filter(Boolean);
      if (tail.length) lines.push(`（${tail.join('・')}）`);
    }
  }

  // ── 今週の誕生日 ──
  const birthdays = birthdaysRes.status === 'fulfilled' ? birthdaysRes.value : [];
  if (birthdays.length) {
    lines.push('', '🎂 今週の誕生日');
    for (const b of birthdays) {
      const isToday = jstDateString(b.date) === todayStr;
      lines.push(`・${b.name}さん ${fmtDate(b.date)}${isToday ? '（今日！）' : ''}`);
    }
  }

  lines.push('', `📱 カレンダーを開く\n${iphoneCalendarUrl()}`);
  return lines.join('\n');
}
