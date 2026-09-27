// 三芳町の天気（Open-Meteo）。夜の通知で「明日の天気」に使う
const LAT = 35.83;
const LON = 139.53;

export interface DailyWeather {
  text: string;
  max: number;
  min: number;
  morningPop: number | null; // 7〜9時の降水確率の最大
}

// WMO 天気コード → 日本語
function describe(code: number): string {
  if (code === 0) return '晴れ';
  if (code <= 2) return '晴れ時々くもり';
  if (code === 3) return 'くもり';
  if (code === 45 || code === 48) return '霧';
  if (code >= 51 && code <= 57) return '霧雨';
  if (code >= 61 && code <= 67) return code >= 65 ? '強い雨' : '雨';
  if (code >= 71 && code <= 77) return '雪';
  if (code >= 80 && code <= 82) return 'にわか雨';
  if (code >= 85 && code <= 86) return 'にわか雪';
  if (code >= 95) return '雷雨';
  return '不明';
}

// date: JST の YYYY-MM-DD
export async function getDailyWeather(date: string): Promise<DailyWeather> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    '&hourly=precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min' +
    `&timezone=Asia%2FTokyo&start_date=${date}&end_date=${date}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!res.ok) throw new Error(`open-meteo HTTP ${res.status}`);
    const j = (await res.json()) as {
      hourly: { time: string[]; precipitation_probability: (number | null)[] };
      daily: { weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] };
    };
    const morning = j.hourly.time
      .map((t, i) => ({ hour: Number(t.slice(11, 13)), pop: j.hourly.precipitation_probability[i] }))
      .filter((h) => h.hour >= 7 && h.hour <= 9 && h.pop != null)
      .map((h) => h.pop as number);
    return {
      text: describe(j.daily.weather_code[0]),
      max: Math.round(j.daily.temperature_2m_max[0]),
      min: Math.round(j.daily.temperature_2m_min[0]),
      morningPop: morning.length ? Math.max(...morning) : null,
    };
  } finally {
    clearTimeout(timer);
  }
}
