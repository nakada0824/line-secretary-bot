interface WeatherData {
  description: string;
  temp_current: number;
  temp_max: number;
  temp_min: number;
  chance_of_rain: number;
  wind_speed_kmph: number;
  umbrella: boolean;
  tomorrow: {
    description: string;
    temp_max: number;
    temp_min: number;
    chance_of_rain: number;
    umbrella: boolean;
  } | null;
}

const maxRain = (hourly: Record<string, string>[] = []) =>
  Math.max(0, ...hourly.map((h) => parseInt(h.chanceofrain ?? '0')));

const jaDesc = (condition: Record<string, unknown>) =>
  (condition.lang_ja as { value: string }[])?.[0]?.value ??
  (condition.weatherDesc as { value: string }[])?.[0]?.value ??
  '不明';

export async function getWeather(location = 'Tokyo'): Promise<WeatherData> {
  const failed: WeatherData = {
    description: '取得できませんでした',
    temp_current: 0,
    temp_max: 0,
    temp_min: 0,
    chance_of_rain: 0,
    wind_speed_kmph: 0,
    umbrella: false,
    tomorrow: null,
  };

  try {
    const res = await fetch(
      `https://wttr.in/${encodeURIComponent(location)}?format=j1`,
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) throw new Error('Weather fetch failed');

    const json = await res.json();
    const current = json.current_condition?.[0];
    const today = json.weather?.[0];
    const tmr = json.weather?.[1];

    if (!current || !today) throw new Error('Invalid weather data');

    const todayRain = maxRain(today.hourly);

    const tomorrowData = tmr
      ? (() => {
          const rain = maxRain(tmr.hourly);
          return {
            description: jaDesc(tmr.hourly?.[4] ?? {}),
            temp_max: parseInt(tmr.maxtempC ?? '0'),
            temp_min: parseInt(tmr.mintempC ?? '0'),
            chance_of_rain: rain,
            umbrella: rain >= 50,
          };
        })()
      : null;

    return {
      description: jaDesc(current),
      temp_current: parseInt(current.temp_C ?? '0'),
      temp_max: parseInt(today.maxtempC ?? '0'),
      temp_min: parseInt(today.mintempC ?? '0'),
      chance_of_rain: todayRain,
      wind_speed_kmph: parseInt(current.windspeedKmph ?? '0'),
      umbrella: todayRain >= 50,
      tomorrow: tomorrowData,
    };
  } catch {
    return failed;
  }
}

export function formatWeather(weather: WeatherData): string {
  if (weather.description === '取得できませんでした') {
    return '🌡️ 天気情報を取得できませんでした';
  }

  const umbrella = weather.umbrella ? '☂️ 傘を持っていってね！' : '☀️ 傘は不要です';

  const lines = [
    `【今日の天気】`,
    `🌤️ ${weather.description}`,
    `🌡️ 現在 ${weather.temp_current}℃（最高 ${weather.temp_max}℃ / 最低 ${weather.temp_min}℃）`,
    `🌧️ 降水確率 ${weather.chance_of_rain}%`,
    `💨 風速 ${weather.wind_speed_kmph} km/h`,
    `${umbrella}`,
  ];

  if (weather.tomorrow) {
    const t = weather.tomorrow;
    const tUmbrella = t.umbrella ? '☂️ 傘が必要' : '☀️ 傘不要';
    lines.push(
      ``,
      `【明日の天気】`,
      `🌤️ ${t.description}`,
      `🌡️ 最高 ${t.temp_max}℃ / 最低 ${t.temp_min}℃`,
      `🌧️ 降水確率 ${t.chance_of_rain}%`,
      `${tUmbrella}`,
    );
  }

  return lines.join('\n');
}
