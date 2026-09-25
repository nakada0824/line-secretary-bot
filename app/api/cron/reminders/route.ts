import { NextRequest } from 'next/server';
import { runAllReminders } from '@/lib/handlers/report';

export const runtime = 'nodejs';
export const maxDuration = 60;

// GitHub Actions（.github/workflows/reminders.yml）から5分おきに呼ばれる
export async function GET(request: NextRequest): Promise<Response> {
  const secret = process.env.REMINDER_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response(null, { status: 401 });
  }

  const { users } = await runAllReminders();
  return Response.json({ checked: users });
}
