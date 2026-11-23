// The line Mini Me shows when voice fails. Typing always still works.

export function voiceNotice(error: string): string {
  const base = `Voice isn't available: ${error}`;
  if (/permission|NotAllowed|mic-denied/i.test(error)) {
    return `${base}. Allow microphone access for Marven in System Settings → Privacy & Security, or just type.`;
  }
  return base;
}
