export default function Home() {
  return (
    <main style={{ padding: '40px', fontFamily: 'sans-serif', maxWidth: '600px', margin: '0 auto' }}>
      <h1>LINE秘書Bot</h1>
      <p>このサービスはLINE Messaging APIを通じて動作します。</p>
      <h2>機能一覧</h2>
      <ul>
        <li>📅 予定管理（追加・確認・削除）</li>
        <li>✅ タスク管理（優先度・締め切り・完了）</li>
        <li>🛒 買い物リスト管理</li>
        <li>🎯 習慣トラッカー（連続日数カウント）</li>
        <li>📝 メモ・定型文</li>
        <li>🔍 調べ物・お店検索</li>
        <li>🎂 誕生日リマインド</li>
        <li>🗂️ 消耗品補充リマインド</li>
        <li>🌤️ 毎朝の天気・予定通知</li>
        <li>🌙 毎夜の振り返り通知</li>
      </ul>
      <p>
        Webhook URL: <code>/api/webhook</code>
      </p>
    </main>
  );
}
