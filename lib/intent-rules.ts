/**
 * ルールベースのインテント判定（Claude 呼び出し前に実行）
 * 高確信度のパターンのみマッチさせる。曖昧な場合は null を返して Claude に委ねる。
 */
import type { IntentResult } from '@/types';

// 日本語の疑問・依頼末尾表現
const ASK = /[はがをにで]?(教えて|見せて|確認|一覧|リスト|ある[かな？?]?|どう[？?]?|何[？?]?|は[？?]|を?見たい|調べて|知りたい)/;

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

// ── URL ──────────────────────────────────────────────────────────────────────
function tryUrl(m: string): IntentResult | null {
  const urlMatch = m.match(/https?:\/\/[^\s]+/);
  if (!urlMatch) return null;
  return { intent: 'SUMMARIZE_URL', data: { url: urlMatch[0] } };
}

// ── 翻訳 ─────────────────────────────────────────────────────────────────────
function tryTranslate(m: string): IntentResult | null {
  if (!/翻訳|を英語に|を日本語に|を中国語に|を韓国語に|をフランス語に|を仏語に|に訳して|translate/.test(m)) return null;
  return null; // 詳細パースは Claude に委ねる
}

// ── あいさつ系レポート ────────────────────────────────────────────────────────
function tryGreeting(m: string): IntentResult | null {
  if (/^(おはよう|おはようございます|グッドモーニング|朝のレポート)[!！。\s]*$/.test(m))
    return { intent: 'MORNING_REPORT', data: {} };
  if (/^(おやすみ|おやすみなさい|グッドナイト|夜のレポート|今日の振り返り)[!！。\s]*$/.test(m))
    return { intent: 'EVENING_REPORT', data: {} };
  if (/週次サマリー|今週の振り返り|週報/.test(m))
    return { intent: 'WEEKLY_SUMMARY', data: {} };
  if (/リマインド(確認|一覧)|次の予定(は[？?]?|を教えて)|期限(確認|チェック)/.test(m))
    return { intent: 'CHECK_REMINDERS', data: {} };
  return null;
}

// ── 天気 ─────────────────────────────────────────────────────────────────────
const WEATHER_WORDS = /天気|気温|降水確率|傘(が?いる|が?必要|持って)|雨(が降|かな|？)|晴れ(る?[かな？]|そう)|曇り|台風|気象|最高気温|最低気温/;
const FOOD_STORE_WORDS = /レストラン|カフェ|ランチ|ディナー|居酒屋|飲食店|焼肉|ラーメン|寿司|イタリアン|フレンチ|中華/;

function tryWeather(m: string): IntentResult | null {
  if (!WEATHER_WORDS.test(m)) return null;
  if (FOOD_STORE_WORDS.test(m)) return null; // 飲食文脈との混在は Claude へ
  return { intent: 'WEATHER_SEARCH', data: { query: m } };
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

// ── 飲食店検索（SEARCH_RESTAURANT）─────────────────────────────────────────
// 料理ジャンル or 食事ワード + 探す意図
const CUISINE = /イタリアン|フレンチ|中華|韓国料理|タイ料理|インド料理|ラーメン|寿司|焼肉|焼き鳥|天ぷら|蕎麦|うどん|とんかつ|居酒屋|バー|カフェ|コーヒー|串焼き|鍋料理|しゃぶしゃぶ|ピザ|バーガー|ステーキ|パスタ/;
const MEAL = /ランチ|ディナー|夕食|夕飯|夜ご飯|朝食|食事|飲み会|飲み|外食/;
const FIND_STORE = /探して|おすすめ|教えて|どこ(か|に)?ある|いい(お)?店|行きたい|食べたい|飲みたい/;

function tryRestaurant(m: string): IntentResult | null {
  const hasCuisine = CUISINE.test(m);
  const hasMeal = MEAL.test(m);
  const hasFind = FIND_STORE.test(m);
  const hasStoreWord = /お店|レストラン|飲食店/.test(m);

  if ((hasCuisine && (hasFind || hasStoreWord)) ||
      (hasMeal && (hasFind || /どこ|店|場所/.test(m))) ||
      (hasStoreWord && hasFind)) {
    return null; // マッチするが data の詳細パースは Claude へ
  }
  return null;
}

// ── ニュース ─────────────────────────────────────────────────────────────────
function tryNews(m: string): IntentResult | null {
  if (/ニュース|今日の出来事|最新情報|今話題|トレンド/.test(m)) {
    const category = /スポーツ/.test(m) ? 'スポーツ'
      : /政治/.test(m) ? '政治'
      : /経済|ビジネス/.test(m) ? '経済'
      : /テクノロジー|IT|AI/.test(m) ? 'テクノロジー'
      : /エンタメ|芸能/.test(m) ? 'エンタメ'
      : '総合';
    return { intent: 'SEARCH_NEWS', data: { category } };
  }
  return null;
}

// ── エンタメ ──────────────────────────────────────────────────────────────────
function tryEntertainment(m: string): IntentResult | null {
  if (!/(映画|ドラマ|アニメ|音楽|本|漫画|マンガ)(の?(おすすめ|紹介|教えて|見たい|聴きたい|読みたい))?/.test(m)) return null;
  if (/レシピ|料理|作り方/.test(m)) return null;
  const type = /映画/.test(m) ? '映画' : /ドラマ/.test(m) ? 'ドラマ'
    : /アニメ/.test(m) ? 'アニメ' : /音楽/.test(m) ? '音楽' : '本';
  return { intent: 'SEARCH_ENTERTAINMENT', data: { type } };
}

// ── レシピ ────────────────────────────────────────────────────────────────────
function tryRecipe(m: string): IntentResult | null {
  if (!/レシピ|作り方|の?作り方|料理の?仕方/.test(m)) return null;
  if (/お店|レストラン|探して/.test(m)) return null;
  return null; // dish の抽出は Claude へ
}

// ─────────────────────────────────────────────────────────────────────────────
// メイン判定関数
// ─────────────────────────────────────────────────────────────────────────────

export function detectByRules(message: string): IntentResult | null {
  const m = message.trim();

  return (
    tryOpenWebApp(m) ??
    tryUrl(m) ??
    tryGreeting(m) ??
    tryWeather(m) ??
    tryGetSchedules(m) ??
    tryGetTasks(m) ??
    tryGetShopping(m) ??
    tryGetHabits(m) ??
    tryNews(m) ??
    tryEntertainment(m) ??
    null
    // tryRestaurant / tryRecipe / tryTranslate は null を返して Claude へ委ねる
  );
}
