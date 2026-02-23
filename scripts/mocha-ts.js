// Ensure ts-node uses the test tsconfig before Mocha loads any .ts files.
process.env.TS_NODE_PROJECT = process.env.TS_NODE_PROJECT || 'tsconfig.test.json';

require('ts-node/register');
require('mocha/bin/_mocha');
