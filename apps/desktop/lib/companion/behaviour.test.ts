import { describe, it, expect } from "vitest";
import { initialState, reduce, type BehaviourEvent, type BehaviourState } from "./behaviour";

const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};
const strip = { minX: 0, maxX: 1000 };
const tick = (now: number, rand: () => number, extra: Partial<Extract<BehaviourEvent, { type: "tick" }>> = {}) =>
  ({ type: "tick", now, rand, strip, activity: "lively", restAfterMs: 120_000, x: 500, sleepAfterMs: 300_000, ...extra }) as BehaviourEvent;

function run(state: BehaviourState, ...events: BehaviourEvent[]) {
  let s = state;
  let effect = {};
  for (const e of events) ({ state: s, effect } = reduce(s, e));
  return { state: s, effect };
}

describe("idle life", () => {
  const arrive = (state: BehaviourState, now: number, rand: () => number, activity?: "lively" | "calm" | "still") =>
    reduce(state, { type: "arrived", now, rand, ...(activity ? { activity } : {}) } as BehaviourEvent);
  const walking = () => run(initialState(0), tick(5000, seq(0.5))).state;

  it("starts idle and roaming", () => {
    expect(initialState(0)).toMatchObject({ anim: "idle", mode: "roam", busy: false, resting: false });
  });

  it("does nothing before the next idle pick", () => {
    const s = initialState(0);
    expect(reduce(s, tick(1000, seq(0.1))).state).toBe(s);
  });

  it("lively: walks to a random spot in the strip", () => {
    const { state, effect } = reduce(initialState(0), tick(5000, seq(0.5)));
    expect(state.anim).toBe("walk");
    expect(effect).toEqual({ walkTo: 500 });
  });

  it("lively: looks around for 2-4 s on arrival, then walks again", () => {
    const { state } = arrive(walking(), 9000, seq(0.5, 0.5));
    expect(state).toMatchObject({ anim: "look", nextIdleAt: 12_000 });
    expect(reduce(state, tick(11_999, seq(0.5))).state).toBe(state);
    const next = reduce(state, tick(12_000, seq(0.2)));
    expect(next.state.anim).toBe("walk");
    expect(next.effect).toEqual({ walkTo: 200 });
  });

  it("lively: about 15% of arrivals stretch instead", () => {
    expect(arrive(walking(), 9000, seq(0.1, 0.5)).state.anim).toBe("stretch");
    expect(arrive(walking(), 9000, seq(0.15, 0.5)).state.anim).toBe("look");
  });

  it("ignores arrival when not walking", () => {
    const s = initialState(0);
    expect(arrive(s, 10, seq(0.1)).state).toBe(s);
  });

  it("calm: pauses 8-20 s between picks", () => {
    const { state } = reduce(initialState(0), tick(5000, seq(0.9, 0), { activity: "calm" }));
    expect(state.nextIdleAt).toBe(13_000);
  });

  it("calm: mirrors a stroll that would barely move, and looks if neither way has room", () => {
    // offset +0.1*160-ish: x=990 clamped to 1000 is only 10 px away -> mirror to the left
    const mirrored = reduce(initialState(0), tick(5000, seq(0.1, 1, 0), { activity: "calm", x: 990 }));
    expect(mirrored.effect).toEqual({ walkTo: 830 });
    const tiny = reduce(initialState(0), tick(5000, seq(0.1, 0.5, 0), { activity: "calm", x: 500 }));
    expect(tiny.state.anim).toBe("look");
    expect(tiny.effect).toEqual({});
    const edgeStrip = { minX: 0, maxX: 30 };
    const cramped = reduce(initialState(0), tick(5000, seq(0.1, 1, 0), { activity: "calm", x: 0, strip: edgeStrip }));
    expect(cramped.state.anim).toBe("look");
    expect(cramped.effect).toEqual({});
  });

  it("calm: strolls within 160 px of where it stands, clamped to the strip", () => {
    const near = reduce(initialState(0), tick(5000, seq(0.1, 1), { activity: "calm", x: 500 }));
    expect(near.state.anim).toBe("walk");
    expect(near.effect).toEqual({ walkTo: 660 });
    const clamped = reduce(initialState(0), tick(5000, seq(0.1, 0), { activity: "calm", x: 100 }));
    expect(clamped.effect).toEqual({ walkTo: 0 });
    const right = reduce(initialState(0), tick(5000, seq(0.1, 1), { activity: "calm", x: 900 }));
    expect(right.effect).toEqual({ walkTo: 1000 });
  });

  it("calm: otherwise looks (40%) or idles (30%)", () => {
    expect(reduce(initialState(0), tick(5000, seq(0.5, 0), { activity: "calm" })).state.anim).toBe("look");
    const idle = reduce(initialState(0), tick(5000, seq(0.9, 0), { activity: "calm" }));
    expect(idle.state.anim).toBe("idle");
    expect(idle.effect).toEqual({});
  });

  it("calm: goes idle after a stroll", () => {
    const { state } = arrive(walking(), 9000, seq(0), "calm");
    expect(state).toMatchObject({ anim: "idle", nextIdleAt: 17_000 });
  });

  it("still: never walks, alternating look and idle", () => {
    let s = initialState(0);
    const anims: string[] = [];
    for (let t = 5000; t < 120_000 && anims.length < 4; t += 1000) {
      const r = reduce(s, tick(t, seq(0.1, 0), { activity: "still" }));
      expect(r.effect).toEqual({});
      if (r.state !== s) anims.push(r.state.anim);
      s = r.state;
    }
    expect(anims).toEqual(["look", "idle", "look", "idle"]);
  });

  it("still: pauses 6-12 s between picks", () => {
    expect(reduce(initialState(0), tick(5000, seq(0), { activity: "still" })).state.nextIdleAt).toBe(11_000);
    expect(reduce(initialState(0), tick(5000, seq(1), { activity: "still" })).state.nextIdleAt).toBe(17_000);
  });

  it("still: goes idle on arrival with a 6-12 s pause", () => {
    const { state } = arrive(walking(), 9000, seq(0), "still");
    expect(state).toMatchObject({ anim: "idle", nextIdleAt: 15_000 });
    expect(arrive(walking(), 9000, seq(1), "still").state.nextIdleAt).toBe(21_000);
  });

  it("an unknown strip (not reported yet) makes him look instead of walking", () => {
    const r = reduce(initialState(0), tick(5000, seq(0.5), { strip: { minX: 0, maxX: 0 } }));
    expect(r.state.anim).toBe("look");
    expect(r.effect).toEqual({});
    const calm = reduce(initialState(0), tick(5000, seq(0.1, 1, 0), { activity: "calm", strip: { minX: 0, maxX: 0 } }));
    expect(calm.effect).toEqual({});
  });

  it("lively pauses last 1.5-4 s wherever the next pick is scheduled", () => {
    const bounds = (n: number) => [n + 1500, n + 4000];
    const check = (nextIdleAt: number, now: number) => {
      const [lo, hi] = bounds(now);
      expect(nextIdleAt).toBeGreaterThanOrEqual(lo);
      expect(nextIdleAt).toBeLessThanOrEqual(hi);
    };
    for (const rand of [0, 0.5, 0.999]) {
      const r = () => rand;
      check(reduce(walking(), { type: "interact", now: 6000, rand: r } as BehaviourEvent).state.nextIdleAt, 6000);
      check(run(initialState(0), { type: "bubble-open", now: 0 }, { type: "bubble-close", now: 7000, rand: r } as BehaviourEvent).state.nextIdleAt, 7000);
      check(reduce({ ...initialState(0), anim: "stretch" }, { type: "oneshot-done", now: 8000, rand: r } as BehaviourEvent).state.nextIdleAt, 8000);
      check(arrive(walking(), 9000, seq(0.1, rand)).state.nextIdleAt, 9000);
      const sat = reduce(initialState(0), tick(120_000, seq(0.1))).state;
      check(reduce(sat, { type: "interact", now: 130_000, rand: r } as BehaviourEvent).state.nextIdleAt, 130_000);
    }
  });

  it("sits after resting time with no interaction and stays seated", () => {
    const sat = reduce(initialState(0), tick(120_000, seq(0.1)));
    expect(sat.state).toMatchObject({ anim: "sit", resting: true });
    expect(sat.effect).toEqual({ stop: true });
    expect(reduce(sat.state, tick(200_000, seq(0.1))).state).toBe(sat.state);
  });

  it("rest ladder applies to every activity level", () => {
    for (const activity of ["lively", "calm", "still"] as const) {
      expect(reduce(initialState(0), tick(120_000, seq(0.1), { activity })).state.anim).toBe("sit");
    }
  });

  it("falls asleep after the sleep timeout and wakes with a stretch", () => {
    const sat = reduce(initialState(0), tick(120_000, seq(0.1))).state;
    const asleep = reduce(sat, tick(300_000, seq(0.1)));
    expect(asleep.state.anim).toBe("sleep");
    expect(asleep.effect).toEqual({ stop: true });
    const woke = reduce(asleep.state, { type: "interact", now: 301_000 });
    expect(woke.state).toMatchObject({ anim: "stretch", resting: false });
    expect(reduce(woke.state, { type: "oneshot-done", now: 302_000 }).state.anim).toBe("idle");
  });

  it("sleeps before resting when the sleep time is shorter than the rest time", () => {
    const r = reduce(initialState(0), tick(60_000, seq(0.1), { sleepAfterMs: 60_000, restAfterMs: 120_000 }));
    expect(r.state.anim).toBe("sleep");
  });

  it("stands up on the perch when perched and resting", () => {
    const perched = run(initialState(0), { type: "drop", now: 0, inDock: false }).state;
    const sat = reduce(perched, tick(120_000, seq(0.1))).state;
    expect(sat).toMatchObject({ anim: "sit", resting: true });
    expect(reduce(sat, { type: "interact", now: 130_000 }).state).toMatchObject({ anim: "idle", mode: "perched", resting: false });
  });

  it("stands up when interacted with while resting", () => {
    const sat = reduce(initialState(0), tick(120_000, seq(0.1))).state;
    const { state } = reduce(sat, { type: "interact", now: 130_000 });
    expect(state).toMatchObject({ anim: "idle", resting: false, lastInteraction: 130_000 });
    expect(reduce(state, tick(200_000, seq(0.5))).state.anim).toBe("walk");
  });

  it("stands up from rest when the bubble opens and closes", () => {
    const sat = reduce(initialState(0), tick(120_000, seq(0.1))).state;
    const { state } = run(sat, { type: "bubble-open", now: 130_000 }, { type: "bubble-close", now: 131_000 });
    expect(state).toMatchObject({ anim: "idle", resting: false });
  });
});

