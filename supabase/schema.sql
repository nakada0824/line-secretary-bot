-- LINE秘書Bot DB Schema
-- Supabaseのダッシュボード > SQL Editor で実行してください

-- ユーザー
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  picture_url TEXT,
  location TEXT DEFAULT 'Tokyo',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- スケジュール（予定）
CREATE TABLE IF NOT EXISTS schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  location TEXT,
  reminded_1h BOOLEAN DEFAULT FALSE,
  reminded_30m BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- タスク
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  priority INTEGER DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  deadline TIMESTAMPTZ,
  completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  reminded_week BOOLEAN DEFAULT FALSE,
  reminded_3days BOOLEAN DEFAULT FALSE,
  reminded_1day BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 買い物リスト
CREATE TABLE IF NOT EXISTS shopping_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  quantity TEXT,
  checked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 消耗品管理
CREATE TABLE IF NOT EXISTS consumables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  reminder_days INTEGER NOT NULL DEFAULT 30,
  last_purchase_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 習慣トラッカー
CREATE TABLE IF NOT EXISTS habits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  streak INTEGER DEFAULT 0,
  last_logged DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 習慣ログ
CREATE TABLE IF NOT EXISTS habit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  habit_id UUID NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  logged_at TIMESTAMPTZ DEFAULT NOW()
);

-- メモ
CREATE TABLE IF NOT EXISTS memos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  tags TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 定型文
CREATE TABLE IF NOT EXISTS templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 誕生日
CREATE TABLE IF NOT EXISTS birthdays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  birth_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 会話履歴（AI文脈保持用）
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス（クエリ高速化）
CREATE INDEX IF NOT EXISTS idx_schedules_user_start ON schedules(user_id, start_time);
CREATE INDEX IF NOT EXISTS idx_schedules_reminders ON schedules(reminded_1h, reminded_30m, start_time);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, completed, deadline);
CREATE INDEX IF NOT EXISTS idx_tasks_reminders ON tasks(reminded_week, reminded_3days, reminded_1day, deadline);
CREATE INDEX IF NOT EXISTS idx_shopping_user ON shopping_list(user_id, checked);
CREATE INDEX IF NOT EXISTS idx_habits_user ON habits(user_id);
CREATE INDEX IF NOT EXISTS idx_habit_logs_user ON habit_logs(user_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_memos_user ON memos(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_birthdays_user ON birthdays(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, created_at DESC);

-- Row Level Security (RLS) 有効化
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopping_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumables ENABLE ROW LEVEL SECURITY;
ALTER TABLE habits ENABLE ROW LEVEL SECURITY;
ALTER TABLE habit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE memos ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE birthdays ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- ── Row Level Security ポリシー ────────────────────────────────────────────────
-- サーバーサイドは SUPABASE_SERVICE_ROLE_KEY を使用するため RLS をバイパスする。
-- 以下のポリシーは anon / authenticated ロールからの直接アクセスを全て拒否し、
-- 万が一 API キーが漏洩した場合でもデータを保護する。

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'users','schedules','tasks','shopping_list','consumables',
    'habits','habit_logs','memos','templates','birthdays','conversations'
  ]
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS deny_all_public ON %I;
       CREATE POLICY deny_all_public ON %I AS RESTRICTIVE
         FOR ALL TO public USING (false) WITH CHECK (false);',
      tbl, tbl
    );
  END LOOP;
END $$;

-- 確認クエリ（SQL Editor で実行して全テーブルに deny_all_public が付いているか検証）
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename;
