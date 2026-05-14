interface WeatherData {
  description: string;
  temp_max: number;
  temp_min: number;
  umbrella: boolean;
}

export async function getWeather(location = 'Tokyo'): Promise<WeatherData> {
  try {
    const res = await fetch(
      `https://wttr.in/${encodeURIComponent(location)}?format=j1`,
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) throw new Error('Weather fetch failed');

    const json = await res.json();
    const current = json.current_condition?.[0];
    const today = json.weather?.[0];

    if (!current || !today) throw new Error('Invalid weather data');

    const desc = current.lang_ja?.[0]?.value ?? current.weatherDesc?.[0]?.value ?? '不明';
    const tempMax = parseInt(today.maxtempC ?? '20');
    const tempMin = parseInt(today.mintempC ?? '15');
    const chanceOfRain = Math.max(
      ...(today.hourly ?? []).map((h: Record<string, string>) => parseInt(h.chanceofrain ?? '0'))
    );

    return {
      description: desc,
      temp_max: tempMax,
      temp_min: tempMin,
      umbrella: chanceOfRain >= 50,
    };
  } catch {
    return { description: '取得できませんでした', temp_max: 0, temp_min: 0, umbrella: false };
  }
}

export function formatWeather(weather: WeatherData): string {
  if (weather.description === '取得できませんでした') {
    return '🌡️ 天気情報を取得できませんでした';
  }
  const umbrella = weather.umbrella ? '\n☂️ 今日は傘を持っていってね！' : '\n☀️ 傘は不要です';
  return `🌤️ ${weather.description}　最高${weather.temp_max}℃ / 最低${weather.temp_min}℃${umbrella}`;
}
