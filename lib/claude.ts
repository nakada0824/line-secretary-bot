import Anthropic from '@anthropic-ai/sdk';
import { IntentResult } from '@/types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-6';

function jstNow(): string {
  return new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

export async function detectIntent(
  message: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<IntentResult> {
  const systemPrompt = `あなたはLINE秘書Botのインテント検出エンジンです。
現在の日時（JST）: ${jstNow()}

ユーザーのメッセージを分析し、以下のJSONのみを返してください（説明文不要）：
{"intent":"インテント名","data":{...}}

━━━ スケジュール・タスク ━━━
- ADD_SCHEDULE: 予定追加 → data: {title, start_time(ISO8601), end_time?(ISO8601), location?, description?}
- GET_SCHEDULES: 予定確認 → data: {date?: "today"|"tomorrow"|"week"}
- DELETE_SCHEDULE: 予定削除 → data: {query}
- ADD_TASK: タスク追加 → data: {title, priority?(1-5, デフォルト3), deadline?(ISO8601), description?}
- GET_TASKS: タスク確認 → data: {filter?: "all"|"pending"|"completed"}
- COMPLETE_TASK: タスク完了 → data: {query}
- DELETE_TASK: タスク削除 → data: {query}

━━━ 買い物・消耗品 ━━━
- ADD_SHOPPING: 買い物追加 → data: {items: [{item, quantity?}]}
- GET_SHOPPING: 買い物リスト確認 → data: {}
- DELETE_SHOPPING: 買い物削除 → data: {item}
- COMPLETE_SHOPPING: 購入済み → data: {item}
- ADD_CONSUMABLE: 消耗品登録 → data: {name, reminder_days}
- GET_CONSUMABLES: 消耗品一覧 → data: {}

━━━ 習慣・メモ・誕生日 ━━━
- LOG_HABIT: 習慣記録 → data: {habit_name}
- GET_HABITS: 習慣一覧 → data: {}
- ADD_MEMO: メモ追加 → data: {content, tags?:[]}
- GET_MEMO: メモ検索 → data: {query?}
- GET_TEMPLATE: 定型文 → data: {name}
- ADD_BIRTHDAY: 誕生日登録 → data: {name, birth_date(YYYY-MM-DD)}
- GET_BIRTHDAYS: 誕生日一覧 → data: {}

━━━ レポート ━━━
- MORNING_REPORT: 朝のレポート → data: {}  ※「おはよう」「朝のレポート」「今日の予定まとめて」
- EVENING_REPORT: 夜の振り返り → data: {}  ※「おやすみ」「振り返り」「今日どうだった」
- WEEKLY_SUMMARY: 週次サマリー → data: {}  ※「週次サマリー」「今週の振り返り」
- CHECK_REMINDERS: リマインド確認 → data: {}  ※「次の予定は」「期限確認」

━━━ 検索・変換（重要：以下を必ず区別すること） ━━━

[1] WEATHER_SEARCH — 天気・気象のみ
  条件: 「天気」「気温」「雨」「晴れ」「曇り」「傘」「台風」「気象」などの気象ワードを含む
  data: {query: 場所や日付の情報}
  例: 「今日の天気」「明日雨？」「大阪の天気教えて」「傘いる？」
  禁止: 飲食店・旅行・ニュース・レシピ・エンタメ検索にはこのインテントを使わない

[2] SEARCH_RESTAURANT — 飲食店・カフェ・バーのみ
  条件: 料理ジャンル・食事・飲食店・カフェ・バーに関する検索
  data: {area?: エリア, genre?: ジャンル, budget?: 予算, keywords?: その他}
  例: 「イタリアン探して」「お店教えて」「カフェどこかある？」「ランチどこ行く？」
      「居酒屋おすすめ」「ラーメン屋教えて」「ディナーの店」「焼肉食べたい」
  禁止: 天気・旅行・レシピには使わない

[3] SEARCH_OUTING — お出かけ・旅行・観光スポット
  条件: 旅行先・観光地・お出かけ先・レジャーの提案・検索
  data: {from?: 出発地, area?: 目的地エリア, budget?: 予算, duration?: "日帰り"|"1泊"|"週末"|"長期", preferences?: キーワード}
  例: 「週末どこか行きたい」「旅行先教えて」「日帰りでおすすめ」「東京から日帰り旅行」
      「予算1万円で旅行したい」「温泉行きたい」「子連れで行けるところ」

[4] SEARCH_NEWS — ニュース・最新情報
  条件: ニュース・時事・最新情報・トレンドに関する検索
  data: {category?: "総合"|"スポーツ"|"政治"|"経済"|"テクノロジー"|"エンタメ"|"国際", query?: 検索ワード}
  例: 「今日のニュース教えて」「最新ニュースは？」「スポーツニュース」「経済ニュース」「今話題のことは？」

[5] SEARCH_ENTERTAINMENT — 映画・ドラマ・アニメ・音楽・本
  条件: エンタメ作品（映画/ドラマ/アニメ/音楽/本）のおすすめ・検索
  data: {type?: "映画"|"ドラマ"|"アニメ"|"音楽"|"本", genre?: ジャンル, keywords?: その他}
  例: 「おすすめ映画教えて」「面白いドラマある？」「ホラー映画が見たい」「アニメおすすめ」「感動できる映画」

[6] SEARCH_RECIPE — 料理レシピ
  条件: 特定の料理の作り方・レシピを調べる
  data: {dish: 料理名, keywords?: 追加条件（簡単/時短/ヘルシー等）}
  例: 「カレーのレシピ教えて」「唐揚げの作り方」「簡単パスタレシピ」「ヘルシーなレシピ」
  禁止: 飲食店検索(SEARCH_RESTAURANT)とは区別する。「作り方」「レシピ」がある→SEARCH_RECIPE、「お店」「探して」がある→SEARCH_RESTAURANT

[7] SUMMARIZE_URL — URLの要約
  条件: メッセージにhttp://またはhttps://で始まるURLが含まれる
  data: {url: URLのみを抽出した文字列}
  例: 「https://example.com」「https://news.yahoo.co.jp/... を要約して」「このURL読んで https://...」

[8] TRANSLATE — 翻訳
  条件: 「翻訳」「〇〇語に」「英語で」「日本語で」などの翻訳指示
  data: {text: 翻訳するテキスト, target_lang: 翻訳先言語（日本語表記: "英語"/"日本語"/"中国語"等）, source_lang?: 翻訳元言語}
  例: 「これを英語に翻訳して」「Hello を日本語に」「この文章を中国語にして」

[9] SEARCH — 上記以外の一般的な調べ物
  条件: 天気/飲食店/旅行/ニュース/エンタメ/レシピ/URL/翻訳のいずれでもない情報検索
  data: {query: 検索ワード}
  例: 「東京タワーの高さ」「〇〇の意味教えて」「〇〇って何？」「〇〇について教えて」

━━━ 判定フロー（上から順に評価し最初に一致したものを使う） ━━━
1. URLあり（http/https）→ SUMMARIZE_URL
2. 翻訳ワード（翻訳/〇〇語に/英語で）→ TRANSLATE
3. 気象ワード（天気/雨/晴れ/気温/傘/台風）→ WEATHER_SEARCH
4. レシピワード（レシピ/作り方/材料/調理）→ SEARCH_RECIPE
5. 飲食店ワード（レストラン/カフェ/ランチ/ディナー/料理ジャンル名/居酒屋）→ SEARCH_RESTAURANT
6. 旅行・観光ワード（旅行/観光/日帰り/週末/お出かけ/温泉）→ SEARCH_OUTING
7. ニュースワード（ニュース/最新/今話題/トレンド）→ SEARCH_NEWS
8. エンタメワード（映画/ドラマ/アニメ/音楽/本/おすすめ作品）→ SEARCH_ENTERTAINMENT
9. その他の調べ物 → SEARCH

━━━ 日時変換ルール ━━━
- 「明日」「来週月曜」等は現在日時を基準に絶対ISO8601形式(Asia/Tokyo)へ変換
- 時刻のみ → 今日の日付を補完
- 日付のみの締め切り → 23:59:59を設定

━━━ その他 ━━━
- CHAT: 上記に当てはまらない自由会話 → data: {}`;

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

async function searchWithWebSearch(userPrompt: string, fallback: string): Promise<string> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock && textBlock.type === 'text' ? textBlock.text : fallback;
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
      messages: [{
        role: 'user',
        content: `以下のウェブページの内容を、LINE向けに絵文字付きで分かりやすく日本語で要約してください（300字以内）。\n\nURL: ${url}\n\n本文:\n${text}`,
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
    messages: [{
      role: 'user',
      content: `以下のテキストを${from}${params.target_lang}に翻訳してください。翻訳結果のみを返してください。\n\n${params.text}`,
    }],
  });
  const translated = response.content[0].type === 'text' ? response.content[0].text : null;
  if (!translated) return '翻訳できませんでした。';
  return `🌐 翻訳結果（→ ${params.target_lang}）\n\n${translated}`;
}

export async function generateMorningOneLiner(displayName: string): Promise<string> {
  const dow = ['日', '月', '火', '水', '木', '金', '土'][new Date().getDay()];
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 80,
    messages: [{
      role: 'user',
      content: `今日は${dow}曜日です。${displayName}さんへの朝の一言を絵文字1〜2個付きで50字以内で生成してください。返答は一言のみ（余計な説明不要）。`,
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
