/**
 * ルールベースのインテント判定（Claude 呼び出し前に実行）
 * 高確信度のパターンのみマッチさせる。曖昧な場合は null を返して Claude に委ねる。
 */
import type { IntentResult } from '@/types';

// 日本語の疑問・依頼末尾表現
const ASK = /[はがをにで]?(教えて|見せて|確認|一覧|リスト|ある[かな？?]?|どう[？?]?|何[？?]?|は[？?]|を?見たい|調べて|知りたい)/;

// ── 即時返答（Claude API不要・0コスト） ────────────────────────────────────────
function reply(text: string): IntentResult {
  return { intent: 'INSTANT_REPLY', data: { text } };
}

function pick(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

function tryInstantReply(m: string): IntentResult | null {
  // 末尾の記号・空白を除去して純粋なキーワードを取り出す
  const s = m.replace(/[!！？。〜～♪\s]+$/, '');

  // 朝の挨拶
  if (/^(おはよう(ございます)?|グッドモーニング)$/.test(s))
    return reply(pick([
      'おはようございます、中田さん！☀️ 今日もよろしくお願いします！',
      'おはようございます！今日も一緒に頑張りましょう☀️',
      'おはよう！今日は何かありましたっけ？',
    ]));

  // 夜の挨拶
  if (/^(おやすみ(なさい)?|グッドナイト)$/.test(s))
    return reply(pick([
      'おやすみなさい、中田さん！🌙 ゆっくり休んでくださいね。',
      'おやすみなさい！今日もお疲れさまでした。よく寝てください🌙',
      'おやすみなさい。また明日！',
    ]));

  // 感謝
  if (/^(ありがとう(ございます)?|ありがとね|サンキュー|thanks)$/i.test(s))
    return reply(pick([
      'どういたしまして！😊',
      'いえいえ、当然です！',
      'お役に立てて良かったです✨',
      'とんでもないです！',
    ]));

  // 了解・確認
  if (/^(了解(です|しました)?|わかった|わかりました|オッケー|ok|OK|ラジャー)$/i.test(s))
    return reply(pick([
      '了解です✨',
      'わかりました！',
      'はい、了解しました！',
      'オッケーです😊',
    ]));

  // 疲れた・しんどい → Claude(CHAT)へ委ねて共感させる

  // 暇 → Claude(CHAT)へ委ねてより自然に対応させる

  // ただいま
  if (/^(ただいま(です)?)$/.test(s))
    return reply(pick([
      'おかえりなさい、中田さん！今日もお疲れさまでした☺️',
      'おかえり！ゆっくりしてください😊',
      'おかえりなさい！何かありましたか？',
    ]));

  // こんにちは
  if (/^(こんにちは|こんにちわ|hello|hi)$/i.test(s))
    return reply(pick([
      'こんにちは、中田さん！😊 何かお手伝いできますか？',
      'こんにちは！どうしました？',
      'こんにちは😊 何かありましたか？',
    ]));

  // こんばんは
  if (/^(こんばんは|こんばんわ)$/.test(s))
    return reply(pick([
      'こんばんは、中田さん！🌙 今日はいかがでしたか？',
      'こんばんは！今日もお疲れさまでした。',
      'こんばんは😊 ゆっくりできてますか？',
    ]));

  // お疲れ様
  if (/^(お疲れ(様|さま|さん)?(です|でした)?|お疲れ)$/.test(s))
    return reply(pick([
      'お疲れさまです！今日もよく頑張りましたね😊',
      'お疲れさまでした！ゆっくり休んでください。',
      'お疲れさまです。今日はどうでしたか？',
    ]));

  // よろしく
  if (/^(よろしく(お願い(します|いたします)?)?|よろしくね)$/.test(s))
    return reply(pick([
      'こちらこそよろしくお願いします！😊',
      'はい！よろしくお願いします✨',
      'こちらこそ！何でも聞いてください😊',
    ]));

  // はーい・はい系
  if (/^(はーい|はい(です)?|うん|そうです)$/.test(s))
    return reply(pick([
      'はい！何かありますか？😊',
      'はい、どうしました？',
      'はい！',
    ]));

  return null;
}

// ── Webアプリ起動 ──────────────────────────────────────────────────────────────
const BASE = 'https://secretary-app-bay.vercel.app';

function tryOpenWebApp(m: string): IntentResult | null {
  const s = m.replace(/[！？。\s]+$/, '');
  if (/^(カレンダー|カレンダーを?開いて|予定(を?|が?)見たい)$/.test(s))
    return { intent: 'OPEN_WEB_APP', data: { url: `${BASE}/calendar`, label: 'カレンダー' } };
  if (/^(タスク|タスクを?見たい|タスク一覧)$/.test(s))
    return { intent: 'OPEN_WEB_APP', data: { url: `${BASE}/tasks`, label: 'タスク一覧' } };
  if (/^(買い物リスト|備品|買い物(を?|が?)見たい)$/.test(s))
    return { intent: 'OPEN_WEB_APP', data: { url: `${BASE}/shopping`, label: '買い物リスト' } };
  return null;
}

// ── レポート系（明示的なコマンドのみ） ───────────────────────────────────────
function tryGreeting(m: string): IntentResult | null {
  // 「朝のレポート」「モーニングレポート」など明示的な指示のみ
  if (/^(朝のレポート|モーニングレポート|今日のレポート)[!！。\s]*$/.test(m))
    return { intent: 'MORNING_REPORT', data: {} };
  // 夜のレポート（今日の振り返りも含む）
  if (/^(夜のレポート|ナイトレポート|今日の振り返り)[!！。\s]*$/.test(m))
    return { intent: 'EVENING_REPORT', data: {} };
  if (/週次サマリー|今週の振り返り|週報/.test(m))
    return { intent: 'WEEKLY_SUMMARY', data: {} };
  if (/リマインド(確認|一覧)|次の予定(は[？?]?|を教えて)|期限(確認|チェック)/.test(m))
    return { intent: 'CHECK_REMINDERS', data: {} };
  return null;
}

// ── 予定確認（GET_SCHEDULES）────────────────────────────────────────────────
// 「今日の予定は？」「明日の予定ある？」「今週の予定を教えて」etc.
const SCHEDULE_QUERY = new RegExp(
  '((今日|本日|明日|あさって|今週|来週|今月|来月|[０-９0-9]+月[０-９0-9]+日?)の?)?'
  + '予定'
  + ASK.source
);
const SCHEDULE_MUTATE = /追加|入れて|登録|作って|削除|消して|キャンセル/;

function tryGetSchedules(m: string): IntentResult | null {
  if (!SCHEDULE_QUERY.test(m)) return null;
  if (SCHEDULE_MUTATE.test(m)) return null; // 追加・削除は Claude へ
  let date: string | undefined;
  if (/今日|本日/.test(m)) date = 'today';
  else if (/明日|あさって/.test(m)) date = 'tomorrow';
  else if (/今週|来週|今月|来月/.test(m)) date = 'week';
  return { intent: 'GET_SCHEDULES', data: date ? { date } : {} };
}

// ── タスク確認（GET_TASKS）──────────────────────────────────────────────────
function tryGetTasks(m: string): IntentResult | null {
  if (!/タスク|やること|TODO|やるべき/.test(m)) return null;
  if (/追加|登録|作って|削除|完了|終わった/.test(m)) return null;
  if (!ASK.test(m) && !/タスク$/.test(m.trim())) return null;
  const filter = /完了|終わった/.test(m) ? 'completed' : 'pending';
  return { intent: 'GET_TASKS', data: { filter } };
}

// ── 買い物リスト確認 ─────────────────────────────────────────────────────────
function tryGetShopping(m: string): IntentResult | null {
  if (!/買い物(リスト|一覧|メモ)?/.test(m)) return null;
  if (/追加|入れて|買って/.test(m)) return null;
  if (ASK.test(m) || /買い物リスト$/.test(m.trim())) {
    return { intent: 'GET_SHOPPING', data: {} };
  }
  return null;
}

// ── 習慣一覧 ─────────────────────────────────────────────────────────────────
function tryGetHabits(m: string): IntentResult | null {
  if (/習慣(一覧|リスト)?/.test(m) && ASK.test(m)) {
    return { intent: 'GET_HABITS', data: {} };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// メイン判定関数
// ─────────────────────────────────────────────────────────────────────────────

export function detectByRules(message: string): IntentResult | null {
  const m = message.trim();

  return (
    tryInstantReply(m) ??
    tryOpenWebApp(m) ??
    tryGreeting(m) ??
    tryGetSchedules(m) ??
    tryGetTasks(m) ??
    tryGetShopping(m) ??
    tryGetHabits(m) ??
    null
  );
}
