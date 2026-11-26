// Mini Me's behaviour: a pure state machine. Events in, animation state and
// movement intents out. Time and randomness come in with the events, so it is
// fully deterministic under test.

export type AnimState =
  | "idle" | "walk" | "look" | "sit" | "stretch" | "sleep"
  | "listen" | "think" | "talk" | "happy" | "confused" | "dangle"
  /** Building or changing a project: he paints a canvas with a roller. */
  | "paint";

/** roam: lives on the Dock strip and wanders. perched: dropped elsewhere, sits and stays. */
export type Mode = "roam" | "perched";

export interface BehaviourState {
  anim: AnimState;
  mode: Mode;
  /** The bubble is open or a request is in flight: the idle loop and sleep pause. */
  busy: boolean;
  /** True while seated by the rest ladder (left alone for a while): no idle picks until interaction. */
  resting: boolean;
  lastInteraction: number;
  nextIdleAt: number;
  /** A walk that has not arrived by this time is abandoned. */
  walkUntil: number;
  /** Dropped off the Dock with "fall back to the Dock": plunging until the next "arrived". */
  falling: boolean;
  /** A project is being built or changed: he paints between everything else, and doesn't wander or sleep. */
  working: boolean;
}

export interface Strip {
  minX: number;
  maxX: number;
}

/** lively: walk, look, repeat. calm: occasional short strolls. still: never walks on its own. */
export type Activity = "lively" | "calm" | "still";

export type BehaviourEvent =
  | {
      type: "tick";
      now: number;
      rand: () => number;
      strip: Strip;
      activity: Activity;
      /** Window x, so calm strolls stay near where it stands. */
      x: number;
      /** Left alone this long, he sits and stays seated. */
      restAfterMs: number;
      sleepAfterMs: number;
    }
  | { type: "arrived"; now: number; rand: () => number; activity?: Activity }
  | { type: "interact"; now: number; rand?: () => number }
  | { type: "bubble-open"; now: number }
  | { type: "bubble-close"; now: number; rand?: () => number }
  | { type: "thinking"; now: number }
  /** A build or change started (he paints until "build-ended"). */
  | { type: "building"; now: number }
  | { type: "build-ended"; now: number }
  | { type: "talking"; now: number }
  | { type: "succeeded"; now: number }
  | { type: "failed"; now: number }
  | { type: "oneshot-done"; now: number; rand?: () => number }
  /**
   * The page must send `drop` on pointerup, pointercancel and
   * lostpointercapture; otherwise the character stays dangling.
   */
  | { type: "drag-start"; now: number }
  /** See `drag-start`: sent whenever a drag ends, however it ends. */
  | { type: "drop"; now: number; inDock: boolean; /** Main is dropping him to the Dock; "arrived" follows when he lands. */ falling?: boolean }
  | { type: "return-home"; now: number };

export interface Effect {
  walkTo?: number;
  stop?: true;
  returnHome?: true;
}

/** Animations that play once and then report "oneshot-done". */
export const ONESHOTS: ReadonlySet<AnimState> = new Set<AnimState>(["stretch", "happy", "confused"]);

const IDLE_PAUSE_MS = 4000;
const WALK_TIMEOUT_MS = 180_000;
const LIVELY_PAUSE_MS = 1500;
const LIVELY_PAUSE_JITTER_MS = 2500;
const MIN_STROLL_PX = 40;
const LOOK_MIN_MS = 2000;
const LOOK_JITTER_MS = 2000;
const STRETCH_CHANCE = 0.15;
const CALM_PAUSE_MS = 8000;
const CALM_PAUSE_JITTER_MS = 12_000;
const CALM_STROLL_PX = 160;
const STILL_PAUSE_MS = 6000;
const STILL_PAUSE_JITTER_MS = 6000;

export function initialState(now: number): BehaviourState {
  return { anim: "idle", mode: "roam", busy: false, resting: false, lastInteraction: now, nextIdleAt: now + IDLE_PAUSE_MS, walkUntil: 0, falling: false, working: false };
}

