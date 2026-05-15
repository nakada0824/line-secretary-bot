/**
 * インテント判定 テストケース
 * 実行: npx jest  （または vitest）
 *
 * ルールベース（detectByRules）の単体テスト。
 * Claude 呼び出しは不要なため CI でも高速に動作する。
 */
import { detectByRules } from '@/lib/intent-rules';

// ヘルパー
function rule(msg: string) {
  return detectByRules(msg)?.intent ?? null;
}

// ─────────────────────────── 即時返答（Claude API不要） ─────────────
describe('INSTANT_REPLY', () => {
  test('おはよう → INSTANT_REPLY',       () => expect(rule('おはよう')).toBe('INSTANT_REPLY'));
  test('おはようございます → INSTANT_REPLY', () => expect(rule('おはようございます')).toBe('INSTANT_REPLY'));
  test('おやすみ → INSTANT_REPLY',       () => expect(rule('おやすみ')).toBe('INSTANT_REPLY'));
  test('おやすみなさい → INSTANT_REPLY', () => expect(rule('おやすみなさい')).toBe('INSTANT_REPLY'));
  test('ありがとう',      () => expect(rule('ありがとう')).toBe('INSTANT_REPLY'));
  test('ありがとうございます', () => expect(rule('ありがとうございます')).toBe('INSTANT_REPLY'));
  test('了解',           () => expect(rule('了解')).toBe('INSTANT_REPLY'));
  test('ただいま',       () => expect(rule('ただいま')).toBe('INSTANT_REPLY'));
  test('こんにちは',     () => expect(rule('こんにちは')).toBe('INSTANT_REPLY'));
  test('お疲れ様',       () => expect(rule('お疲れ様')).toBe('INSTANT_REPLY'));

  // 末尾記号付きでもマッチ
  test('ありがとう！', () => expect(rule('ありがとう！')).toBe('INSTANT_REPLY'));

  // 複合文はマッチしない（Claude へ）
  test('おはようございます！今日は何かある？ → null',
    () => expect(rule('おはようございます！今日は何かある？')).toBeNull());
});

// ─────────────────────────── 朝・夜レポート ──────────────────────
describe('MORNING_REPORT', () => {
  // おはよう系はINSTANT_REPLYに移行（明示的なコマンドのみ）
  test('朝のレポート',   () => expect(rule('朝のレポート')).toBe('MORNING_REPORT'));
  test('モーニングレポート', () => expect(rule('モーニングレポート')).toBe('MORNING_REPORT'));
});

describe('EVENING_REPORT', () => {
  // おやすみ系はINSTANT_REPLYに移行（明示的なコマンドのみ）
  test('今日の振り返り', () => expect(rule('今日の振り返り')).toBe('EVENING_REPORT'));
  test('夜のレポート',   () => expect(rule('夜のレポート')).toBe('EVENING_REPORT'));
});

describe('WEEKLY_SUMMARY', () => {
  test('週次サマリー', () => expect(rule('週次サマリー')).toBe('WEEKLY_SUMMARY'));
  test('今週の振り返り', () => expect(rule('今週の振り返り')).toBe('WEEKLY_SUMMARY'));
});

// ─────────────────────────── 予定確認 ────────────────────────────
describe('GET_SCHEDULES', () => {
  test('今日の予定は？',       () => expect(rule('今日の予定は？')).toBe('GET_SCHEDULES'));
  test('今日の予定ある？',     () => expect(rule('今日の予定ある？')).toBe('GET_SCHEDULES'));
  test('明日の予定を教えて',   () => expect(rule('明日の予定を教えて')).toBe('GET_SCHEDULES'));
  test('今週の予定見せて',     () => expect(rule('今週の予定見せて')).toBe('GET_SCHEDULES'));
  test('来週の予定確認',       () => expect(rule('来週の予定確認')).toBe('GET_SCHEDULES'));
  test('今月の予定一覧',       () => expect(rule('今月の予定一覧')).toBe('GET_SCHEDULES'));
  test('予定教えて',           () => expect(rule('予定教えて')).toBe('GET_SCHEDULES'));
  test('予定を確認したい',     () => expect(rule('予定を確認したい')).toBe('GET_SCHEDULES'));
  test('本日の予定は？',       () => expect(rule('本日の予定は？')).toBe('GET_SCHEDULES'));

  // date フィールドの確認
  test('今日 → date:today',   () => expect(detectByRules('今日の予定は？')?.data).toEqual({ date: 'today' }));
  test('明日 → date:tomorrow',() => expect(detectByRules('明日の予定ある？')?.data).toEqual({ date: 'tomorrow' }));
  test('今週 → date:week',    () => expect(detectByRules('今週の予定見せて')?.data).toEqual({ date: 'week' }));

  // 追加・削除は除外
  test('予定追加は GET_SCHEDULES でない', () => expect(rule('明日14時に会議を追加して')).not.toBe('GET_SCHEDULES'));
});

// ─────────────────────────── タスク確認 ──────────────────────────
describe('GET_TASKS', () => {
  test('タスク一覧',         () => expect(rule('タスク一覧')).toBe('GET_TASKS'));
  test('タスクを見せて',     () => expect(rule('タスクを見せて')).toBe('GET_TASKS'));
  test('タスクは？',         () => expect(rule('タスクは？')).toBe('GET_TASKS'));
  test('やること教えて',     () => expect(rule('やること教えて')).toBe('GET_TASKS'));
  test('やること一覧',       () => expect(rule('やること一覧')).toBe('GET_TASKS'));
  test('TODOリスト',         () => expect(rule('TODOリスト')).toBe('GET_TASKS'));
  test('タスク確認',         () => expect(rule('タスク確認')).toBe('GET_TASKS'));

  // タスク追加は除外
  test('タスク追加は GET_TASKS でない', () => expect(rule('資料作成をタスクに追加')).not.toBe('GET_TASKS'));
});

// ─────────────────────────── 買い物 ──────────────────────────────
describe('GET_SHOPPING', () => {
  test('買い物リストは？', () => expect(rule('買い物リストは？')).toBe('GET_SHOPPING'));
  test('買い物リスト見せて', () => expect(rule('買い物リスト見せて')).toBe('GET_SHOPPING'));
  test('買い物一覧',       () => expect(rule('買い物一覧')).toBe('GET_SHOPPING'));
  test('買い物リスト確認', () => expect(rule('買い物リスト確認')).toBe('GET_SHOPPING'));
  test('買い物リスト',     () => expect(rule('買い物リスト')).toBe('GET_SHOPPING'));
});

// ─────────────────────────── Claude へ委ねるケース ────────────────
describe('Claude委ねケース（null を返す）', () => {
  test('明日14時に会議',     () => expect(rule('明日14時に会議')).toBeNull());
  test('資料作成 優先度5',   () => expect(rule('資料作成 優先度5 締め切り金曜')).toBeNull());
  test('疲れた → null（Claude で共感対応）', () => expect(rule('疲れた')).toBeNull());
  test('暇 → null（Claude で自然対応）',     () => expect(rule('暇')).toBeNull());
  test('おはようございます！今日は何かある？',
    () => expect(rule('おはようございます！今日は何かある？')).toBeNull());
});
