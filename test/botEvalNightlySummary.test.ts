import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  buildNightlySummaryMarkdown,
  parseNightlySummaryArgs,
  runNightlySummary
} from '../scripts/botEvalNightlySummary';

function writeJson(filePath: string, value: any): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

describe('botEvalNightlySummary', () => {
  it('parses gateDir, repairDir, out and append flags', () => {
    const opts = parseNightlySummaryArgs([
      '--gateDir', 'gate-dir',
      '--repairDir', 'repair-dir',
      '--out', 'summary.md',
      '--append'
    ]);

    assert.equal(opts.gateDir, path.resolve('gate-dir'));
    assert.equal(opts.repairDir, path.resolve('repair-dir'));
    assert.equal(opts.outPath, path.resolve('summary.md'));
    assert.equal(opts.append, true);
  });

  it('builds markdown for gate and repair sections', () => {
    const markdown = buildNightlySummaryMarkdown({
      generatedAt: '2026-03-17T22:00:00.000Z',
      gateSummaryRows: [
        {
          scenario: 'node-api-oracle',
          passRate: 1,
          rawRunPassRate: 1,
          fallbackDependencyRunRate: 0,
          avgMs: 1234
        }
      ],
      compare: {
        gate: {
          passed: false,
          violations: [{ message: 'fallback dependency regression' }]
        },
        scenarios: [
          {
            scenario: 'node-api-oracle',
            delta: {
              passRate: 0.2,
              rawRunPassRate: 0.1,
              fallbackDependencyRunRate: -0.2,
              avgMs: 50
            }
          }
        ]
      },
      aggregate: {
        allGatePassed: false,
        gateFailures: [{ runDir: 'x', message: 'trend guard failed' }],
        scenarios: [
          {
            scenario: 'node-api-oracle',
            rawRunPassRate: { min: 0.9, max: 1 },
            fallbackDependencyRunRate: { min: 0, max: 0.1 },
            avgMsDeltaVsBaseline: { avg: 30, min: 10, max: 80 }
          }
        ]
      },
      repairDir: 'repair-dir',
      repairSummaryRows: [
        {
          scenario: 'ts-csv-repair-oracle',
          passRate: 1,
          rawRunPassRate: 1,
          fallbackDependencyRunRate: 0,
          avgMs: 456
        }
      ]
    });

    assert.match(markdown, /## Nightly Gate/);
    assert.match(markdown, /Release gate: FAIL/);
    assert.match(markdown, /fallback dependency regression/);
    assert.match(markdown, /\| node-api-oracle \| 100% \| 100% \| 0% \| 1234 \| \+20% \| \+10% \| -20% \| \+50 \|/);
    assert.match(markdown, /\| node-api-oracle \| 90% \| 100% \| 10% \| \+80 \|/);
    assert.match(markdown, /## Repair Canary/);
    assert.match(markdown, /ts-csv-repair-oracle/);
  });

  it('writes summary file and emits missing repair note when summary.json is absent', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-nightly-summary-'));
    try {
      const gateDir = path.join(tmp, 'gate');
      const repairDir = path.join(tmp, 'repair');
      const outPath = path.join(tmp, 'job-summary.md');

      writeJson(path.join(gateDir, 'summary.json'), [
        {
          scenario: 'ts-todo-oracle',
          passRate: 1,
          rawRunPassRate: 1,
          fallbackDependencyRunRate: 0,
          avgMs: 222
        }
      ]);
      writeJson(path.join(gateDir, 'compare.json'), {
        gate: { passed: true, violations: [] },
        scenarios: [
          {
            scenario: 'ts-todo-oracle',
            delta: {
              passRate: 0,
              rawRunPassRate: 0,
              fallbackDependencyRunRate: 0,
              avgMs: -20
            }
          }
        ]
      });
      writeJson(path.join(gateDir, 'stability_aggregate.json'), {
        allGatePassed: true,
        gateFailures: [],
        scenarios: []
      });

      const logs: string[] = [];
      const result = await runNightlySummary({
        gateDir,
        repairDir,
        outPath,
        append: false
      }, {
        now: () => '2026-03-17T22:15:00.000Z',
        log: message => logs.push(message)
      });

      assert.equal(result.outPath, outPath);
      const written = fs.readFileSync(outPath, 'utf8');
      assert.match(written, /Generated: 2026-03-17T22:15:00.000Z/);
      assert.match(written, /Release gate: PASS/);
      assert.match(written, /Repair canary summary was not produced/);
      assert.ok(logs.some(message => message.includes('Nightly summary written to')));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('tolerates partial aggregate schema without crashing', () => {
    const markdown = buildNightlySummaryMarkdown({
      generatedAt: '2026-03-17T23:00:00.000Z',
      gateSummaryRows: [
        {
          scenario: 'ts-todo-oracle',
          passRate: 1,
          rawRunPassRate: 1,
          fallbackDependencyRunRate: 0,
          avgMs: 250
        }
      ],
      compare: {
        gate: {
          passed: true,
          violations: []
        },
        scenarios: [
          {
            scenario: 'ts-todo-oracle',
            delta: {
              passRate: 0,
              rawRunPassRate: 0,
              fallbackDependencyRunRate: 0,
              avgMs: 0
            }
          }
        ]
      },
      aggregate: {
        allGatePassed: true
      } as any,
      repairDir: 'repair-dir',
      repairSummaryRows: []
    });

    assert.match(markdown, /## Nightly Gate/);
    assert.doesNotMatch(markdown, /Aggregate gate failures:/);
    assert.doesNotMatch(markdown, /Trend scenario/);
    assert.match(markdown, /Repair canary summary was empty/);
  });

  it('renders an end-to-end nightly summary from gate and repair artifacts and appends to existing output', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-nightly-summary-'));
    try {
      const gateDir = path.join(tmp, 'release_gate_ci_nightly_5001_1');
      const repairDir = path.join(tmp, 'repair_nightly_canary_latest');
      const outPath = path.join(tmp, 'job-summary.md');

      writeJson(path.join(gateDir, 'summary.json'), [
        {
          scenario: 'ts-todo-oracle',
          passRate: 1,
          rawRunPassRate: 1,
          fallbackDependencyRunRate: 0,
          avgMs: 840
        },
        {
          scenario: 'node-api-oracle',
          passRate: 0.67,
          rawRunPassRate: 0.67,
          fallbackDependencyRunRate: 0.33,
          avgMs: 1290
        }
      ]);
      writeJson(path.join(gateDir, 'compare.json'), {
        gate: {
          passed: false,
          violations: [
            { message: 'node-api-oracle fallback dependency exceeds nightly threshold' }
          ]
        },
        scenarios: [
          {
            scenario: 'ts-todo-oracle',
            delta: {
              passRate: 0,
              rawRunPassRate: 0,
              fallbackDependencyRunRate: 0,
              avgMs: -35
            }
          },
          {
            scenario: 'node-api-oracle',
            delta: {
              passRate: -0.33,
              rawRunPassRate: -0.33,
              fallbackDependencyRunRate: 0.33,
              avgMs: 180
            }
          }
        ]
      });
      writeJson(path.join(gateDir, 'stability_aggregate.json'), {
        allGatePassed: false,
        gateFailures: [
          {
            runDir: path.join(tmp, 'release_gate_ci_nightly_4999_1'),
            message: 'node-api-oracle trend guard failed in 1/3 recent runs'
          }
        ],
        scenarios: [
          {
            scenario: 'ts-todo-oracle',
            rawRunPassRate: { min: 1, max: 1 },
            fallbackDependencyRunRate: { min: 0, max: 0 },
            avgMsDeltaVsBaseline: { avg: -20, min: -40, max: 10 }
          },
          {
            scenario: 'node-api-oracle',
            rawRunPassRate: { min: 0.67, max: 1 },
            fallbackDependencyRunRate: { min: 0, max: 0.33 },
            avgMsDeltaVsBaseline: { avg: 120, min: 40, max: 220 }
          }
        ]
      });

      writeJson(path.join(repairDir, 'summary.json'), [
        {
          scenario: 'ts-csv-repair-oracle',
          passRate: 1,
          rawRunPassRate: 1,
          fallbackDependencyRunRate: 0,
          avgMs: 502
        },
        {
          scenario: 'node-api-repair-oracle',
          passRate: 1,
          rawRunPassRate: 1,
          fallbackDependencyRunRate: 0,
          avgMs: 911
        }
      ]);

      fs.writeFileSync(outPath, '# Existing Summary\n\n', 'utf8');

      await runNightlySummary({
        gateDir,
        repairDir,
        outPath,
        append: true
      }, {
        now: () => '2026-03-17T22:45:00.000Z'
      });

      const written = fs.readFileSync(outPath, 'utf8');
      assert.match(written, /^# Existing Summary/m);
      assert.match(written, /Generated: 2026-03-17T22:45:00.000Z/);
      assert.match(written, /## Nightly Gate/);
      assert.match(written, /Release gate: FAIL/);
      assert.match(written, /Stability aggregate: FAIL/);
      assert.match(written, /node-api-oracle fallback dependency exceeds nightly threshold/);
      assert.match(written, /\| node-api-oracle \| 67% \| 67% \| 33% \| 1290 \| -33% \| -33% \| \+33% \| \+180 \|/);
      assert.match(written, /\| node-api-oracle \| 67% \| 100% \| 33% \| \+220 \|/);
      assert.match(written, /node-api-oracle trend guard failed in 1\/3 recent runs/);
      assert.match(written, /## Repair Canary/);
      assert.match(written, /\| ts-csv-repair-oracle \| 100% \| 100% \| 0% \| 502 \|/);
      assert.match(written, /\| node-api-repair-oracle \| 100% \| 100% \| 0% \| 911 \|/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});