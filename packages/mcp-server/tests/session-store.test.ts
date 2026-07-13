import { SessionStore } from "../src/session-store";

describe("SessionStore", () => {
  function makeClock(start = 1_000) {
    let t = start;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  }

  it("returns 'create' when no session id is supplied (initialize)", () => {
    const store = new SessionStore<string>(1000, 10, () => undefined);
    expect(store.lookup(undefined)).toEqual({ action: "create" });
  });

  it("returns 'not_found' for an unknown/expired session id", () => {
    const store = new SessionStore<string>(1000, 10, () => undefined);
    expect(store.lookup("ghost")).toEqual({ action: "not_found" });
  });

  it("returns 'use' with the stored value for a known id", () => {
    const store = new SessionStore<string>(1000, 10, () => undefined);
    store.add("s1", "session-one");
    expect(store.lookup("s1")).toEqual({ action: "use", session: "session-one" });
  });

  it("sweeps sessions idle beyond the TTL and calls onClose", () => {
    const clock = makeClock();
    const closed: string[] = [];
    const store = new SessionStore<string>(5000, 10, (v) => closed.push(v), clock.now);
    store.add("s1", "one");
    clock.advance(2000);
    store.add("s2", "two");

    clock.advance(4000); // s1 idle 6s (>5s TTL), s2 idle 4s (<5s)
    const swept = store.sweep();

    expect(swept).toEqual(["s1"]);
    expect(closed).toEqual(["one"]);
    expect(store.size).toBe(1);
    expect(store.lookup("s2").action).toBe("use");
  });

  it("touches lastSeen on lookup so active sessions aren't swept", () => {
    const clock = makeClock();
    const closed: string[] = [];
    const store = new SessionStore<string>(5000, 10, (v) => closed.push(v), clock.now);
    store.add("s1", "one");
    clock.advance(4000);
    store.lookup("s1"); // refresh
    clock.advance(4000); // 4s since last touch, under TTL
    expect(store.sweep()).toEqual([]);
    expect(closed).toEqual([]);
  });

  it("evicts the least-recently-seen session when over the cap", () => {
    const clock = makeClock();
    const closed: string[] = [];
    const store = new SessionStore<string>(60_000, 2, (v) => closed.push(v), clock.now);
    store.add("s1", "one");
    clock.advance(10);
    store.add("s2", "two");
    clock.advance(10);
    store.lookup("s1"); // s1 now more recent than s2
    clock.advance(10);
    store.add("s3", "three"); // over cap → evict oldest (s2)

    expect(closed).toEqual(["two"]);
    expect(store.size).toBe(2);
    expect(store.lookup("s2").action).toBe("not_found");
    expect(store.lookup("s1").action).toBe("use");
    expect(store.lookup("s3").action).toBe("use");
  });

  it("delete removes a session; closeAll drains + closes everything", () => {
    const closed: string[] = [];
    const store = new SessionStore<string>(1000, 10, (v) => closed.push(v));
    store.add("s1", "one");
    store.add("s2", "two");
    store.delete("s1");
    expect(store.size).toBe(1);
    store.closeAll();
    expect(store.size).toBe(0);
    expect(closed).toContain("two");
  });
});
