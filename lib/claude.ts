import Anthropic from '@anthropic-ai/sdk';
import { IntentResult } from '@/types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-20250514';

function jstNow(): string {
  return new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

export async function detectIntent(
  message: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<IntentResult> {
  const systemPrompt = `あなたはLINE秘書Botのインテント検出エンジンです。
現在の日時（JST）: ${jstNow()}

ユーザーのメッセージを分析して、以下のJSONフォーマットのみを返してください（説明文は不要）：
{"intent":"インテント名","data":{...}}

使用可能なインテント:
- ADD_SCHEDULE: 予定・スケジュール追加 → data: {title, start_time(ISO8601), end_time?(ISO8601), location?, description?}
- GET_SCHEDULES: 予定確認 → data: {date?: "today"|"tomorrow"|"week"}
- DELETE_SCHEDULE: 予定削除 → data: {query}
- ADD_TASK: タスク追加 → data: {title, priority?(1-5, デフォルト3), deadline?(ISO8601), description?}
- GET_TASKS: タスク確認 → data: {filter?: "all"|"pending"|"completed"}
- COMPLETE_TASK: タスク完了 → data: {query}
- DELETE_TASK: タスク削除 → data: {query}
- ADD_SHOPPING: 買い物追加 → data: {items: [{item, quantity?}]}
- GET_SHOPPING: 買い物リスト確認 → data: {}
- DELETE_SHOPPING: 買い物削除 → data: {item}
- COMPLETE_SHOPPING: 購入済み → data: {item}
- LOG_HABIT: 習慣記録 → data: {habit_name}
- GET_HABITS: 習慣一覧 → data: {}
- ADD_MEMO: メモ追加 → data: {content, tags?:[]}
- GET_MEMO: メモ検索 → data: {query?}
- SEARCH: 調べ物 → data: {query}
- SEARCH_RESTAURANT: お店検索 → data: {area?, genre?, budget?, keywords?}
- ADD_BIRTHDAY: 誕生日登録 → data: {name, birth_date(YYYY-MM-DD)}
- GET_BIRTHDAYS: 誕生日一覧 → data: {}
- ADD_CONSUMABLE: 消耗品登録 → data: {name, reminder_days}
- GET_CONSUMABLES: 消耗品一覧 → data: {}
- GET_TEMPLATE: 定型文呼び出し → data: {name}
- CHAT: 自由会話・その他 → data: {}

日時変換ルール:
- 「明日」「来週月曜」等の相対日時は現在日時を基準に絶対ISO8601形式(Asia/Tokyo)に変換
- 時刻のみの場合は今日の日付を補完
- 締め切りは日付のみの場合は23:59:59を設定`;

  const messages = [
    ...history.map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
    { role: 'user' as const, content: message },
  ];

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
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
  const systemPrompt = `あなたは親切で気配りのできるLINE秘書Botです。
ユーザーをサポートする秘書として、温かく・フレンドリーに日本語で返答してください。
LINEのメッセージなので簡潔に（200字以内を目安）。`;

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

export async function searchWithClaude(query: string): Promise<string> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `以下の質問に答えてください。LINE向けに絵文字・箇条書きで読みやすく日本語でまとめてください（400字以内）。
※私の学習データには制限があるため、最新情報が必要な場合はその旨伝えてください。

質問: ${query}`,
      },
    ],
  });

  return response.content[0].type === 'text' ? response.content[0].text : '検索できませんでした。';
}

export async function searchRestaurantWithClaude(params: {
  area?: string;
  genre?: string;
  budget?: string;
  keywords?: string;
}): Promise<string> {
  const conditions = [
    params.area ? `エリア: ${params.area}` : '',
    params.genre ? `ジャンル: ${params.genre}` : '',
    params.budget ? `予算: ${params.budget}` : '',
    params.keywords ? `その他: ${params.keywords}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `以下の条件でおすすめのレストラン・お店を3〜5件教えてください。LINE向けに絵文字付きで読みやすく日本語でまとめてください。
※実際の営業時間・価格は変わる場合があるため、食べログ・Googleマップでご確認ください。

${conditions}`,
      },
    ],
  });

  return response.content[0].type === 'text' ? response.content[0].text : 'お店を探せませんでした。';
}

export async function generateMorningMessage(data: {
  displayName: string;
  schedules: Array<{ title: string; start_time: string; location?: string }>;
  tasks: Array<{ title: string; priority: number; deadline?: string }>;
  weather: string;
}): Promise<string> {
  const schedulesText =
    data.schedules.length > 0
      ? data.schedules
          .map((s) => {
            const t = new Date(s.start_time).toLocaleTimeString('ja-JP', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Asia/Tokyo',
            });
            return `・${t} ${s.title}${s.location ? ` (${s.location})` : ''}`;
          })
          .join('\n')
      : '・予定なし';

  const priorityLabel: Record<number, string> = { 1: '最低', 2: '低', 3: '中', 4: '高', 5: '最高' };
  const tasksText =
    data.tasks.length > 0
      ? data.tasks
          .slice(0, 3)
          .map((t) => {
            const dl = t.deadline
              ? new Date(t.deadline).toLocaleDateString('ja-JP', {
                  month: 'numeric',
                  day: 'numeric',
                  timeZone: 'Asia/Tokyo',
                })
              : '';
            return `・${t.title} [優先度: ${priorityLabel[t.priority] ?? '中'}${dl ? `, 締め切り: ${dl}` : ''}]`;
          })
          .join('\n')
      : '・タスクなし';

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: `${data.displayName}さんへの朝の挨拶メッセージを作成してください。
以下の情報を含め、温かく・モチベーションが上がる内容にしてください（300字以内、LINE向け絵文字使用）。

【今日の予定】
${schedulesText}

【期限が近いタスク】
${tasksText}

【天気情報】
${data.weather}

形式: おはようございます → 予定 → タスク → 天気 → 一言励まし`,
      },
    ],
  });

  return response.content[0].type === 'text' ? response.content[0].text : `おはようございます、${data.displayName}さん！今日も頑張りましょう！`;
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
    messages: [
      {
        role: 'user',
        content: `${data.displayName}さんへの夜の振り返りメッセージを作成してください。
一日の労いと明日への準備を促す温かい内容にしてください（300字以内、LINE向け絵文字使用）。

【今日の実績】
・完了タスク: ${data.completedTasks}件
・未完了タスク: ${data.pendingTasks}件

【明日の予定】
${tomorrowText}

形式: お疲れさまの挨拶 → 今日の振り返り → 明日の予定 → 気遣いの一言 → 気分の確認(「今日の気分はどうでしたか？」など)`,
      },
    ],
  });

  return response.content[0].type === 'text' ? response.content[0].text : `お疲れさまでした、${data.displayName}さん！ゆっくり休んでね 🌙`;
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
    messages: [
      {
        role: 'user',
        content: `${data.displayName}さんへの週次サマリーメッセージを作成してください。
今週の振り返りと来週への準備を促す、温かく励ましになる内容にしてください（400字以内、LINE向け絵文字使用）。

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

  return response.content[0].type === 'text' ? response.content[0].text : `今週もお疲れさまでした、${data.displayName}さん！`;
}
