import { NextRequest } from 'next/server';
import { verifySignature, replyMessage, textMessage } from '@/lib/line';
import { upsertUser, getConversationHistory, saveConversation } from '@/lib/supabase';
import { detectIntent } from '@/lib/claude';
import { handleIntent } from '@/lib/handlers';
import { runBackgroundReminders } from '@/lib/handlers/report';
import { LineEvent } from '@/types';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: NextRequest): Promise<Response> {
  const body = await request.text();
  const signature = request.headers.get('x-line-signature') ?? '';

  if (!verifySignature(body, signature)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let events: LineEvent[] = [];
  try {
    events = JSON.parse(body).events ?? [];
  } catch {
    return Response.json({ error: 'Invalid body' }, { status: 400 });
  }

  await Promise.allSettled(events.map(processEvent));
  return Response.json({ status: 'ok' });
}

async function processEvent(event: LineEvent): Promise<void> {
  if (event.type === 'follow') {
    const userId = event.source.userId;
    if (!userId) return;
    await upsertUser(userId);
    if (event.replyToken) {
      await replyMessage(event.replyToken, [
        textMessage(
          [
            'こんにちは！LINE秘書Botです🤖',
            '',
            'あなたの日常をサポートします！',
            '',
            '【話しかけ方の例】',
            '🌅 「おはよう」→ 朝のレポート',
            '🌙 「おやすみ」→ 夜の振り返り',
            '📅 「明日14時に会議」→ 予定追加',
            '✅ 「資料作成 優先度4 締め切り金曜」→ タスク追加',
            '🛒 「牛乳と卵を買い物リストに追加」',
            '🎯 「筋トレした」→ 習慣記録',
            '🔍 「〇〇調べて」「渋谷で焼肉検索」',
            '',
            '気軽に話しかけてください！',
          ].join('\n')
        ),
      ]);
    }
    return;
  }

  if (event.type !== 'message' || event.message?.type !== 'text') return;

  const userId = event.source.userId;
  const replyToken = event.replyToken;
  const userMessage = event.message.text?.trim();

  if (!userId || !replyToken || !userMessage) return;

  try {
    await upsertUser(userId);
    const history = await getConversationHistory(userId);
    const intentResult = await detectIntent(userMessage, history);
    const response = await handleIntent(userId, intentResult, userMessage, history);

    // 返信を最優先で送信
    await replyMessage(replyToken, [textMessage(response)]);

    // 返信後に非同期で副作用タスクを実行（失敗しても返信には影響しない）
    Promise.allSettled([
      saveConversation(userId, 'user', userMessage),
      saveConversation(userId, 'assistant', response),
      runBackgroundReminders(userId),
    ]).catch((err) => console.error('[background tasks error]', err));
  } catch (err) {
    console.error('[processEvent error]', err instanceof Error ? err.message : err);
    try {
      await replyMessage(replyToken, [
        textMessage('すみません、エラーが発生しました 🙇\nもう一度試してください。'),
      ]);
    } catch {
      // ignore
    }
  }
}
