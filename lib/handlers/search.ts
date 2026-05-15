import {
  searchWithClaude,
  searchRestaurantWithClaude,
  searchOutingWithClaude,
  searchNewsWithClaude,
  searchEntertainmentWithClaude,
  searchRecipeWithClaude,
  summarizeUrlWithClaude,
  translateWithClaude,
} from '@/lib/claude';
import { getWeather, formatWeather } from '@/lib/weather';

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

export async function searchWeather(query: string): Promise<string> {
  // wttr.in API を直接呼び出す（web_search 不要・高速）
  const location = query || '東京';
  const weather = await getWeather(location);
  return formatWeather(weather);
}

export async function searchOuting(data: Record<string, unknown>): Promise<string> {
  return searchOutingWithClaude({
    from: data.from as string | undefined,
    area: data.area as string | undefined,
    budget: data.budget as string | undefined,
    duration: data.duration as string | undefined,
    preferences: data.preferences as string | undefined,
  });
}

export async function searchNews(data: Record<string, unknown>): Promise<string> {
  return searchNewsWithClaude({
    category: data.category as string | undefined,
    query: data.query as string | undefined,
  });
}

export async function searchEntertainment(data: Record<string, unknown>): Promise<string> {
  return searchEntertainmentWithClaude({
    type: data.type as string | undefined,
    genre: data.genre as string | undefined,
    keywords: data.keywords as string | undefined,
  });
}

export async function searchRecipe(data: Record<string, unknown>): Promise<string> {
  if (!data.dish) return 'レシピを調べる料理名を教えてください。\n\n例：「カレーのレシピ教えて」';
  return searchRecipeWithClaude({
    dish: data.dish as string,
    keywords: data.keywords as string | undefined,
  });
}

export async function summarizeUrl(data: Record<string, unknown>): Promise<string> {
  if (!data.url) return 'URLを送ってください。';
  return summarizeUrlWithClaude(data.url as string);
}

export async function translate(data: Record<string, unknown>): Promise<string> {
  if (!data.text || !data.target_lang) return '翻訳するテキストと翻訳先の言語を教えてください。\n\n例：「Hello を日本語に翻訳して」';
  return translateWithClaude({
    text: data.text as string,
    target_lang: data.target_lang as string,
    source_lang: data.source_lang as string | undefined,
  });
}
