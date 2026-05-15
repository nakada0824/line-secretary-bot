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

以下のJSONのみを返してください（前後に説明文・改行・コードブロック不要）：
{"intent":"インテント名","data":{...}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【重要】日本語の質問パターン対応表
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
「〜は？」「〜ある？」「〜教えて」「〜見せて」「〜確認」「〜一覧」
「〜どう？」「〜調べて」「〜知りたい」 → すべて「情報取得」の意図

例:
「今日の予定は？」        → GET_SCHEDULES {date:"today"}
「明日の予定ある？」      → GET_SCHEDULES {date:"tomorrow"}
「今週何がある？」        → GET_SCHEDULES {date:"week"}
「タスク見せて」          → GET_TASKS {filter:"pending"}
「やること確認」          → GET_TASKS {filter:"pending"}
「買い物リストは？」      → GET_SHOPPING {}
「習慣教えて」            → GET_HABITS {}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【インテント一覧】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

■ 予定
- ADD_SCHEDULE: 「〜に〜を追加」「〜時に〜」「明日14時会議」
  data: {title, start_time(ISO8601), end_time?, location?, description?}
- GET_SCHEDULES: 「〜の予定は？」「予定教えて」「今日何がある？」
  data: {date?: "today"|"tomorrow"|"week"}
- DELETE_SCHEDULE: 「〜の予定を削除/消して」
  data: {query}

■ タスク
- ADD_TASK: 「〜をタスクに追加」「〜をやること登録」「〜 優先度4 締め切り金曜」
  data: {title, priority?(1-5, デフォルト3), deadline?(ISO8601), description?}
- GET_TASKS: 「タスク一覧」「やること教えて」「タスクは？」
  data: {filter?: "all"|"pending"|"completed"}
- COMPLETE_TASK: 「〜を完了」「〜終わった」「〜やった」
  data: {query}
- DELETE_TASK: 「タスク〜を削除」
  data: {query}

■ 買い物・消耗品
- ADD_SHOPPING: 「〜を買い物リストに」「〜買っておいて」
  data: {items: [{item, quantity?}]}
- GET_SHOPPING: 「買い物リストは？」「何を買うんだっけ」
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
- LOG_HABIT: 「〜した」「〜やった」（習慣の記録文脈）
  data: {habit_name}
- GET_HABITS: 「習慣一覧」「習慣は？」
  data: {}
- ADD_MEMO: 「〜をメモして」「〜を記録して」
  data: {content, tags?:[]}
- GET_MEMO: 「メモを見せて」「〜についてのメモ」
  data: {query?}
- ADD_BIRTHDAY: 「〜の誕生日は〜」
  data: {name, birth_date(YYYY-MM-DD)}
- GET_BIRTHDAYS: 「誕生日一覧」
  data: {}
- GET_TEMPLATE: 「〜の定型文」
  data: {name}

■ レポート
- MORNING_REPORT: 「おはよう」「朝のレポート」
  data: {}
- EVENING_REPORT: 「おやすみ」「夜のレポート」「今日の振り返り」
  data: {}
- WEEKLY_SUMMARY: 「週次サマリー」「今週の振り返り」
  data: {}
- CHECK_REMINDERS: 「リマインド確認」「次の予定は？」
  data: {}

■ 検索・変換（重要：以下を必ず区別すること）

[WEATHER_SEARCH] 天気・気象のみ
  「天気」「気温」「雨」「晴れ」「曇り」「傘」「台風」が含まれる
  飲食店・旅行ワードが同時にある場合はWEATHER_SEARCHにしない
  data: {query: "場所 + 日付情報"}
  ✓「今日の天気は？」「明日雨？」「傘いる？」「大阪の天気教えて」
  ✗「イタリアン探して」← 絶対にWEATHER_SEARCHにしない

[SEARCH_RESTAURANT] 飲食店・カフェのみ
  料理ジャンル名・食事・飲食店・カフェ・居酒屋に関する「探す・おすすめ・どこ」
  data: {area?, genre?, budget?, keywords?}
  ✓「イタリアン探して」「お店教えて」「渋谷でランチ」「焼肉食べたい」
  ✓「カフェどこかある？」「居酒屋おすすめ」「ラーメン屋教えて」
  ✗「カレーのレシピ」← SEARCH_RECIPE へ

[SEARCH_OUTING] 旅行・観光・お出かけ
  data: {from?, area?, budget?, duration?, preferences?}
  ✓「週末どこか行きたい」「日帰り旅行おすすめ」「温泉行きたい」

[SEARCH_NEWS] ニュース・時事
  data: {category?, query?}
  ✓「今日のニュース」「最新情報は？」「スポーツニュース」

[SEARCH_ENTERTAINMENT] 映画・ドラマ・アニメ・音楽・本
  data: {type?, genre?, keywords?}
  ✓「おすすめ映画教えて」「面白いドラマある？」

[SEARCH_RECIPE] 料理のレシピ・作り方
  data: {dish, keywords?}
  ✓「カレーのレシピ」「唐揚げの作り方」

[SUMMARIZE_URL] URLを含むメッセージ
  data: {url}

[TRANSLATE] 翻訳指示
  data: {text, target_lang, source_lang?}
  ✓「これを英語に翻訳して」「Hello を日本語に」

[SEARCH] 上記以外の調べ物
  data: {query}
  ✓「東京タワーの高さ」「〇〇って何？」「〇〇について教えて」

[CHAT] 雑談・上記に当てはまらない
  data: {}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【日時変換ルール】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- 相対日時（「明日」「来週月曜」「3日後」等）→ 絶対ISO8601 (Asia/Tokyo)
- 時刻のみ → 今日の日付を補完
- 日付のみの締め切り → 23:59:59 を設定
- 「今週」→ date:"week"、「今日」→ date:"today"、「明日」→ date:"tomorrow"`;

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

async function searchWithWebSearch(userPrompt: string, fallback: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [{ role: 'user', content: userPrompt }];

  for (let turn = 0; turn < 5; turn++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (anthropic.messages.create as any)({
      model: MODEL,
      max_tokens: 1024,
      system: CHARACTER,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages,
    });

    const textBlock = response.content.find((b: { type: string }) => b.type === 'text');

    if (response.stop_reason === 'end_turn') {
      return textBlock?.text ?? fallback;
    }

    if (response.stop_reason === 'tool_use') {
      // Add assistant response (including tool_use blocks) to message history
      messages.push({ role: 'assistant', content: response.content });

      // Build tool_result blocks — Anthropic executes web_search server-side
      const toolUseBlocks = response.content.filter(
        (b: { type: string }) => b.type === 'tool_use'
      );

      if (toolUseBlocks.length === 0) {
        return textBlock?.text ?? fallback;
      }

      const toolResults = toolUseBlocks.map((b: { id: string }) => ({
        type: 'tool_result',
        tool_use_id: b.id,
        content: '',
      }));

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // max_tokens or other stop reasons — return any text found
    return textBlock?.text ?? fallback;
  }

  return fallback;
}

export async function searchWithClaude(query: string): Promise<string> {
  return searchWithWebSearch(
    `以下の質問をウェブで検索して、LINE向けに絵文字・箇条書きで読みやすく日本語でまとめてください（400字以内）。\n\n質問: ${query}`,
    '検索できませんでした。'
  );
}

export async function searchWeatherWithClaude(query: string): Promise<string> {
  const location = query || '東京';
  return searchWithWebSearch(
    `weathernews.jp で「${location}」の天気予報を検索して、今日・明日の天気を絵文字付きでLINE向けに簡潔に日本語でまとめてください。`,
    '天気情報を取得できませんでした。'
  );
}

export async function searchOutingWithClaude(params: {
  from?: string;
  area?: string;
  budget?: string;
  duration?: string;
  preferences?: string;
}): Promise<string> {
  const parts = [
    params.from ? `出発地: ${params.from}` : '',
    params.area ? `エリア: ${params.area}` : '',
    params.duration ? `期間: ${params.duration}` : '',
    params.budget ? `予算: ${params.budget}` : '',
    params.preferences ? `希望: ${params.preferences}` : '',
  ].filter(Boolean).join('、');

  const conditions = parts || '日帰り旅行・お出かけ';
  return searchWithWebSearch(
    `${conditions}のおすすめお出かけ・旅行プランをウェブで検索して、観光スポット・グルメ・アクティビティを含む提案を3〜5件、絵文字付きでLINE向けに日本語でまとめてください（400字以内）。アクセス方法や予算の目安も含めてください。`,
    'お出かけ先を探せませんでした。'
  );
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
    .join('、');

  return searchWithWebSearch(
    `食べログまたはGoogleマップで${conditions}のおすすめレストラン・お店を検索して、3〜5件を絵文字付きでLINE向けに日本語でまとめてください。営業時間や価格帯も含めてください。`,
    'お店を探せませんでした。'
  );
}

export async function searchNewsWithClaude(params: {
  category?: string;
  query?: string;
}): Promise<string> {
  const topic = [params.category, params.query].filter(Boolean).join(' ') || '最新ニュース';
  return searchWithWebSearch(
    `${topic}の最新ニュースをウェブで検索して、重要なニュースを3〜5件、絵文字付きでLINE向けに日本語でまとめてください（400字以内）。各ニュースに見出しと要点を含めてください。`,
    'ニュースを取得できませんでした。'
  );
}

export async function searchEntertainmentWithClaude(params: {
  type?: string;
  genre?: string;
  keywords?: string;
}): Promise<string> {
  const parts = [
    params.type || 'エンタメ作品',
    params.genre ? `ジャンル: ${params.genre}` : '',
    params.keywords || '',
  ].filter(Boolean).join('、');
  return searchWithWebSearch(
    `${parts}のおすすめ作品をウェブで検索して、3〜5件を絵文字付きでLINE向けに日本語でまとめてください（400字以内）。あらすじや見どころも含めてください。`,
    'エンタメ情報を取得できませんでした。'
  );
}

export async function searchRecipeWithClaude(params: {
  dish: string;
  keywords?: string;
}): Promise<string> {
  const query = [params.dish, params.keywords].filter(Boolean).join(' ');
  return searchWithWebSearch(
    `「${query}」のレシピをウェブで検索して、材料と調理手順のポイントを絵文字付きでLINE向けに日本語でまとめてください（400字以内）。`,
    'レシピを見つけられませんでした。'
  );
}

export async function summarizeUrlWithClaude(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Bot/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000);

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: CHARACTER,
      messages: [{
        role: 'user',
        content: `以下のウェブページの内容を、LINE向けに分かりやすく日本語で要約してください（300字以内）。\n\nURL: ${url}\n\n本文:\n${text}`,
      }],
    });
    const summary = response.content[0].type === 'text' ? response.content[0].text : null;
    return summary ?? 'ページの要約ができませんでした。';
  } catch {
    return searchWithWebSearch(
      `${url} このページの内容を要約してください。絵文字付きでLINE向けに300字以内で日本語でまとめてください。`,
      'ページの内容を取得できませんでした。'
    );
  }
}

export async function translateWithClaude(params: {
  text: string;
  target_lang: string;
  source_lang?: string;
}): Promise<string> {
  const from = params.source_lang ? `${params.source_lang}から` : '';
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: CHARACTER,
    messages: [{
      role: 'user',
      content: `以下のテキストを${from}${params.target_lang}に翻訳してください。翻訳結果のみを返してください。\n\n${params.text}`,
    }],
  });
  const translated = response.content[0].type === 'text' ? response.content[0].text : null;
  if (!translated) return '翻訳できませんでした。';
  return `🌐 翻訳結果（→ ${params.target_lang}）\n\n${translated}`;
}

export async function generateMorningOneLiner(_displayName: string): Promise<string> {
  const dow = ['日', '月', '火', '水', '木', '金', '土'][new Date().getDay()];
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 80,
    system: CHARACTER,
    messages: [{
      role: 'user',
      content: `今日は${dow}曜日です。中田さんへの朝の一言を絵文字1〜2個付きで50字以内で生成してください。返答は一言のみ。`,
    }],
  });
  return response.content[0].type === 'text'
    ? response.content[0].text.trim()
    : '今日も一日頑張りましょう！💪';
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
    system: CHARACTER,
    messages: [
      {
        role: 'user',
        content: `中田さんへの朝の挨拶メッセージを作成してください。
温かく・モチベーションが上がる内容で300字以内にまとめてください。

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

  return response.content[0].type === 'text' ? response.content[0].text : 'おはようございます！今日も頑張りましょう！☀️';
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
