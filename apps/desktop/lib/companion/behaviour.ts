// Mini Me's behaviour: a pure state machine. Events in, animation state and
// movement intents out. Time and randomness come in with the events, so it is
// fully deterministic under test.

export type AnimState =
  | "idle" | "walk" | "look" | "sit" | "stretch" | "sleep"
  | "listen" | "think" | "talk" | "happy" | "confused" | "dangle";

/** roam: lives on the Dock strip and wanders. perched: dropped elsewhere, sits and stays. */
export type Mode = "roam" | "perched";

export interface BehaviourState {
  anim: AnimState;
  mode: Mode;
  /** The bubble is open or a request is in flight: the idle loop and sleep pause. */
  busy: boolean;
  lastInteraction: number;
  nextIdleAt: number;
}

export interface Strip {
  minX: number;
  maxX: number;
}

export type BehaviourEvent =
  | { type: "tick"; now: number; rand: () => number; strip: Strip; walkAround: boolean; sleepAfterMs: number }
  | { type: "arrived"; now: number }
  | { type: "interact"; now: number }
  | { type: "bubble-open"; now: number }
  | { type: "bubble-close"; now: number }
  | { type: "thinking"; now: number }
  | { type: "talking"; now: number }
  | { type: "succeeded"; now: number }
  | { type: "failed"; now: number }
  | { type: "oneshot-done"; now: number }
  | { type: "drag-start"; now: number }
  | { type: "drop"; now: number; inDock: boolean }
  | { type: "return-home"; now: number };

export interface Effect {
  walkTo?: number;
  stop?: true;
  returnHome?: true;
}

/** Animations that play once and then report "oneshot-done". */
export const ONESHOTS: ReadonlySet<AnimState> = new Set<AnimState>(["stretch", "happy", "confused"]);

const IDLE_PAUSE_MS = 4000;
const IDLE_PAUSE_JITTER_MS = 6000;

export function initialState(now: number): BehaviourState {
  return { anim: "idle", mode: "roam", busy: false, lastInteraction: now, nextIdleAt: now + IDLE_PAUSE_MS };
}

const resting = (state: BehaviourState): AnimState => (state.mode === "perched" ? "sit" : "idle");

function pickIdle(
  state: BehaviourState,
  e: Extract<BehaviourEvent, { type: "tick" }>,
): { state: BehaviourState; effect: Effect } {
  const r = e.rand();
  if (e.walkAround && state.mode === "roam") {
    if (r < 0.4) {
      const x = Math.round(e.strip.minX + e.rand() * (e.strip.maxX - e.strip.minX));
      const nextIdleAt = e.now + IDLE_PAUSE_MS + e.rand() * IDLE_PAUSE_JITTER_MS;
      return { state: { ...state, anim: "walk", nextIdleAt }, effect: { walkTo: x } };
    }
    const anim: AnimState = r < 0.65 ? "idle" : r < 0.8 ? "look" : r < 0.95 ? "sit" : "stretch";
    const nextIdleAt = e.now + IDLE_PAUSE_MS + e.rand() * IDLE_PAUSE_JITTER_MS;
    return { state: { ...state, anim, nextIdleAt }, effect: {} };
  }
  const anim: AnimState = r < 0.5 ? "idle" : r < 0.75 ? "sit" : "look";
  const nextIdleAt = e.now + IDLE_PAUSE_MS + e.rand() * IDLE_PAUSE_JITTER_MS;
  return { state: { ...state, anim, nextIdleAt }, effect: {} };
}

export function reduce(state: BehaviourState, e: BehaviourEvent): { state: BehaviourState; effect: Effect } {
  const none = { state, effect: {} as Effect };
  switch (e.type) {
    case "tick": {
      if (state.busy || state.anim === "sleep" || state.anim === "walk" || state.anim === "dangle" || ONESHOTS.has(state.anim)) {
        return none;
      }
      if (e.now - state.lastInteraction >= e.sleepAfterMs) {
        return { state: { ...state, anim: "sleep" }, effect: { stop: true } };
      }
      if (e.now < state.nextIdleAt) return none;
      return pickIdle(state, e);
    }
    case "arrived":
      if (state.anim !== "walk") return none;
      return { state: { ...state, anim: "idle", nextIdleAt: e.now + IDLE_PAUSE_MS }, effect: {} };
    case "interact": {
      const next = { ...state, lastInteraction: e.now };
      return { state: state.anim === "sleep" ? { ...next, anim: "stretch" } : next, effect: {} };
    }
    case "bubble-open":
      return { state: { ...state, busy: true, anim: "listen", lastInteraction: e.now }, effect: { stop: true } };
    case "bubble-close":
      return {
        state: { ...state, busy: false, anim: resting(state), lastInteraction: e.now, nextIdleAt: e.now + IDLE_PAUSE_MS },
        effect: {},
      };
    case "thinking":
      return { state: { ...state, busy: true, anim: "think", lastInteraction: e.now }, effect: { stop: true } };
    case "talking":
      return { state: { ...state, busy: true, anim: "talk", lastInteraction: e.now }, effect: {} };
    case "succeeded":
      return { state: { ...state, anim: "happy", lastInteraction: e.now }, effect: {} };
    case "failed":
      return { state: { ...state, anim: "confused", lastInteraction: e.now }, effect: {} };
    case "oneshot-done":
      if (!ONESHOTS.has(state.anim)) return none;
      return { state: { ...state, anim: resting(state), nextIdleAt: e.now + IDLE_PAUSE_MS }, effect: {} };
    case "drag-start":
      return { state: { ...state, anim: "dangle", lastInteraction: e.now }, effect: { stop: true } };
    case "drop": {
      const mode: Mode = e.inDock ? "roam" : "perched";
      return {
        state: { ...state, mode, anim: e.inDock ? "idle" : "sit", lastInteraction: e.now, nextIdleAt: e.now + IDLE_PAUSE_MS },
        effect: {},
      };
    }
    case "return-home":
      return { state: { ...state, mode: "roam", anim: "walk", lastInteraction: e.now }, effect: { returnHome: true } };
  }
}
