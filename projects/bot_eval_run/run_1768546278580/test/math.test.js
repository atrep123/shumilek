const test = require('node:test');
const assert = require('node:assert/strict');

const math = require('../src/math');

test('math functions', (t) => {
    t.plan(6);

    assert.strictEqual(math.sum(1, 2), 3);
    assert.strictEqual(math.mul(2, 3), 6);
    assert.strictEqual(math.sum(-1, -1), -2);
    assert.strictEqual(math.mul(0, 5), 0);
    assert.strictEqual(math.sum(10, 20), 30);
    assert.strictEqual(math.mul(4, 4), 16);
});