// The line Mini Me shows when voice fails. Typing always still works.

type Translate = (key: string, opts?: Record<string, unknown>) => string;

export function voiceNotice(error: string, t: Translate): string {
  const base = t("companion.voiceUnavailable", { error });
  if (/permission|NotAllowed|mic-denied/i.test(error)) {
    return `${base}. ${t("companion.voiceMicHint")}`;
  }
  return base;
}
