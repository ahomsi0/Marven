/**
 * Build a file:// URI suitable for shell.openExternal / OS handlers.
 * Encodes path segments; Windows drive letters keep a literal `C:`.
 */
export function absolutePathToFileUrl(absPath: string): string {
  const norm = absPath.replace(/\\/g, "/");
  // Windows: C:/Users/... or C:\...
  if (/^[a-zA-Z]:\//.test(norm)) {
    const drive = norm.slice(0, 2);
    const tail = norm.slice(3);
    const encodedTail = tail
      .split("/")
      .filter((s) => s.length > 0)
      .map(encodeURIComponent)
      .join("/");
    return `file:///${drive}/${encodedTail}`;
  }
  const withSlash = norm.startsWith("/") ? norm : `/${norm}`;
  return (
    "file://" +
    withSlash
      .split("/")
      .map(encodeURIComponent)
      .join("/")
      .replace(/%2F/g, "/")
  );
}
