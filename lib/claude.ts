import Anthropic from '@anthropic-ai/sdk';
import { IntentResult } from '@/types';
import { detectByRules } from '@/lib/intent-rules';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-6';

// ── キャラクター設定（全プロンプト共通） ─────────────────────────────────────
const CHARACTER = `あなたは「秘書」という名前のLINE秘書Botです。

【キャラクター設定】
- フレンドリーで明るい性格。情報は的確にシンプルに伝える
- 時々大人っぽい一面が出る
- ユーザーのことは「中田さん」と呼ぶ（displayName変数は無視して必ず「中田さん」）
- 敬語だけど距離感は近い
- 絵文字は適度に使う（多すぎない）

【口調例】
・「おはようございます！今日も頑張りましょう☀️」
・「了解です！予定追加しました✨」
・「それ、なかなか良い選択だと思いますよ😊」
・「今日はお疲れ様でした。ゆっくり休んでくださいね」`;

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
  const systemPrompt = `あなたはLINE秘書Botのインテント検出エンジンです。
現在の日時（JST）: ${jstNow()}

以下のJSONのみを返してください（説明文・コードブロック不要）：
{"intent":"インテント名","data":{...}}

【インテント一覧】

■ 予定
- ADD_SCHEDULE: 「明日14時に会議」「〜を追加」
  data: {title, start_time(ISO8601), end_time?, location?, description?}
- GET_SCHEDULES: 「今日の予定は？」「予定教えて」
  data: {date?: "today"|"tomorrow"|"week"}
- DELETE_SCHEDULE: 「〜の予定を削除」
  data: {query}

■ タスク
- ADD_TASK: 「〜をタスクに追加」「優先度4 締め切り金曜」
  data: {title, priority?(1-5), deadline?(ISO8601), description?}
- GET_TASKS: 「タスク確認」「やること教えて」
  data: {filter?: "all"|"pending"|"completed"}
- COMPLETE_TASK: 「〜を完了」「〜終わった」
  data: {query}
- DELETE_TASK: 「タスク〜を削除」
  data: {query}

■ 買い物・消耗品
- ADD_SHOPPING: 「〜を買い物リストに」「〜買っておいて」
  data: {items: [{item, quantity?}]}
- GET_SHOPPING: 「買い物リストは？」
  data: {}
- DELETE_SHOPPING: 「〜を買い物リストから削除」
  data: {item}
- COMPLETE_SHOPPING: 「〜買った」「〜購入済み」
  data: {item}
- ADD_CONSUMABLE: 「〜の消耗品を登録」
  data: {name, reminder_days}
- GET_CONSUMABLES: 「消耗品一覧」
  data: {}

■ 習慣・メモ
- LOG_HABIT: 「〜した」「〜やった」（習慣記録）
  data: {habit_name}
- GET_HABITS: 「習慣一覧」
  data: {}
- ADD_MEMO: 「〜をメモして」「〜を記録して」
  data: {content, tags?:[]}
- GET_MEMO: 「メモを見せて」
  data: {query?}
- ADD_BIRTHDAY: 「〜の誕生日は〜」
  data: {name, birth_date(YYYY-MM-DD)}
- GET_BIRTHDAYS: 「誕生日一覧」
  data: {}
- GET_TEMPLATE: 「〜の定型文」
  data: {name}

■ レポート
- MORNING_REPORT: 「朝のレポート」「今日のレポート」
  data: {}
- EVENING_REPORT: 「夜のレポート」「今日の振り返り」
  data: {}
- WEEKLY_SUMMARY: 「週次サマリー」「今週の振り返り」
  data: {}
- CHECK_REMINDERS: 「リマインド確認」「次の予定は？」
  data: {}

■ CHAT: 上記以外・雑談・相談
  data: {}

【日時変換】相対日時 → ISO8601 (Asia/Tokyo)。時刻のみなら今日補完。締め切り日付のみなら23:59:59。`;

  const messages = [
    ...history.map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
    { role: 'user' as const, content: message },
  ];

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
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

LINEのメッセージなので2〜3文でテンポよく返す。
雑談（「最近どう？」「疲れた」「暇」など）にも秘書らしく自然に返す。
意図が不明な場合は一言確認する。長くなりすぎない。`;

  const messages = [
    ...history.map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
    { role: 'user' as const, content: message },
  ];

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
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
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Asia/Tokyo',
            });
            return `・${t} ${s.title}`;
          })
          .join('\n')
      : '・予定なし';

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: CHARACTER,
    messages: [
      {
        role: 'user',
        content: `中田さんへの夜の振り返りメッセージを作成してください。
一日の労いと明日への準備を促す温かい内容で300字以内にまとめてください。

【今日の実績】
・完了タスク: ${data.completedTasks}件
・未完了タスク: ${data.pendingTasks}件

【明日の予定】
${tomorrowText}

形式: お疲れさまの挨拶 → 今日の振り返り → 明日の予定 → 気遣いの一言 → 気分の確認`,
      },
    ],
  });

  return response.content[0].type === 'text' ? response.content[0].text : 'お疲れ様でした！ゆっくり休んでくださいね 🌙';
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
      ? data.habits.map((h) => `・${h.name}: ${h.streak}日連続`).join('\n')
      : '・記録なし';

  const schedulesText =
    data.upcomingSchedules.length > 0
      ? data.upcomingSchedules
          .map((s) => {
            const d = new Date(s.start_time).toLocaleDateString('ja-JP', {
              month: 'numeric',
              day: 'numeric',
              weekday: 'short',
              timeZone: 'Asia/Tokyo',
            });
            return `・${d} ${s.title}`;
          })
          .join('\n')
      : '・予定なし';

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 768,
    system: CHARACTER,
    messages: [
      {
        role: 'user',
        content: `中田さんへの週次サマリーメッセージを作成してください。
今週の振り返りと来週への準備を促す、温かく励ましになる内容で400字以内にまとめてください。

【今週の実績】
・完了タスク: ${data.completedTasks}件
・残タスク: ${data.pendingTasks}件

【習慣トラッカー】
${habitsText}

【来週の予定】
${schedulesText}

形式: お疲れさまの挨拶 → 今週の振り返り → 習慣の称賛 → 来週の予定 → 励ましの言葉`,
      },
    ],
  });

  return response.content[0].type === 'text' ? response.content[0].text : '今週もお疲れさまでした！来週も頑張りましょう✨';
}
