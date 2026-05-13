import { NextResponse } from "next/server";

function wmoCodeToDescription(code: number): string {
  if (code === 0) return "Clear sky";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Foggy";
  if (code === 51 || code === 53 || code === 55) return "Drizzle";
  if (code === 61 || code === 63 || code === 65) return "Rain";
  if (code === 71 || code === 73 || code === 75) return "Snow";
  if (code === 80 || code === 81 || code === 82) return "Showers";
  if (code === 95) return "Thunderstorm";
  return "Unknown";
}

export async function GET() {
  try {
    const locationRes = await fetch("https://ipapi.co/json/", {
      headers: { "User-Agent": "Marven/1.0" },
    });
    if (!locationRes.ok) throw new Error("Location fetch failed");
    const location = await locationRes.json();

    const { latitude, longitude, city } = location as {
      latitude: number;
      longitude: number;
      city: string;
    };

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weathercode,windspeed_10m&temperature_unit=celsius`;
    const weatherRes = await fetch(weatherUrl);
    if (!weatherRes.ok) throw new Error("Weather fetch failed");
    const weatherData = await weatherRes.json();

    const current = weatherData.current as {
      temperature_2m: number;
      weathercode: number;
    };

    const temp = Math.round(current.temperature_2m);
    const description = wmoCodeToDescription(current.weathercode);

    return NextResponse.json(
      { city: city ?? "Unknown", temp, description, unit: "C" },
      { headers: { "Cache-Control": "max-age=1800" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
