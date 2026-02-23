require('node:test').run({
    tests: {
        'math module': () => {
            const { sum, mul } = require('../src/math');

            assert.strictEqual(sum(2, 3), 5);
            assert.strictEqual(mul(2, 3), 6);

            assert.strictEqual(sum(-1, -1), -2);
            assert.strictEqual(mul(-1, -1), 1);

            assert.strictEqual(sum(0, 0), 0);
            assert.strictEqual(mul(0, 5), 0);
        }
    },
    reporter: 'dot'
});