describe("commands", () => {
  it("pauses the idle loop and sleep while the bubble is open", () => {
    const { state } = run(initialState(0), { type: "bubble-open", now: 0 }, tick(999_999, seq(0.1)));
    expect(state).toMatchObject({ anim: "listen", busy: true });
  });

  it("runs the think / talk / happy cycle", () => {
    const s = run(initialState(0), { type: "bubble-open", now: 0 }).state;
    expect(reduce(s, { type: "thinking", now: 1 }).state.anim).toBe("think");
    expect(reduce(s, { type: "talking", now: 1 }).state.anim).toBe("talk");
    const happy = reduce(s, { type: "succeeded", now: 2 }).state;
    expect(happy.anim).toBe("happy");
    expect(reduce(happy, { type: "oneshot-done", now: 3 }).state.anim).toBe("idle");
    const closed = run(happy, { type: "bubble-close", now: 4 }).state;
    expect(closed).toMatchObject({ anim: "idle", busy: false });
  });

  it("looks confused when something fails", () => {
    expect(reduce(initialState(0), { type: "failed", now: 1 }).state.anim).toBe("confused");
  });
});

describe("never stuck", () => {
  const walking = () => run(initialState(0), tick(5000, seq(0.1, 0.5))).state;
  it("gives up a walk after 180 seconds", () => {
    const w = walking();
    expect(w.anim).toBe("walk");
    expect(w.walkUntil).toBe(185_000);
    const { state, effect } = reduce(w, tick(185_000, seq(0.5)));
    expect(state.anim).toBe("idle");
    expect(effect).toEqual({ stop: true });
    expect(state.nextIdleAt).toBeGreaterThanOrEqual(186_500);
    expect(state.nextIdleAt).toBeLessThanOrEqual(189_000);
  });
  it("keeps walking before the deadline", () => {
    expect(reduce(walking(), tick(184_999, seq(0.5))).effect).toEqual({});
  });
  it("stops walking when the request fails or succeeds or the user interacts", () => {
    const failed = reduce(walking(), { type: "failed", now: 6000 });
    expect(failed.state.anim).toBe("confused");
    expect(failed.effect).toEqual({ stop: true });
    expect(reduce(walking(), { type: "succeeded", now: 6000 }).effect).toEqual({ stop: true });
    expect(reduce(walking(), { type: "interact", now: 6000 }).effect).toEqual({ stop: true });
  });
  it("rests instead of freezing mid-walk when hovered", () => {
    const { state, effect } = reduce(walking(), { type: "interact", now: 6000 });
    expect(state.anim).toBe("idle");
    expect(effect).toEqual({ stop: true });
    const perched = { ...walking(), mode: "perched" as const };
    expect(reduce(perched, { type: "interact", now: 6000 }).state.anim).toBe("sit");
  });
  it("sets a walk deadline on return-home", () => {
    expect(reduce(initialState(0), { type: "return-home", now: 10 }).state.walkUntil).toBe(180_010);
  });
  it("does not stop when not walking", () => {
    expect(reduce(initialState(0), { type: "failed", now: 1 }).effect).toEqual({});
    expect(reduce(initialState(0), { type: "interact", now: 1 }).effect).toEqual({});
  });
});

