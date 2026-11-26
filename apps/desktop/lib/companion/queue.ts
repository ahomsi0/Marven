// What Mini Me does next when a run ends: queued changes to the current
// project run together, a new project runs on its own. Pure.

export type QueuedJob = { kind: "build"; request: string; name: string } | { kind: "edit"; request: string };
export type Job = { kind: "build"; request: string; name: string } | { kind: "edit"; requests: string[] };

/** The next run from the front of the queue, and what's left. */
export function takeNext(queue: QueuedJob[]): { job: Job; rest: QueuedJob[] } | null {
  if (queue.length === 0) return null;
  const [first, ...rest] = queue;
  if (first.kind === "build") return { job: first, rest };
  const requests = [first.request];
  let i = 0;
  while (i < rest.length) {
    const next = rest[i];
    if (next.kind !== "edit") break;
    requests.push(next.request);
    i++;
  }
  return { job: { kind: "edit", requests }, rest: rest.slice(i) };
}

/** The request the Agent gets for a batch of changes. */
export function editRequestText(requests: string[]): string {
  if (requests.length === 1) return requests[0];
  return `Make these changes:\n${requests.map((r, i) => `${i + 1}. ${r}`).join("\n")}`;
}
