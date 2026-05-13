import { NextResponse } from "next/server";

interface RssItem {
  title?: string;
}

interface Rss2JsonResponse {
  items?: RssItem[];
}

export async function GET() {
  try {
    const res = await fetch(
      "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Ffeeds.bbci.co.uk%2Fnews%2Frss.xml&count=5"
    );
    if (!res.ok) throw new Error("RSS fetch failed");
    const data = (await res.json()) as Rss2JsonResponse;
    const headlines = (data.items ?? [])
      .map((item) => item.title ?? "")
      .filter(Boolean);
    return NextResponse.json(
      { headlines },
      { headers: { "Cache-Control": "max-age=1800" } }
    );
  } catch {
    return NextResponse.json({ headlines: [] });
  }
}
