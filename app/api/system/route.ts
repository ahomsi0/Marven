import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action");

  if (action === "battery") {
    try {
      const { stdout } = await execAsync("pmset -g batt");
      const match = stdout.match(/(\d+)%/);
      const battery = match ? parseInt(match[1], 10) : null;
      if (battery === null) {
        return NextResponse.json({ error: "Could not parse battery level" }, { status: 500 });
      }
      return NextResponse.json({ battery });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function POST(req: NextRequest) {
  let body: { action: string; payload?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  const { action, payload } = body;

  try {
    switch (action) {
      case "volume-set": {
        const level = Math.min(100, Math.max(0, parseInt(payload ?? "50", 10)));
        await execAsync(`osascript -e 'set volume output volume ${level}'`);
        return NextResponse.json({ ok: true, message: `Volume set to ${level}%.` });
      }

      case "volume-up": {
        await execAsync(`osascript -e 'set volume output volume ((output volume of (get volume settings)) + 10)'`);
        return NextResponse.json({ ok: true, message: "Volume up." });
      }

      case "volume-down": {
        await execAsync(`osascript -e 'set volume output volume ((output volume of (get volume settings)) - 10)'`);
        return NextResponse.json({ ok: true, message: "Volume down." });
      }

      case "volume-mute": {
        await execAsync(`osascript -e 'set volume with output muted'`);
        return NextResponse.json({ ok: true, message: "Muted." });
      }

      case "volume-unmute": {
        await execAsync(`osascript -e 'set volume without output muted'`);
        return NextResponse.json({ ok: true, message: "Unmuted." });
      }

      case "media-play-pause": {
        try {
          await execAsync(`osascript -e 'tell application "Spotify" to playpause'`);
        } catch {
          await execAsync(`osascript -e 'tell application "Music" to playpause'`);
        }
        return NextResponse.json({ ok: true, message: "Toggled playback." });
      }

      case "media-next": {
        try {
          await execAsync(`osascript -e 'tell application "Spotify" to next track'`);
        } catch {
          await execAsync(`osascript -e 'tell application "Music" to next track'`);
        }
        return NextResponse.json({ ok: true, message: "Next track." });
      }

      case "media-previous": {
        try {
          await execAsync(`osascript -e 'tell application "Spotify" to previous track'`);
        } catch {
          await execAsync(`osascript -e 'tell application "Music" to previous track'`);
        }
        return NextResponse.json({ ok: true, message: "Previous track." });
      }

      case "media-what-playing": {
        try {
          const { stdout } = await execAsync(`osascript -e 'tell application "Spotify" to return (get name of current track) & " by " & (get artist of current track)'`);
          return NextResponse.json({ ok: true, message: `Playing: ${stdout.trim()}` });
        } catch {
          try {
            const { stdout } = await execAsync(`osascript -e 'tell application "Music" to return (get name of current track) & " by " & (get artist of current track)'`);
            return NextResponse.json({ ok: true, message: `Playing: ${stdout.trim()}` });
          } catch {
            return NextResponse.json({ ok: true, message: "Nothing is currently playing." });
          }
        }
      }

      case "open-app": {
        const appName = (payload ?? "").replace(/['"]/g, "");
        // Cross-platform: `start ""` on Windows resolves Start-Menu and PATH
        // entries; `open -a` is macOS; xdg-open is a best-effort on Linux.
        const cmd =
          process.platform === "win32"
            ? `start "" "${appName}"`
            : process.platform === "darwin"
            ? `open -a "${appName}"`
            : `xdg-open "${appName}"`;
        await execAsync(cmd);
        return NextResponse.json({ ok: true, message: `Opening ${appName}.` });
      }

      case "dnd-on": {
        await execAsync(`defaults write com.apple.notificationcenterui doNotDisturb -bool true && killall NotificationCenter`);
        return NextResponse.json({ ok: true, message: "Do Not Disturb enabled." });
      }

      default:
        return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
