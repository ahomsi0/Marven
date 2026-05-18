import { exec } from "child_process";
import { promisify } from "util";
import type { ParsedCommand } from "@/types";

const execAsync = promisify(exec);

const IS_WIN = process.platform === "win32";

// Cross-platform "open something" — uses `start` on Windows, `open` on macOS,
// `xdg-open` on Linux. The empty "" first arg to `start` is required because
// start treats the first quoted argument as a window title.
function openCmd(target: string): string {
  if (IS_WIN) return `start "" "${target}"`;
  if (process.platform === "darwin") return `open "${target}"`;
  return `xdg-open "${target}"`;
}

function openAppCmd(appName: string): string {
  // On Windows, `start` against an app name resolves Start-Menu entries and
  // PATH executables (e.g. `start "" "Spotify"` or `start "" "chrome"`).
  if (IS_WIN) return `start "" "${appName}"`;
  if (process.platform === "darwin") return `open -a "${appName}"`;
  // Linux: assume the app is on PATH; spawn it detached. xdg-open won't help
  // for arbitrary app names.
  return `${appName} &`;
}

/**
 * Executes a parsed command.
 * Only handles known, safe command types — no arbitrary shell execution.
 * App / website / search commands work cross-platform; the rest of the
 * natural-language actions (volume, media, screenshots…) are macOS-only.
 */
export async function executeCommand(
  command: ParsedCommand
): Promise<string> {
  switch (command.type) {
    case "open-website": {
      const url = command.payload;
      await execAsync(openCmd(url));
      const name = new URL(url).hostname.replace(/^www\./, "");
      return `Opening ${name}.`;
    }

    case "open-app": {
      const appName = command.payload;
      await execAsync(openAppCmd(appName));
      return `Launching ${appName}.`;
    }

    case "google-search": {
      const query = command.payload;
      const encoded = encodeURIComponent(query);
      const searchUrl = `https://www.google.com/search?q=${encoded}`;
      await execAsync(openCmd(searchUrl));
      return `Searching Google for "${query}".`;
    }

    case "get-time": {
      const now = new Date();
      return `The current time is ${now.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })}.`;
    }

    case "get-date": {
      const now = new Date();
      return `Today is ${now.toLocaleDateString([], {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })}.`;
    }

    case "take-screenshot": {
      // -i = interactive selection; saves to Desktop with epoch timestamp
      await execAsync(
        `screencapture -i ~/Desktop/screenshot-$(date +%s).png`
      );
      return "Screenshot saved to your Desktop.";
    }

    case "lock-screen": {
      await execAsync("pmset displaysleepnow");
      return "Locking the screen.";
    }

    case "open-downloads": {
      await execAsync("open ~/Downloads");
      return "Opening your Downloads folder.";
    }

    case "empty-trash": {
      await execAsync(
        `osascript -e 'tell application "Finder" to empty trash'`
      );
      return "Trash emptied.";
    }

    case "volume-up":
      await execAsync(`osascript -e 'set volume output volume ((output volume of (get volume settings)) + 10)'`);
      return "Volume up.";

    case "volume-down":
      await execAsync(`osascript -e 'set volume output volume ((output volume of (get volume settings)) - 10)'`);
      return "Volume down.";

    case "volume-mute":
      await execAsync(`osascript -e 'set volume with output muted'`);
      return "Muted.";

    case "volume-unmute":
      await execAsync(`osascript -e 'set volume without output muted'`);
      return "Unmuted.";

    case "set-volume": {
      const level = Math.min(100, Math.max(0, parseInt(command.payload, 10)));
      await execAsync(`osascript -e 'set volume output volume ${level}'`);
      return `Volume set to ${level}%.`;
    }

    case "media-play-pause":
      try {
        await execAsync(`osascript -e 'tell application "Spotify" to playpause'`);
      } catch {
        await execAsync(`osascript -e 'tell application "Music" to playpause'`);
      }
      return "Toggled playback.";

    case "media-next":
      try {
        await execAsync(`osascript -e 'tell application "Spotify" to next track'`);
      } catch {
        await execAsync(`osascript -e 'tell application "Music" to next track'`);
      }
      return "Next track.";

    case "media-previous":
      try {
        await execAsync(`osascript -e 'tell application "Spotify" to previous track'`);
      } catch {
        await execAsync(`osascript -e 'tell application "Music" to previous track'`);
      }
      return "Previous track.";

    case "media-what-playing": {
      try {
        const { stdout: spotifyOut } = await execAsync(`osascript -e 'tell application "Spotify" to return (get name of current track) & " by " & (get artist of current track)'`);
        return `Playing: ${spotifyOut.trim()}`;
      } catch {
        try {
          const { stdout: musicOut } = await execAsync(`osascript -e 'tell application "Music" to return (get name of current track) & " by " & (get artist of current track)'`);
          return `Playing: ${musicOut.trim()}`;
        } catch {
          return "Nothing is currently playing.";
        }
      }
    }

    case "get-battery": {
      const { stdout: battOut } = await execAsync("pmset -g batt");
      const battMatch = battOut.match(/(\d+)%/);
      const pct = battMatch ? parseInt(battMatch[1], 10) : null;
      return pct !== null ? `Battery is at ${pct}%.` : "Could not read battery level.";
    }

    case "get-weather":
      return "Please ask me about the weather in natural language.";

    case "remember":
      return "Memory noted.";

    default:
      throw new Error("Unknown command type");
  }
}
