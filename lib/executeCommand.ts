import { exec, execFile } from "child_process";
import { promisify } from "util";
import type { ParsedCommand } from "@/types";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const IS_WIN = process.platform === "win32";

function parseExternalUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs can be opened.");
  }
  return url;
}

async function openExternal(raw: string): Promise<URL> {
  const url = parseExternalUrl(raw);
  const target = url.toString();

  // Pass the URL as an argument, never through a shell. This matters because
  // the chat parser accepts arbitrary HTTP(S) URLs from user input.
  if (IS_WIN) await execFileAsync("explorer.exe", [target]);
  else if (process.platform === "darwin") await execFileAsync("open", [target]);
  else await execFileAsync("xdg-open", [target]);

  return url;
}

function validateAppName(appName: string): string {
  const trimmed = appName.trim();
  // App names originate from a fixed parser map in normal use. Keep the
  // library safe for direct callers too: no shell metacharacters or newlines.
  if (!trimmed || !/^[\p{L}\p{N} ._+()\-]+$/u.test(trimmed)) {
    throw new Error("Invalid application name.");
  }
  return trimmed;
}

async function openApp(appName: string): Promise<void> {
  const safeName = validateAppName(appName);
  if (IS_WIN) {
    // `start` resolves Start-Menu entries and PATH executables. The app name
    // has already been restricted to inert characters above.
    await execFileAsync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "start", "", safeName]);
  } else if (process.platform === "darwin") {
    await execFileAsync("open", ["-a", safeName]);
  } else {
    // Linux app names are commonly executable names. No shell is involved.
    await execFileAsync(safeName, []);
  }
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
      const parsed = await openExternal(url);
      const name = parsed.hostname.replace(/^www\./, "");
      return `Opening ${name}.`;
    }

    case "open-app": {
      const appName = command.payload;
      await openApp(appName);
      return `Launching ${appName}.`;
    }

    case "google-search": {
      const query = command.payload;
      const encoded = encodeURIComponent(query);
      const searchUrl = `https://www.google.com/search?q=${encoded}`;
      await openExternal(searchUrl);
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
