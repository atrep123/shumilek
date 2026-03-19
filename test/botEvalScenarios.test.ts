import { strict as assert } from 'assert';

import {
  getScenarioPrompt,
  listScenarioIds,
  normalizeScenarioFileContentBeforeWrite,
} from '../scripts/botEval';

describe('botEval scenario catalog', () => {
  it('includes the ts-csv repair benchmark scenario', () => {
    assert.ok(listScenarioIds().includes('ts-csv-repair-oracle'));
  });

  it('includes the node-api repair benchmark scenario', () => {
    assert.ok(listScenarioIds().includes('node-api-repair-oracle'));
  });

  it('embeds existing broken files in the ts-csv repair prompt', () => {
    const prompt = getScenarioPrompt('ts-csv-repair-oracle');
    assert.ok(prompt);
    assert.ok(prompt?.includes('EXISTING WORKSPACE FILES'));
    assert.ok(prompt?.includes('FILE: src/csv.ts'));
    assert.ok(prompt?.includes('FILE: src/cli.ts'));
    assert.ok(prompt?.includes('commander'));
    assert.ok(prompt?.includes('CsvFilter.where/select/sortBy'));
    assert.ok(prompt?.includes('const { CsvParser } = require("./csv")'));
    assert.ok(prompt?.includes('ne jen `--input=<file>`'));
    assert.ok(prompt?.includes('prazdnem CSV'));
    assert.ok(prompt?.includes('neznamy prikaz'));
  });

  it('reuses ts-csv CLI normalization for the repair scenario', () => {
    const source = [
      'import { Command } from "commander";',
      'const program = new Command();',
      'program.parse();',
      ''
    ].join('\n');
    const normalized = normalizeScenarioFileContentBeforeWrite('ts-csv-repair-oracle', 'src/cli.ts', source);
    assert.ok(normalized.includes('declare const require: any;'));
    assert.ok(normalized.includes('declare const process: any;'));
  });

  it('embeds existing broken files in the node-api repair prompt', () => {
    const prompt = getScenarioPrompt('node-api-repair-oracle');
    assert.ok(prompt);
    assert.ok(prompt?.includes('EXISTING WORKSPACE FILES'));
    assert.ok(prompt?.includes('FILE: src/server.js'));
    assert.ok(prompt?.includes('uuid'));
    assert.ok(prompt?.includes('listen()'));
  });

  it('reuses node-api server normalization for the repair scenario', () => {
    const source = [
      'const http = require("node:http");',
      'function createServer() { return http.createServer((_req, res) => res.end("ok")); }',
      'createServer().listen(3000);',
      'module.exports = { createServer };',
      ''
    ].join('\n');
    const normalized = normalizeScenarioFileContentBeforeWrite('node-api-repair-oracle', 'src/server.js', source);
    assert.ok(!normalized.includes('listen(3000)'));
  });
});