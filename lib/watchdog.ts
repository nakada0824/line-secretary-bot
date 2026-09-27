// 見張り役：本体（塾の Mac の Claude Code）の heartbeat が40分以上止まったら知らせる。
// - 同じ停止で何度も送らない。復活したら1回だけ知らせる
// - 深夜0〜7時は鳴らさず、朝7時の通知にまとめる
// - 朝・夜の通知から呼ぶときは送らずに本文に混ぜる（通数を増やさない）

import { getStatus, setStatus } from '@/lib/status';
import { pushMessage, textMessage } from '@/lib/line';

const STALE_MS = 40 * 60 * 1000;

interface WatchdogState {
  status: 'up' | 'down';
  last_seen?: string;      // 止まったと判断したときの最後の heartbeat
  down_notified?: boolean; // 「止まってるかも」を伝えたか
  pending?: string[];      // 朝の通知に混ぜる文（深夜に起きたこと）
}

export const RECOVERY_STEPS = [
  '復旧手順：',
  '1) スマホでChromeリモートデスクトップ→塾のMacに入る',
  '2) ターミナルで hisho と打つ',
  '3) /remote-control と打つ',
  '4) Claudeアプリで「秘書」と送る',
].join('\n');

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo',
  });
}

function jstHour(now: Date): number {
  return Number(now.toLocaleString('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Tokyo' }));
}

function downMessage(lastSeen: string): string {
  return `【見張り】秘書ちゃん（塾のMac）が止まってるかも。最後の生存確認：${fmtTime(lastSeen)}\n${RECOVERY_STEPS}`;
}

/**
 * heartbeat を確認して状態を進める。
 * mode = 'push'    : 知らせることがあれば LINE で送る（深夜は朝に回す）
 * mode = 'collect' : 送らずに、朝・夜の通知に混ぜる文を返す（深夜分の pending もここで出す）
 * heartbeat が一度も書かれていない（本体側が未設定）ときは何もしない。
 */
export async function checkHeartbeat(
  userId: string,
  now: Date,
  mode: 'push' | 'collect'
): Promise<string[]> {
  const heartbeat = await getStatus<unknown>('heartbeat');
  if (!heartbeat) return [];

  const saved = await getStatus<WatchdogState>('watchdog');
  const state: WatchdogState = saved?.value ?? { status: 'up' };
  // 0〜7時は鳴らさない。7時台も朝の通知（Vercel Cron は7時台のどこかで動く）に任せて2通にしない
  const quiet = mode === 'push' && jstHour(now) < 8;
  const stale = now.getTime() - new Date(heartbeat.updated_at).getTime() > STALE_MS;

  const out: string[] = [];
  const say = (text: string) => {
    if (quiet) state.pending = [...(state.pending ?? []), text];
    else out.push(text);
  };

  if (stale) {
    if (state.status === 'up') {
      state.status = 'down';
      state.last_seen = heartbeat.updated_at;
      state.down_notified = false;
    }
    // 深夜は朝の通知で伝える（pending ではなく、朝の collect で「まだ止まっている」として出す）
    if (!state.down_notified && !quiet) {
      out.push(downMessage(state.last_seen!));
      state.down_notified = true;
    }
  } else if (state.status === 'down') {
    const recovered = `【見張り】秘書ちゃんが復活しました（停止：${fmtTime(state.last_seen!)}〜${fmtTime(heartbeat.updated_at)}ごろ）`;
    if (state.down_notified) say(recovered);
    else if (quiet) state.pending = [...(state.pending ?? []), `【見張り】夜中に秘書ちゃんが止まっていました（${fmtTime(state.last_seen!)}〜${fmtTime(heartbeat.updated_at)}ごろ）。今は復活しています`];
    state.status = 'up';
    state.last_seen = undefined;
    state.down_notified = undefined;
  }

  // 朝・夜の通知（collect）では、深夜にたまった分も一緒に出す
  if (mode === 'collect' && state.pending?.length) {
    out.unshift(...state.pending);
    state.pending = [];
  }

  await setStatus('watchdog', state);

  if (mode === 'push' && out.length) {
    await pushMessage(userId, [textMessage(out.join('\n\n'))]);
    return [];
  }
  return out;
}
