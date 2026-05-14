import { searchWithClaude, searchRestaurantWithClaude } from '@/lib/claude';

export async function searchQuery(query: string): Promise<string> {
  if (!query) return '調べたいことを教えてください。\n\n例：「東京タワーの高さ調べて」';
  return searchWithClaude(query);
}

export async function searchRestaurant(data: Record<string, unknown>): Promise<string> {
  return searchRestaurantWithClaude({
    area: data.area as string | undefined,
    genre: data.genre as string | undefined,
    budget: data.budget as string | undefined,
    keywords: data.keywords as string | undefined,
  });
}
