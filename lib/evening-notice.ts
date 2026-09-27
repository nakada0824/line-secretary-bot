// 毎晩22時に LINE で送る通知の本文（app/api/cron/evening から呼ぶ）。1日1通。
// 明日の予定・明日の天気・公式LINEの未返信・筋トレ・見張り。何もない項目は出さない。
// これが届けば Bot が動いている、公式LINE欄が埋まっていれば本体も動いているとわかる。

import { listEvents } from '@/lib/icloud';
import { jstDayRange, jstDateString, jstWeekday } from '@/lib/jst';
import { fmtEventTime } from '@/lib/handlers/schedule';
import { getDailyWeather } from '@/lib/weather';
import { getStatus } from '@/lib/status';
import { checkHeartbeat } from '@/lib/watchdog';

const RAIN_POP = 40; // 朝7〜9時の降水確率がこれ以上なら一言

// 明日の曜日（0=日 … 6=土）ごとの筋トレメニュー
const WORKOUT: Record<number, string> = {
  6: '胸・三頭',
  0: 'デッドリフト・背中（上から・前から・下からの3方向）',
  1: '脚＋肩・腹筋',
};

interface OfficialLine {
  unreplied?: number;
  login_ok?: boolean;
  items?: string[];
}

export async function buildEveningNotice(userId: string, now: Date = new Date()): Promise<string> {
  const tomorrow = jstDayRange(now, 1);
  const tomorrowStr = jstDateString(now, 1);
  const todayStr = jstDateString(now);

  const [eventsRes, weatherRes, officialRes, watchRes] = await Promise.allSettled([
    listEvents(tomorrow.start, tomorrow.end),
    getDailyWeather(tomorrowStr),
    getStatus<OfficialLine>('official_line'),
    checkHeartbeat(userId, now, 'collect'),
  ]);
  for (const r of [eventsRes, weatherRes, officialRes, watchRes]) {
    if (r.status === 'rejected') console.error('[evening notice]', r.reason);
  }

  const lines: string[] = ['お疲れさまでした🌙'];

  // ── 明日の予定 ──
  if (eventsRes.status === 'fulfilled') {
    const events = eventsRes.value.filter((e) => new Date(e.start_time) >= tomorrow.start);
    if (events.length) {
      lines.push('', '【明日の予定】');
      for (const e of events) lines.push(`・${fmtEventTime(e)} ${e.title}${e.location ? `（${e.location}）` : ''}`);
    }
  } else {
    lines.push('', '📅 明日の予定：カレンダーを読み込めませんでした');
  }

  // ── 明日の天気 ──
  if (weatherRes.status === 'fulfilled') {
    const w = weatherRes.value;
    lines.push('', `🌤 明日：${w.text}（${w.max}℃ / ${w.min}℃）`);
    if (w.morningPop != null && w.morningPop >= RAIN_POP) lines.push('☔ 朝は雨かも、少し早めに');
  }

  // ── 公式LINEの未返信（本体が21:45ごろ書き込む）──
  const official = officialRes.status === 'fulfilled' ? officialRes.value : null;
  if (!official || jstDateString(new Date(official.updated_at)) !== todayStr) {
    lines.push('', '💬 未返信：取得できず（本体停止中？）');
  } else {
    const v = official.value ?? {};
    const n = v.unreplied ?? 0;
    lines.push('', n > 0 ? `💬 公式LINE 未返信${n}件` : '💬 公式LINE 未返信なし');
    for (const item of (v.items ?? []).slice(0, 5)) lines.push(`・${item}`);
    if (v.login_ok === false) lines.push('⚠️ 公式LINEのログインが切れてます');
  }

  // ── 筋トレ ──
  const workout = WORKOUT[jstWeekday(new Date(tomorrow.start.getTime() + 12 * 60 * 60 * 1000))];
  if (workout) lines.push('', `💪 明日は筋トレ：${workout}`);

  // ── 見張り ──
  const watch = watchRes.status === 'fulfilled' ? watchRes.value : [];
  if (watch.length) lines.push('', ...watch);

  return lines.join('\n');
}
