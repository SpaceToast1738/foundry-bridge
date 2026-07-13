// Bounded, self-expiring store for MCP Streamable-HTTP sessions.
//
// Two production incidents motivated this: (1) an unknown/expired session id
// used to silently create a fresh uninitialized transport → clients wedged in
// "Server not initialized" 400 loops after every gateway restart; (2) the
// session map never shrank → ~1 GB RSS. This encapsulates the lookup policy
// (use / create / not-found) plus TTL sweep and a hard cap, and is pure enough
// to unit-test with an injected clock.

export type SessionLookup<T> =
  | { action: "use"; session: T }
  | { action: "create" }
  | { action: "not_found" };

interface Stored<T> {
  value: T;
  lastSeen: number;
}

export class SessionStore<T> {
  private readonly map = new Map<string, Stored<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxSessions: number,
    /** Called to tear down a session's value on sweep/evict/close. */
    private readonly onClose: (value: T) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Decide what an incoming request's session id means. Touches on hit. */
  lookup(sessionId: string | undefined): SessionLookup<T> {
    if (!sessionId) return { action: "create" };
    const s = this.map.get(sessionId);
    if (!s) return { action: "not_found" };
    s.lastSeen = this.now();
    return { action: "use", session: s.value };
  }

  /** Register a freshly-initialized session and enforce the cap. */
  add(id: string, value: T): void {
    this.map.set(id, { value, lastSeen: this.now() });
    this.evictOverCap();
  }

  delete(id: string | undefined): void {
    if (id) this.map.delete(id);
  }

  get size(): number {
    return this.map.size;
  }

  /** Close + drop sessions idle longer than the TTL. Returns swept ids. */
  sweep(): string[] {
    const cutoff = this.now() - this.ttlMs;
    const swept: string[] = [];
    for (const [id, s] of this.map) {
      if (s.lastSeen < cutoff) {
        this.map.delete(id);
        swept.push(id);
        this.onClose(s.value);
      }
    }
    return swept;
  }

  closeAll(): void {
    for (const s of this.map.values()) this.onClose(s.value);
    this.map.clear();
  }

  /** Evict least-recently-seen sessions until back within the cap. */
  private evictOverCap(): string[] {
    const evicted: string[] = [];
    while (this.map.size > this.maxSessions) {
      let oldestId: string | undefined;
      let oldest = Infinity;
      for (const [id, s] of this.map) {
        if (s.lastSeen < oldest) {
          oldest = s.lastSeen;
          oldestId = id;
        }
      }
      if (oldestId === undefined) break;
      const victim = this.map.get(oldestId);
      this.map.delete(oldestId);
      evicted.push(oldestId);
      if (victim) this.onClose(victim.value);
    }
    return evicted;
  }
}
