var expect = require('chai').expect;

/**
 * Tests for the bounded-map eviction logic used in extension.ts for lastReadHashes.
 * The function is module-scoped so we replicate the algorithm here to verify correctness.
 */

const MAX = 5;
const TTL = 100; // ms for testing

function evictStale(map: Map<string, { hash: string; updatedAt: number }>): void {
  if (map.size <= MAX) return;
  const now = Date.now();
  for (const [k, v] of map) {
    if (now - v.updatedAt >= TTL) {
      map.delete(k);
    }
  }
  if (map.size > MAX) {
    const excess = map.size - MAX;
    const iter = map.keys();
    for (let i = 0; i < excess; i++) {
      const next = iter.next();
      if (next.done) break;
      map.delete(next.value);
    }
  }
}

describe('evictStaleHashes algorithm', () => {
  it('does nothing when map size is within limit', () => {
    const map = new Map<string, { hash: string; updatedAt: number }>();
    for (let i = 0; i < MAX; i++) {
      map.set(`file${i}`, { hash: `h${i}`, updatedAt: Date.now() });
    }
    evictStale(map);
    expect(map.size).to.equal(MAX);
  });

  it('evicts expired entries first when over limit', (done) => {
    const map = new Map<string, { hash: string; updatedAt: number }>();
    const old = Date.now() - TTL - 10;
    // 3 old entries
    for (let i = 0; i < 3; i++) {
      map.set(`old${i}`, { hash: `h${i}`, updatedAt: old });
    }
    // 4 fresh entries
    setTimeout(() => {
      const now = Date.now();
      for (let i = 0; i < 4; i++) {
        map.set(`fresh${i}`, { hash: `h${i}`, updatedAt: now });
      }
      expect(map.size).to.equal(7);
      evictStale(map);
      expect(map.size).to.equal(4); // only fresh remain
      for (let i = 0; i < 3; i++) {
        expect(map.has(`old${i}`)).to.equal(false);
      }
      for (let i = 0; i < 4; i++) {
        expect(map.has(`fresh${i}`)).to.equal(true);
      }
      done();
    }, TTL + 20);
  });

  it('force-evicts oldest entries when TTL alone is not enough', () => {
    const map = new Map<string, { hash: string; updatedAt: number }>();
    const now = Date.now();
    // All fresh, all within TTL — but over limit
    for (let i = 0; i < MAX + 3; i++) {
      map.set(`f${i}`, { hash: `h${i}`, updatedAt: now });
    }
    expect(map.size).to.equal(MAX + 3);
    evictStale(map);
    expect(map.size).to.equal(MAX);
    // First 3 entries should be gone (FIFO eviction)
    expect(map.has('f0')).to.equal(false);
    expect(map.has('f1')).to.equal(false);
    expect(map.has('f2')).to.equal(false);
    // Last MAX entries should remain
    for (let i = 3; i < MAX + 3; i++) {
      expect(map.has(`f${i}`)).to.equal(true);
    }
  });

  it('handles empty map gracefully', () => {
    const map = new Map<string, { hash: string; updatedAt: number }>();
    evictStale(map);
    expect(map.size).to.equal(0);
  });
});
