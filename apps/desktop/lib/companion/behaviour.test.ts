import { describe, it, expect } from "vitest";
import { initialState, reduce, type BehaviourEvent, type BehaviourState } from "./behaviour";

const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};
const strip = { minX: 0, maxX: 1000 };
const tick = (now: number, rand: () => number, extra: Partial<Extract<BehaviourEvent, { type: "tick" }>> = {}) =>
  ({ type: "tick", now, rand, strip, walkAround: true, sleepAfterMs: 300_000, ...extra }) as BehaviourEvent;

function run(state: BehaviourState, ...events: BehaviourEvent[]) {
  let s = state;
  let effect = {};
  for (const e of events) ({ state: s, effect } = reduce(s, e));
  return { state: s, effect };
}

describe("idle life", () => {
  it("starts idle and roaming", () => {
    expect(initialState(0)).toMatchObject({ anim: "idle", mode: "roam", busy: false });
  });

  it("does nothing before the next idle pick", () => {
    const s = initialState(0);
    expect(reduce(s, tick(1000, seq(0.1))).state).toBe(s);
  });

  it("walks to a random spot in the strip", () => {
    const { state, effect } = reduce(initialState(0), tick(5000, seq(0.1, 0.5, 0)));
    expect(state.anim).toBe("walk");
    expect(effect).toEqual({ walkTo: 500 });
  });

  it("goes idle on arrival", () => {
    const { state } = run(initialState(0), tick(5000, seq(0.1, 0.5, 0)), { type: "arrived", now: 9000 });
    expect(state.anim).toBe("idle");
  });

  it("stays in place when walking is off", () => {
    const { state, effect } = reduce(initialState(0), tick(5000, seq(0.6, 0), { walkAround: false }));
    expect(state.anim).toBe("sit");
    expect(effect).toEqual({});
  });

  it("falls asleep after the idle timeout and wakes with a stretch", () => {
    const asleep = reduce(initialState(0), tick(300_000, seq(0.1)));
    expect(asleep.state.anim).toBe("sleep");
    expect(asleep.effect).toEqual({ stop: true });
    const awake = run(asleep.state, { type: "interact", now: 301_000 }, { type: "oneshot-done", now: 302_000 });
    expect(awake.state.anim).toBe("idle");
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

describe("dragging", () => {
  it("dangles while dragged and sits where dropped off the Dock", () => {
    const { state } = run(initialState(0), { type: "drag-start", now: 1 }, { type: "drop", now: 2, inDock: false });
    expect(state).toMatchObject({ anim: "sit", mode: "perched" });
  });

  it("never walks while perched", () => {
    const perched = run(initialState(0), { type: "drop", now: 0, inDock: false }).state;
    const { state, effect } = reduce(perched, tick(10_000, seq(0.1, 0)));
    expect(state.anim).toBe("idle");
    expect(effect).toEqual({});
  });

  it("roams again after a drop on the Dock", () => {
    const { state } = run(initialState(0), { type: "drop", now: 2, inDock: true });
    expect(state).toMatchObject({ anim: "idle", mode: "roam" });
  });

  it("walks home on double-click", () => {
    const perched = run(initialState(0), { type: "drop", now: 0, inDock: false }).state;
    const { state, effect } = reduce(perched, { type: "return-home", now: 1 });
    expect(state).toMatchObject({ anim: "walk", mode: "roam" });
    expect(effect).toEqual({ returnHome: true });
  });
});
