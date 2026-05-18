// Strip a leading ```language\n fence and the trailing ``` from a streamed
// inline-edit reply. Operates conservatively: only strips the OUTERMOST
// opening and closing fences, leaving any inner ``` blocks intact (so the
// user's code containing markdown fences survives untouched).
//
// Behavior:
//   • Opening fence: optional leading whitespace, ```optionalLanguage, then
//     either a newline OR end-of-string.
//   • Closing fence: optional trailing whitespace and a leading newline,
//     then ```, then optional trailing whitespace at the very end.
//   • If only one side is present (e.g. the model emits an opener mid-stream
//     before the closer arrives), only that side is stripped.
export function stripCodeFences(text: string): string {
  let out = text;
  const openMatch = out.match(/^[ \t]*```[a-zA-Z0-9+_-]*[ \t]*\r?\n?/);
  if (openMatch) out = out.slice(openMatch[0].length);
  const closeMatch = out.match(/\r?\n?[ \t]*```[ \t]*$/);
  if (closeMatch) out = out.slice(0, out.length - closeMatch[0].length);
  return out;
}
