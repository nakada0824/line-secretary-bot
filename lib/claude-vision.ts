import Anthropic from '@anthropic-ai/sdk';
import type { ScannedSchedule } from '@/types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function scanImageForSchedules(
  imageBase64: string,
  mimeType: string
): Promise<ScannedSchedule[]> {
  const year = new Date().getFullYear();

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: imageBase64,
            },
          },
          {
            type: 'text',
            text: `この画像からスケジュール・予定情報を全て読み取ってください。
現在: ${year}年

以下のJSON配列のみを返してください（説明文・コードブロック不要）：
[{"title":"予定名","start_time":"ISO8601形式 or null","end_time":"ISO8601形式 or null","location":"場所 or null","description":"備考 or null","needs_confirmation":false}]

【ルール】
- タイムゾーン: Asia/Tokyo（+09:00）
- 日付が読み取れない・曖昧な場合: start_time を null、needs_confirmation を true
- 時刻が不明な場合: T00:00:00+09:00 を設定し needs_confirmation を true
- 年が省略されている場合: ${year}年と仮定
- 予定が見つからない場合: 空配列 []`,
          },
        ],
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '[]';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    return JSON.parse(jsonMatch[0]) as ScannedSchedule[];
  } catch {
    return [];
  }
}
