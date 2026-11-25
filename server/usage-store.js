import Redis from 'ioredis';

const CONSUME_SCRIPT = `
for i = 1, #KEYS do
  local current = tonumber(redis.call('GET', KEYS[i]) or '0')
  local limit = tonumber(ARGV[(i - 1) * 2 + 1])
  if current >= limit then
    return {0, i, redis.call('TTL', KEYS[i])}
  end
end
for i = 1, #KEYS do
  local count = redis.call('INCR', KEYS[i])
  if count == 1 then
    redis.call('EXPIRE', KEYS[i], tonumber(ARGV[(i - 1) * 2 + 2]))
  end
end
return {1, 0, 0}
`;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export class MemoryUsageStore {
  constructor({ clock = Date.now } = {}) {
    this.clock = clock;
    this.values = new Map();
    this.locks = new Map();
  }

  isReady() { return true; }

  async consume(entries) {
    const now = this.clock();
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
    for (const entry of entries) {
      const saved = this.values.get(entry.key);
      if (saved) saved.count += 1;
      else this.values.set(entry.key, { count: 1, expiresAt: now + entry.ttlSeconds * 1000 });
    }
    return { allowed: true };
  }

  async acquireLock(key, token, ttlSeconds) {
    const now = this.clock();
    const current = this.locks.get(key);
    if (current && current.expiresAt > now) return false;
    this.locks.set(key, { token, expiresAt: now + ttlSeconds * 1000 });
    return true;
  }

  async releaseLock(key, token) {
    if (this.locks.get(key)?.token === token) this.locks.delete(key);
  }
}

export class RedisUsageStore {
  constructor(url) {
    if (!url) throw new Error('A Redis connection URL is required.');
    this.client = new Redis(url, {
      connectTimeout: 5000,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) => Math.min(attempt * 250, 2500),
    });
    // The app reports a generic unavailable state; never log a connection URL.
    this.client.on('error', () => {});
  }

  isReady() { return this.client.status === 'ready'; }

  async consume(entries) {
    if (!this.isReady()) throw new Error('Usage store unavailable.');
    const keys = entries.map((entry) => entry.key);
    const args = entries.flatMap((entry) => [String(entry.limit), String(entry.ttlSeconds)]);
    const [allowed, deniedIndex, redisTtl] = await this.client.eval(CONSUME_SCRIPT, keys.length, ...keys, ...args);
    if (Number(allowed) === 1) return { allowed: true };
    const entry = entries[Number(deniedIndex) - 1];
    const ttl = Number(redisTtl);
    return { allowed: false, name: entry?.name ?? 'unknown', retryAfterSeconds: ttl > 0 ? ttl : entry?.ttlSeconds ?? 60 };
  }

  async acquireLock(key, token, ttlSeconds) {
    if (!this.isReady()) throw new Error('Usage store unavailable.');
    return (await this.client.set(key, token, 'EX', ttlSeconds, 'NX')) === 'OK';
  }

  async releaseLock(key, token) {
    if (!this.isReady()) return;
    await this.client.eval(RELEASE_SCRIPT, 1, key, token);
  }
}