describe("dragging", () => {
  it("dangles while dragged and sits where dropped off the Dock", () => {
    const { state } = run(initialState(0), { type: "drag-start", now: 1 }, { type: "drop", now: 2, inDock: false });
    expect(state).toMatchObject({ anim: "sit", mode: "perched" });
  });

  it("never walks while perched, whatever the activity", () => {
    const perched = run(initialState(0), { type: "drop", now: 0, inDock: false }).state;
    const { state, effect } = reduce(perched, tick(10_000, seq(0.1, 0)));
    expect(state.anim).toBe("look");
    expect(effect).toEqual({});
  });

  it("still sits and sleeps by the rest ladder while perched", () => {
    const perched = run(initialState(0), { type: "drop", now: 0, inDock: false }).state;
    expect(reduce(perched, tick(120_000, seq(0.1))).state).toMatchObject({ anim: "sit", resting: true });
  });

  it("roams again after a drop on the Dock", () => {
    const { state } = run(initialState(0), { type: "drop", now: 2, inDock: true });
    expect(state).toMatchObject({ anim: "idle", mode: "roam" });
  });

  it("falls with the dangle pose when dropped with the Dock-fall setting, staying in roam mode", () => {
    const { state, effect } = run(initialState(0), { type: "drag-start", now: 1 }, { type: "drop", now: 2, inDock: false, falling: true });
    expect(state).toMatchObject({ anim: "dangle", mode: "roam", falling: true });
    expect(effect).toEqual({});
  });

  it("does not idle-pick or sleep while falling", () => {
    const falling = run(initialState(0), { type: "drop", now: 0, inDock: false, falling: true }).state;
    expect(reduce(falling, tick(400_000, seq(0.1))).state).toBe(falling);
  });

  it("lands, stands and roams when the fall arrives", () => {
    const falling = run(initialState(0), { type: "drop", now: 0, inDock: false, falling: true }).state;
    const { state } = reduce(falling, { type: "arrived", now: 500, rand: seq(0.5) });
    expect(state).toMatchObject({ anim: "idle", mode: "roam", falling: false, nextIdleAt: 500 + 4000 });
    expect(reduce(state, tick(5000, seq(0.5))).state.anim).toBe("walk");
  });

  it("keeps the bubble's pose when a fall lands while it is open", () => {
    const falling = run(initialState(0), { type: "drop", now: 0, inDock: false, falling: true }).state;
    const open = reduce(falling, { type: "bubble-open", now: 100 }).state;
    expect(open.falling).toBe(true);
    const { state } = reduce(open, { type: "arrived", now: 500, rand: seq(0.5) });
    expect(state).toMatchObject({ anim: "listen", busy: true, falling: false });
  });

  it("a new drag cancels a fall", () => {
    const falling = run(initialState(0), { type: "drop", now: 0, inDock: false, falling: true }).state;
    expect(reduce(falling, { type: "drag-start", now: 5 }).state).toMatchObject({ anim: "dangle", falling: false });
  });

  it("a drop in the Dock never falls, even if flagged", () => {
    const { state } = run(initialState(0), { type: "drop", now: 2, inDock: true, falling: true });
    expect(state).toMatchObject({ anim: "idle", mode: "roam", falling: false });
  });

  it("walks home on double-click", () => {
    const perched = run(initialState(0), { type: "drop", now: 0, inDock: false }).state;
    const { state, effect } = reduce(perched, { type: "return-home", now: 1 });
    expect(state).toMatchObject({ anim: "walk", mode: "roam" });
    expect(effect).toEqual({ returnHome: true });
  });
});

