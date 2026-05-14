import { chat as claudeChat } from '@/lib/claude';

export async function chat(
  message: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<string> {
  return claudeChat(message, history);
}
