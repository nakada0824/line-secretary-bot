import { NextRequest } from 'next/server';
import { verifySignature, replyMessage, textMessage } from '@/lib/line';
import {
  upsertUser,
  getConversationHistory,
  saveConversation,
  savePendingScan,
  getPendingScan,
  clearPendingScan,
  bulkInsertSchedules,
} from '@/lib/supabase';
import { detectIntent } from '@/lib/claude';
import { scanImageForSchedules } from '@/lib/claude-vision';
import { handleIntent } from '@/lib/handlers';
import { runBackgroundReminders } from '@/lib/handlers/report';
import { checkRateLimit, cleanupRateLimit, logSecurity, logError } from '@/lib/security';
import { LineEvent } from '@/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BODY_BYTES  = 512 * 1024;
const MAX_MSG_LENGTH  = 1_000;

const CONFIRM_YES = /^(はい|yes|登録(して)?|ok|OK|オッケー|お願い(します?)?|よろしく)[!！。\s]*$/i;
const CONFIRM_NO  = /^(いいえ|no|キャンセル|やめ(る|て|ます)?|不要|取消|取り消し)[!！。\s]*$/i;

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
            '📅 「明日14時に会議」→ 予定追加・管理',
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

    // ── 画像スキャン確認（「はい」「いいえ」）──────────────────────────────
    if (await checkPendingScanConfirmation(userId, userMessage, replyToken)) return;

    // ── 通常のインテント処理 ───────────────────────────────────────────────
    const intentResult = await detectIntent(userMessage, history);
    const response     = await handleIntent(userId, intentResult, userMessage, history);

    await replyMessage(replyToken, [textMessage(response)]);

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

  lines.push('', '「はい」で登録、「いいえ」でキャンセル');

  await savePendingScan(userId, schedules);
  await replyMessage(replyToken, [textMessage(lines.join('\n'))]);
}

// ── 画像スキャン確認フロー ────────────────────────────────────────────────────

async function checkPendingScanConfirmation(
  userId: string,
  userMessage: string,
  replyToken: string
): Promise<boolean> {
  const isYes = CONFIRM_YES.test(userMessage);
  const isNo  = CONFIRM_NO.test(userMessage);
  if (!isYes && !isNo) return false;

  const pending = await getPendingScan(userId);
  if (!pending) return false;  // 保留スキャンがなければ通常処理へ

  if (isNo) {
    await clearPendingScan(userId);
    await replyMessage(replyToken, [
      textMessage('キャンセルしました。また画像を送ってください😊'),
    ]);
    return true;
  }

  // 「はい」→ 一括登録
  const registered = await bulkInsertSchedules(userId, pending);
  await clearPendingScan(userId);

  if (registered === 0) {
    await replyMessage(replyToken, [
      textMessage('日時が確定している予定がありませんでした。\n別の画像をお試しください。'),
    ]);
    return true;
  }

  await replyMessage(replyToken, [
    textMessage(
      `✅ ${registered}件の予定を登録しました！\n\n📅 カレンダーで確認できます\nhttps://secretary-app-bay.vercel.app/calendar`
    ),
  ]);
  return true;
}