/** How long a lively Mini Me waits before his next pick (events without a rand use the midpoint). */
const livelyPause = (now: number, rand?: () => number) => now + LIVELY_PAUSE_MS + (rand ? rand() : 0.5) * LIVELY_PAUSE_JITTER_MS;

/** His resting pose: painting while a project is built, else standing (or sitting where he was dropped). */
const standing = (state: BehaviourState): AnimState => (state.working ? "paint" : state.mode === "perched" ? "sit" : "idle");

const stopIfWalking = (state: BehaviourState): Effect => (state.anim === "walk" ? { stop: true } : {});

const pickPoint = (strip: Strip, rand: () => number) => Math.round(strip.minX + rand() * (strip.maxX - strip.minX));

function startWalk(state: BehaviourState, now: number, x: number, nextIdleAt: number) {
  return { state: { ...state, anim: "walk" as const, nextIdleAt, walkUntil: now + WALK_TIMEOUT_MS }, effect: { walkTo: x } as Effect };
}

function pickIdle(
  state: BehaviourState,
  e: Extract<BehaviourEvent, { type: "tick" }>,
): { state: BehaviourState; effect: Effect } {
  // Perched on the desktop he never walks, whatever the setting.
  const activity: Activity = state.mode === "perched" ? "still" : e.activity;
  const lookAround = (nextIdleAt: number) => ({ state: { ...state, anim: "look" as const, nextIdleAt }, effect: {} as Effect });
  const stripKnown = e.strip.maxX > e.strip.minX;
  if (activity === "lively") {
    if (!stripKnown) return lookAround(livelyPause(e.now, e.rand));
    return startWalk(state, e.now, pickPoint(e.strip, e.rand), e.now + IDLE_PAUSE_MS);
  }
  if (activity === "calm") {
    const r = e.rand();
    const clamp = (x: number) => Math.round(Math.min(e.strip.maxX, Math.max(e.strip.minX, x)));
    let target: number | null = null;
    if (r < 0.3 && stripKnown) {
      const offset = (e.rand() * 2 - 1) * CALM_STROLL_PX;
      target = clamp(e.x + offset);
      // Too little room that way: mirror it, and if that is no better, just look.
      if (Math.abs(target - e.x) < MIN_STROLL_PX) target = clamp(e.x - offset);
      if (Math.abs(target - e.x) < MIN_STROLL_PX) target = null;
    }
    const nextIdleAt = e.now + CALM_PAUSE_MS + e.rand() * CALM_PAUSE_JITTER_MS;
    if (target !== null) return startWalk(state, e.now, target, nextIdleAt);
    return { state: { ...state, anim: r < 0.7 ? "look" : "idle", nextIdleAt }, effect: {} };
  }
  const nextIdleAt = e.now + STILL_PAUSE_MS + e.rand() * STILL_PAUSE_JITTER_MS;
  return { state: { ...state, anim: state.anim === "look" ? "idle" : "look", nextIdleAt }, effect: {} };
}