describe("painting while a project is built", () => {
  const rand = seq(0.1);
  it("paints from the start of a build to its end", () => {
    const s = run(initialState(0), { type: "building", now: 1 }).state;
    expect(s.anim).toBe("paint");
    expect(s.working).toBe(true);
    expect(reduce(s, { type: "build-ended", now: 2 }).state).toMatchObject({ working: false, anim: "idle" });
  });
  it("keeps painting when the bubble closes, and doesn't wander or sleep", () => {
    let s = run(initialState(0), { type: "bubble-open", now: 1 }, { type: "building", now: 2 }, { type: "bubble-close", now: 3 }).state;
    expect(s.anim).toBe("paint");
    s = run(s, tick(500_000, rand)).state;
    expect(s.anim).toBe("paint");
  });
  it("goes back to painting after answering something mid-build", () => {
    const s = run(initialState(0), { type: "building", now: 1 }, { type: "thinking", now: 2 }, { type: "talking", now: 3 }, { type: "succeeded", now: 4 }, { type: "oneshot-done", now: 5 }).state;
    expect(s.anim).toBe("paint");
  });
  it("celebrates when the build ends well, then stands", () => {
    const s = run(initialState(0), { type: "building", now: 1 }, { type: "build-ended", now: 2 }, { type: "succeeded", now: 3 }, { type: "oneshot-done", now: 4 }).state;
    expect(s.anim).toBe("idle");
  });
});
