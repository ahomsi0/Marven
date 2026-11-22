import { NextRequest, NextResponse } from "next/server";
import { exec, execFile } from "child_process";
import { promisify } from "util";
import { crossOriginRejection } from "@/lib/apiGuards";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

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
  const rejection = crossOriginRejection(req);
  if (rejection) return NextResponse.json({ ok: false, error: rejection }, { status: 403 });

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
        const appName = (payload ?? "").trim();
        // App names come from a small UI picker, not a shell. Keep a strict
        // character allowlist and pass the value as an argument to avoid shell
        // expansion through $(), backticks, separators, or redirections.
        if (!appName || appName.length > 200 || !/^[\p{L}\p{N} ._+\-()]+$/u.test(appName)) {
          return NextResponse.json({ ok: false, error: "Invalid application name" }, { status: 400 });
        }
        if (process.platform === "win32") {
          await execFileAsync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "start", "", appName]);
        } else if (process.platform === "darwin") {
          await execFileAsync("open", ["-a", appName]);
        } else {
          await execFileAsync("xdg-open", [appName]);
        }
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
