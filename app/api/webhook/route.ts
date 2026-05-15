import { NextRequest } from 'next/server';
import { verifySignature, replyMessage, textMessage } from '@/lib/line';
import { upsertUser, getConversationHistory, saveConversation } from '@/lib/supabase';
import { detectIntent } from '@/lib/claude';
import { handleIntent } from '@/lib/handlers';
import { runBackgroundReminders } from '@/lib/handlers/report';
import { checkRateLimit, cleanupRateLimit, logSecurity, logError } from '@/lib/security';
import { LineEvent } from '@/types';

export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_BODY_BYTES  = 512 * 1024;  // 512 KB（LINE webhook の実態より十分大きい）
const MAX_MSG_LENGTH  = 1_000;       // 1メッセージあたりの最大文字数

export async function POST(request: NextRequest): Promise<Response> {
  // ① Content-Type 検証
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    logSecurity('suspicious_request', { reason: 'invalid_content_type', contentType });
    return new Response(null, { status: 400 });
  }

  // ② ボディサイズ検証
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    logSecurity('suspicious_request', { reason: 'body_too_large', bytes: contentLength });
    return new Response(null, { status: 413 });
  }

  const body      = await request.text();
  const signature = request.headers.get('x-line-signature') ?? '';
  const ip        = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

  // ③ 署名なし → 即拒否（情報を返さない）
  if (!signature) {
    logSecurity('invalid_signature', { reason: 'missing_signature', ip });
    return new Response(null, { status: 400 });
  }

  // ④ LINE 署名検証（タイミングセーフ比較は lib/line.ts 内で実施）
  if (!verifySignature(body, signature)) {
    logSecurity('invalid_signature', { reason: 'mismatch', ip });
    return new Response(null, { status: 401 });
  }

  let events: LineEvent[] = [];
  try {
    events = JSON.parse(body).events ?? [];
  } catch {
    logSecurity('suspicious_request', { reason: 'invalid_json', ip });
    return new Response(null, { status: 400 });
  }

  // レートリミットの期限切れエントリをクリーンアップ（リクエストのたびに少量の作業）
  cleanupRateLimit();

  await Promise.allSettled(events.map(processEvent));
  return Response.json({ status: 'ok' });
}

async function processEvent(event: LineEvent): Promise<void> {
  // フォローイベント
  if (event.type === 'follow') {
    const userId = event.source.userId;
    if (!userId) return;
    await upsertUser(userId);
    if (event.replyToken) {
      await replyMessage(event.replyToken, [
        textMessage(
          [
            'こんにちは！秘書です🤖',
            '',
            '中田さんの日常をサポートします！',
            '',
            '【できること】',
            '📅 「明日14時に会議」→ 予定追加・管理',
            '✅ 「資料作成 優先度4 締め切り金曜」→ タスク管理',
            '🛒 「牛乳と卵を買い物リストに」→ 買い物リスト',
            '📝 「〇〇をメモして」→ メモ記録',
            '🎯 「筋トレした」→ 習慣トラッカー',
            '📊 「朝のレポート」→ 今日の予定・タスク一覧',
            '',
            '気軽に話しかけてください！',
          ].join('\n')
        ),
      ]);
    }
    return;
  }

  if (event.type !== 'message' || event.message?.type !== 'text') return;

  const userId     = event.source.userId;
  const replyToken = event.replyToken;
  const userMessage = event.message.text?.trim();

  if (!userId || !replyToken || !userMessage) return;

  // ⑤ レート制限（同一ユーザー：60秒に20件まで）
  if (!checkRateLimit(userId)) {
    logSecurity('rate_limit_exceeded', { uid: userId.slice(0, 8) });
    try {
      await replyMessage(replyToken, [
        textMessage('少し時間をおいてから送ってください。'),
      ]);
    } catch { /* ignore */ }
    return;
  }

  // ⑥ メッセージ長制限
  if (userMessage.length > MAX_MSG_LENGTH) {
    try {
      await replyMessage(replyToken, [
        textMessage(`メッセージは${MAX_MSG_LENGTH}文字以内でお願いします。`),
      ]);
    } catch { /* ignore */ }
    return;
  }

  try {
    await upsertUser(userId);
    const history      = await getConversationHistory(userId);
    const intentResult = await detectIntent(userMessage, history);
    const response     = await handleIntent(userId, intentResult, userMessage, history);

    // 返信を最優先で送信
    await replyMessage(replyToken, [textMessage(response)]);

    // 返信後に非同期で副作用タスクを実行
    Promise.allSettled([
      saveConversation(userId, 'user', userMessage),
      saveConversation(userId, 'assistant', response),
      runBackgroundReminders(userId),
    ]).catch((err) => logError('background_tasks', err, { uid: userId.slice(0, 8) }));
  } catch (err) {
    logError('processEvent', err, { uid: userId.slice(0, 8) });
    try {
      await replyMessage(replyToken, [
        textMessage('すみません、エラーが発生しました 🙇\nもう一度試してください。'),
      ]);
    } catch { /* ignore */ }
  }
}
