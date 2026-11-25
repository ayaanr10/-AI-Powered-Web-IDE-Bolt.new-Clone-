export class MemoryUsageStore {
  constructor({ clock = Date.now } = {}) {
    this.clock = clock;
    this.values = new Map();
    this.locks = new Map();
    this.maxValues = 20_000;
    this.maxLocks = 2_000;
  }

  isReady() { return true; }

  async consume(entries) {
    const now = this.clock();
    this.prune(now);
    for (const entry of entries) {
      const saved = this.values.get(entry.key);
      if (saved && saved.expiresAt <= now) this.values.delete(entry.key);
      const current = this.values.get(entry.key);
      if ((current?.count ?? 0) >= entry.limit) {
        return {
          allowed: false,
          name: entry.name,
          retryAfterSeconds: current ? Math.max(1, Math.ceil((current.expiresAt - now) / 1000)) : entry.ttlSeconds,
        };
      }
    }
    const newKeys = entries.filter((entry) => !this.values.has(entry.key)).length;
    if (this.values.size + newKeys > this.maxValues) {
      return { allowed: false, name: 'storeBusy', retryAfterSeconds: 60 };
    }
    for (const entry of entries) {
      const saved = this.values.get(entry.key);
      if (saved) saved.count += 1;
      else this.values.set(entry.key, { count: 1, expiresAt: now + entry.ttlSeconds * 1000 });
    }
    return { allowed: true };
  }

  async acquireLock(key, token, ttlSeconds) {
    const now = this.clock();
    this.prune(now);
    const current = this.locks.get(key);
    if (current && current.expiresAt > now) return false;
    if (!current && this.locks.size >= this.maxLocks) return false;
    this.locks.set(key, { token, expiresAt: now + ttlSeconds * 1000 });
    return true;
  }

  async releaseLock(key, token) {
    if (this.locks.get(key)?.token === token) this.locks.delete(key);
  }

  prune(now = this.clock()) {
    for (const [key, value] of this.values) {
      if (value.expiresAt <= now) this.values.delete(key);
    }
    for (const [key, value] of this.locks) {
      if (value.expiresAt <= now) this.locks.delete(key);
    }
    // Capacity is checked before accepting new counters or locks; active limits are never evicted.
  }
}