export function reduce(state: BehaviourState, e: BehaviourEvent): { state: BehaviourState; effect: Effect } {
  const none = { state, effect: {} as Effect };
  switch (e.type) {
    case "tick": {
      if (state.anim === "walk" && e.now >= state.walkUntil) {
        return { state: { ...state, anim: standing(state), nextIdleAt: livelyPause(e.now, e.rand) }, effect: { stop: true } };
      }
      if (state.busy || state.working || state.anim === "sleep" || state.anim === "walk" || state.anim === "dangle" || ONESHOTS.has(state.anim)) {
        return none;
      }
      if (e.now - state.lastInteraction >= e.sleepAfterMs) {
        return { state: { ...state, anim: "sleep" }, effect: { stop: true } };
      }
      if (e.now - state.lastInteraction >= e.restAfterMs && !state.resting) {
        return { state: { ...state, anim: "sit", resting: true }, effect: { stop: true } };
      }
      if (state.resting || e.now < state.nextIdleAt) return none;
      return pickIdle(state, e);
    }
    case "arrived":
      if (state.falling) {
        // Landed. If the bubble opened mid-fall, keep its pose; otherwise stand and roam.
        const landed = { ...state, falling: false, mode: "roam" as const, nextIdleAt: e.now + IDLE_PAUSE_MS };
        return { state: state.busy ? landed : { ...landed, anim: "idle" as const, lastInteraction: e.now }, effect: {} };
      }
      if (state.anim !== "walk") return none;
      if ((e.activity ?? "lively") === "lively") {
        const r = e.rand();
        const anim: AnimState = r < STRETCH_CHANCE ? "stretch" : "look";
        const nextIdleAt = r < STRETCH_CHANCE ? livelyPause(e.now, e.rand) : e.now + LOOK_MIN_MS + e.rand() * LOOK_JITTER_MS;
        return { state: { ...state, anim, nextIdleAt }, effect: {} };
      }
      return {
        state: {
          ...state,
          anim: "idle",
          nextIdleAt:
            e.now + (e.activity === "calm" ? CALM_PAUSE_MS + e.rand() * CALM_PAUSE_JITTER_MS : STILL_PAUSE_MS + e.rand() * STILL_PAUSE_JITTER_MS),
        },
        effect: {},
      };
    case "interact": {
      const next = { ...state, lastInteraction: e.now, resting: false };
      // Hovering a walker stops him; leave him resting rather than frozen mid-stride.
      if (state.anim === "walk") {
        return { state: { ...next, anim: standing(state), nextIdleAt: livelyPause(e.now, e.rand) }, effect: { stop: true } };
      }
      if (state.anim === "sleep") return { state: { ...next, anim: "stretch" }, effect: {} };
      if (state.resting && state.anim === "sit") return { state: { ...next, anim: "idle", nextIdleAt: livelyPause(e.now, e.rand) }, effect: {} };
      return { state: next, effect: {} };
    }
    case "bubble-open":
      return { state: { ...state, busy: true, resting: false, anim: "listen", lastInteraction: e.now }, effect: { stop: true } };
    case "bubble-close":
      return {
        state: { ...state, busy: false, resting: false, anim: standing(state), lastInteraction: e.now, nextIdleAt: livelyPause(e.now, e.rand) },
        effect: {},
      };
    case "thinking":
      return { state: { ...state, busy: true, resting: false, anim: "think", lastInteraction: e.now }, effect: { stop: true } };
    case "building":
      return { state: { ...state, working: true, resting: false, anim: "paint", lastInteraction: e.now }, effect: { stop: true } };
    case "build-ended": {
      const done = { ...state, working: false, lastInteraction: e.now, nextIdleAt: livelyPause(e.now) };
      return { state: state.anim === "paint" ? { ...done, anim: standing(done) } : done, effect: {} };
    }
    case "talking":
      return { state: { ...state, busy: true, resting: false, anim: "talk", lastInteraction: e.now }, effect: {} };
    case "succeeded":
      return { state: { ...state, anim: "happy", resting: false, lastInteraction: e.now }, effect: stopIfWalking(state) };
    case "failed":
      return { state: { ...state, anim: "confused", resting: false, lastInteraction: e.now }, effect: stopIfWalking(state) };
    case "oneshot-done":
      if (!ONESHOTS.has(state.anim)) return none;
      return { state: { ...state, anim: standing(state), nextIdleAt: livelyPause(e.now, e.rand) }, effect: {} };
    case "drag-start":
      return { state: { ...state, anim: "dangle", falling: false, resting: false, lastInteraction: e.now }, effect: { stop: true } };
    case "drop": {
      if (e.falling && !e.inDock) {
        return {
          state: { ...state, mode: "roam", resting: false, anim: "dangle", falling: true, lastInteraction: e.now, nextIdleAt: e.now + IDLE_PAUSE_MS },
          effect: {},
        };
      }
      const mode: Mode = e.inDock ? "roam" : "perched";
      return {
        state: { ...state, mode, resting: false, falling: false, anim: e.inDock ? "idle" : "sit", lastInteraction: e.now, nextIdleAt: e.now + IDLE_PAUSE_MS },
        effect: {},
      };
    }
    case "return-home":
      return { state: { ...state, mode: "roam", resting: false, anim: "walk", lastInteraction: e.now, walkUntil: e.now + WALK_TIMEOUT_MS }, effect: { returnHome: true } };
  }
}
