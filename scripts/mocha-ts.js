// Ensure ts-node uses the test tsconfig before Mocha loads any .ts files.
process.env.TS_NODE_PROJECT = process.env.TS_NODE_PROJECT || 'tsconfig.test.json';
// CI (Node 18) can fail on legacy test-file global collisions during typechecking.
// Compile sources separately; run test files in transpile-only mode for runtime assertions.
process.env.TS_NODE_TRANSPILE_ONLY = process.env.TS_NODE_TRANSPILE_ONLY || '1';

require('ts-node/register');
require('mocha/bin/_mocha');
