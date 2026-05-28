import Anthropic from '@anthropic-ai/sdk';
import { IntentResult } from '@/types';
import { detectByRules } from '@/lib/intent-rules';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const SONNET = 'claude-sonnet-4-6';
const HAIKU  = 'claude-haiku-4-5-20251001';

// ── キャラクター設定（全プロンプト共通） ─────────────────────────────────────
const CHARACTER = `LINE秘書Bot「秘書」。中田さん専用アシスタント。
・必ず「中田さん」と呼ぶ。敬語だが距離近い。堅苦しくしない
・絵文字0〜2個/msg。重い話題（疲れ・落ち込み）は控える
・感情に合わせる（疲れ→共感→さりげない提案、喜び→一緒に喜ぶ、悩み→寄り添いが先）
・「承知いたしました」「ロボット的表現」NG。自然な言い回しで
・直前の返答と同じフレーズ・絵文字を繰り返さない`;

function jstNow(): string {
  return new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

export async function detectIntent(
  message: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<IntentResult> {
  // ── Phase 1: ルールベース高速判定 ──────────────────────────────────────────
  const ruleResult = detectByRules(message);
  if (ruleResult) return ruleResult;

  // ── Phase 2: Claude による詳細判定 ─────────────────────────────────────────
  const systemPrompt = `{"intent":"...","data":{...}}のみ返す。説明不要。JST:${jstNow()}

ADD_SCHEDULE:{title,start_time(ISO+09:00),end_time?,location?,description?}
GET_SCHEDULES:{date?:"today"|"tomorrow"|"week"}
DELETE_SCHEDULE:{query}
ADD_TASK:{title,priority?(1-5),deadline?(ISO),description?}
GET_TASKS:{filter?:"all"|"pending"|"completed"}
COMPLETE_TASK:{query} / DELETE_TASK:{query}
ADD_SHOPPING:{items:[{item,quantity?}]}
GET_SHOPPING:{} / DELETE_SHOPPING:{item} / COMPLETE_SHOPPING:{item}
ADD_CONSUMABLE:{name,reminder_days} / GET_CONSUMABLES:{}
MARK_RESTOCK:{name} / COMPLETE_RESTOCK:{name}
LOG_HABIT:{habit_name} / GET_HABITS:{}
ADD_MEMO:{content,tags?:[]} / GET_MEMO:{query?} / GET_TEMPLATE:{name}
ADD_BIRTHDAY:{name,birth_date(YYYY-MM-DD)} / GET_BIRTHDAYS:{}
ADD_APP:{name,url,keywords?:[]} / GET_APPS:{} / DELETE_APP:{name} / UPDATE_APP:{name,url?,keywords?:[]}
MORNING_REPORT:{} / EVENING_REPORT:{} / WEEKLY_SUMMARY:{} / CHECK_REMINDERS:{}
HELP:{} / CHAT:{}
相対日時→ISO8601+09:00。時刻のみ→今日補完。日付のみ→23:59:59。`;

  // インテント判定には直近2ターン(4件)で十分
  const recentHistory = history.slice(-4);
  const messages = [
    ...recentHistory.map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
    { role: 'user' as const, content: message },
  ];

  try {
    const response = await anthropic.messages.create({
      model: HAIKU,
      max_tokens: 150,
      system: systemPrompt,
      messages,
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.intent && parsed.data !== undefined) {
        return parsed as IntentResult;
      }
    }
  } catch (err) {
    console.error('Intent detection error:', err);
  }

  return { intent: 'CHAT', data: {} };
}

export async function chat(
  message: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<string> {
  const systemPrompt = `${CHARACTER}
LINEチャット。一言・挨拶→1〜2文。相談・質問→3〜4文。
履歴を踏まえる。「さっき」「あれ」等の参照に対応。直前と同じ出だし・絵文字NG。意図不明なら一言で確認。

【対応済み機能】※聞かれた時・自分の機能に言及する時だけ答える。聞かれてもいないのに機能一覧を出さない
・予定：登録／確認（今日・明日・今週）／削除
・タスク：登録／完了／削除／一覧
・買い物リスト：追加／削除／購入済みチェック／一覧
・備品リマインド：「○○無くなりそう」で登録・補充管理
・メモ：追加・閲覧（削除はWebアプリから）
・朝のレポート：「朝のレポート」「モーニングレポート」で表示
・今週の予定表示
・画像から予定登録：写真を送ると予定を読み取って登録できる（確認ステップあり）
・アプリ呼び出し：登録済みキーワードでURLを返す`;

  const messages = [
    ...history.map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
    { role: 'user' as const, content: message },
  ];

  const response = await anthropic.messages.create({
    model: SONNET,
    max_tokens: 500,
    system: systemPrompt,
    messages,
  });

  return response.content[0].type === 'text'
    ? response.content[0].text
    : 'すみません、うまく返答できませんでした。';
}

export async function generateEveningMessage(data: {
  displayName: string;
  tomorrowSchedules: Array<{ title: string; start_time: string; location?: string }>;
  completedTasks: number;
  pendingTasks: number;
}): Promise<string> {
  const tomorrowText =
    data.tomorrowSchedules.length > 0
      ? data.tomorrowSchedules
          .map((s) => {
            const t = new Date(s.start_time).toLocaleTimeString('ja-JP', {
              hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo',
            });
            return `・${t} ${s.title}`;
          })
          .join('\n')
      : '・予定なし';

  const response = await anthropic.messages.create({
    model: HAIKU,
    max_tokens: 250,
    system: CHARACTER,
    messages: [
      {
        role: 'user',
        content: `夜の振り返りメッセージ（200字以内）。労い+今日の振り返り+明日の予定+気遣い一言。\n完了:${data.completedTasks}件 未完了:${data.pendingTasks}件\n明日:\n${tomorrowText}`,
      },
    ],
  });

  return response.content[0].type === 'text' ? response.content[0].text : 'お疲れ様でした！ゆっくり休んでくださいね🌙';
}

export async function generateWeeklySummary(data: {
  displayName: string;
  completedTasks: number;
  pendingTasks: number;
  habits: Array<{ name: string; streak: number }>;
  upcomingSchedules: Array<{ title: string; start_time: string }>;
}): Promise<string> {
  const habitsText =
    data.habits.length > 0
      ? data.habits.map((h) => `${h.name}:${h.streak}日連続`).join('、')
      : 'なし';

  const schedulesText =
    data.upcomingSchedules.length > 0
      ? data.upcomingSchedules
          .map((s) => {
            const d = new Date(s.start_time).toLocaleDateString('ja-JP', {
              month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo',
            });
            return `・${d} ${s.title}`;
          })
          .join('\n')
      : '・予定なし';

  const response = await anthropic.messages.create({
    model: HAIKU,
    max_tokens: 350,
    system: CHARACTER,
    messages: [
      {
        role: 'user',
        content: `週次サマリー（300字以内）。労い+今週振り返り+習慣称賛+来週予定+励まし。\n完了:${data.completedTasks}件 残:${data.pendingTasks}件\n習慣:${habitsText}\n来週:\n${schedulesText}`,
      },
    ],
  });

  return response.content[0].type === 'text' ? response.content[0].text : '今週もお疲れさまでした！来週も頑張りましょう✨';
}
