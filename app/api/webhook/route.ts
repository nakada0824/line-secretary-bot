import { NextRequest } from 'next/server';
import { verifySignature, replyMessage, textMessage } from '@/lib/line';
import {
  upsertUser,
  getConversationHistory,
  saveConversation,
  savePendingScan,
  findAppByKeyword,
} from '@/lib/db';
import { detectIntent } from '@/lib/claude';
import { scanImageForSchedules } from '@/lib/claude-vision';
import { handleIntent } from '@/lib/handlers';
import { runTaskReminders } from '@/lib/handlers/report';
import {
  handlePendingScanReply,
  handlePendingScheduleReply,
  ASK_SCAN_CALENDAR,
} from '@/lib/handlers/schedule';
import { checkRateLimit, cleanupRateLimit, logSecurity, logError } from '@/lib/security';
import { LineEvent } from '@/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BODY_BYTES  = 512 * 1024;
const MAX_MSG_LENGTH  = 1_000;

export async function POST(request: NextRequest): Promise<Response> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    logSecurity('suspicious_request', { reason: 'invalid_content_type', contentType });
    return new Response(null, { status: 400 });
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    logSecurity('suspicious_request', { reason: 'body_too_large', bytes: contentLength });
    return new Response(null, { status: 413 });
  }

  const body      = await request.text();
  const signature = request.headers.get('x-line-signature') ?? '';
  const ip        = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

  if (!signature) {
    logSecurity('invalid_signature', { reason: 'missing_signature', ip });
    return new Response(null, { status: 400 });
  }

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

  cleanupRateLimit();

  await Promise.allSettled(events.map(processEvent));
  return Response.json({ status: 'ok' });
}

async function processEvent(event: LineEvent): Promise<void> {
  // ── フォローイベント ──────────────────────────────────────────────────────
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
            '📅 「明日14時に会議を職場に」→ iPhoneのカレンダーに予定追加',
            '✅ 「資料作成 優先度4 締め切り金曜」→ タスク管理',
            '🛒 「牛乳と卵を買い物リストに」→ 買い物リスト',
            '📝 「〇〇をメモして」→ メモ記録',
            '🎯 「筋トレした」→ 習慣トラッカー',
            '📊 「朝のレポート」→ 今日の予定・タスク一覧',
            '📷 カレンダー画像を送る→ 予定を一括登録',
            '',
            '気軽に話しかけてください！',
          ].join('\n')
        ),
      ]);
    }
    return;
  }

  if (event.type !== 'message') return;

  const userId     = event.source.userId;
  const replyToken = event.replyToken;
  if (!userId || !replyToken) return;

  // ── 画像メッセージ ────────────────────────────────────────────────────────
  if (event.message?.type === 'image') {
    const messageId = event.message.id;
    if (!checkRateLimit(userId)) {
      logSecurity('rate_limit_exceeded', { uid: userId.slice(0, 8) });
      return;
    }
    await upsertUser(userId);
    try {
      await handleImageMessage(userId, replyToken, messageId);
    } catch (err) {
      logError('handleImageMessage', err, { uid: userId.slice(0, 8) });
      try {
        await replyMessage(replyToken, [
          textMessage('すみません、エラーが発生しました🙇\nもう一度お試しください。'),
        ]);
      } catch { /* ignore */ }
    }
    return;
  }

  // ── テキストメッセージ以外は無視 ─────────────────────────────────────────
  if (event.message?.type !== 'text') return;

  const userMessage = event.message.text?.trim();
  if (!userMessage) return;

  // ⑤ レート制限
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
    const history = await getConversationHistory(userId);

    // ── 確認待ちへの返事（画像スキャンの登録先・予定の登録先・変更/削除の確認）──
    const pendingReply =
      (await handlePendingScanReply(userId, userMessage)) ??
      (await handlePendingScheduleReply(userId, userMessage));
    if (pendingReply) {
      await replyMessage(replyToken, [textMessage(pendingReply)]);
      Promise.allSettled([
        saveConversation(userId, 'user', userMessage),
        saveConversation(userId, 'assistant', pendingReply),
      ]).catch((err) => logError('background_tasks', err, { uid: userId.slice(0, 8) }));
      return;
    }

    // ── アプリキーワード呼び出し（管理コマンドは除外） ────────────────────
    const APP_MGMT = /アプリ(登録|削除|変更|更新|一覧)|登録して.*(url|URL|http)/i;
    if (!APP_MGMT.test(userMessage)) {
      const foundApp = await findAppByKeyword(userId, userMessage);
      if (foundApp) {
        const appResponse = `${foundApp.name}はこちらです✨\n${foundApp.url}`;
        await replyMessage(replyToken, [textMessage(appResponse)]);
        Promise.allSettled([
          saveConversation(userId, 'user', userMessage),
          saveConversation(userId, 'assistant', appResponse),
        ]).catch((err) => logError('background_tasks', err, { uid: userId.slice(0, 8) }));
        return;
      }
    }

    // ── 通常のインテント処理 ───────────────────────────────────────────────
    const intentResult = await detectIntent(userMessage, history);
    const response     = await handleIntent(userId, intentResult, userMessage, history);

    await replyMessage(replyToken, [textMessage(response)]);

    Promise.allSettled([
      saveConversation(userId, 'user', userMessage),
      saveConversation(userId, 'assistant', response),
      runTaskReminders(userId),
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

// ── 画像メッセージ処理 ────────────────────────────────────────────────────────

async function handleImageMessage(
  userId: string,
  replyToken: string,
  messageId: string
): Promise<void> {
  // LINE APIから画像バイナリを取得
  const imageRes = await fetch(
    `https://api-data.line.me/v2/bot/message/${messageId}/content`,
    { headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` } }
  );

  if (!imageRes.ok) {
    await replyMessage(replyToken, [
      textMessage('画像の取得に失敗しました🙇\nもう一度お試しください。'),
    ]);
    return;
  }

  const imageBase64 = Buffer.from(await imageRes.arrayBuffer()).toString('base64');
  const mimeType    = (imageRes.headers.get('content-type') ?? 'image/jpeg').split(';')[0];

  // Claude Visionで予定を読み取る
  const schedules = await scanImageForSchedules(imageBase64, mimeType);

  if (schedules.length === 0) {
    await replyMessage(replyToken, [
      textMessage('予定が読み取れませんでした📸\nもう少し鮮明な画像をお願いします。'),
    ]);
    return;
  }

  // 確認メッセージを組み立て
  const lines: string[] = ['次の予定を読み取りました！登録しますか？✨', ''];
  for (const s of schedules) {
    if (s.start_time) {
      const d       = new Date(s.start_time);
      const dateStr = d.toLocaleDateString('ja-JP', {
        month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo',
      });
      const rawTime = d.toLocaleTimeString('ja-JP', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo',
      });
      const timeStr = rawTime === '00:00' ? '終日' : rawTime;
      const caution = s.needs_confirmation ? '（要確認）' : '';
      lines.push(`・${dateStr} ${timeStr} ${s.title}${caution}`);
    } else {
      lines.push(`・（日時不明） ${s.title}`);
    }
  }

  const hasUncertain = schedules.some((s) => s.needs_confirmation || !s.start_time);
  if (hasUncertain) {
    lines.push('');
    lines.push('⚠️ 日時が不確かな予定は登録をスキップします');
  }

  lines.push('', ASK_SCAN_CALENDAR);

  await savePendingScan(userId, schedules);
  await replyMessage(replyToken, [textMessage(lines.join('\n'))]);
}
