import { NextRequest } from 'next/server';
import { verifySignature, replyMessage, textMessage } from '@/lib/line';
import { upsertUser, getConversationHistory, saveConversation } from '@/lib/supabase';
import { detectIntent } from '@/lib/claude';
import { handleIntent } from '@/lib/handlers';
import { LineEvent } from '@/types';

export const runtime = 'nodejs';

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
          `こんにちは！LINE秘書Botです🤖\n\nあなたの日常をサポートします！\n\n【できること】\n📅 予定管理\n✅ タスク管理\n🛒 買い物リスト\n🎯 習慣トラッカー\n📝 メモ\n🔍 調べ物・お店検索\n🎂 誕生日リマインド\n\n何でも気軽に話しかけてください！`
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

    await Promise.all([
      saveConversation(userId, 'user', userMessage),
      saveConversation(userId, 'assistant', response),
      replyMessage(replyToken, [textMessage(response)]),
    ]);
  } catch (err) {
    console.error('processEvent error:', err);
    try {
      await replyMessage(replyToken, [
        textMessage('すみません、エラーが発生しました 🙇\nもう一度試してください。'),
      ]);
    } catch {
      // ignore reply error
    }
  }
}
