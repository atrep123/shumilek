import * as fs from 'fs';
import * as path from 'path';

type CleanupPolicy = {
  prefix: string;
  keep: number;
};

type CleanupOptions = {
  root: string;
  policies: CleanupPolicy[];
  dryRun: boolean;
  outPath?: string;
};

function parseArgs(argv: string[]): CleanupOptions {
  const opts: CleanupOptions = {
    root: path.resolve('projects/bot_eval_run'),
    policies: [],
    dryRun: false,
    outPath: undefined
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[i + 1];
    if (a === '--root' && next()) {
      opts.root = path.resolve(next());
      i++;
      continue;
    }
    if (a === '--policy' && next()) {
      const raw = String(next()).trim();
      const idx = raw.lastIndexOf(':');
      if (idx <= 0 || idx >= raw.length - 1) {
        throw new Error(`Invalid --policy "${raw}", expected prefix:keep`);
      }
      const prefix = raw.slice(0, idx);
      const keep = Number(raw.slice(idx + 1));
      if (!Number.isFinite(keep) || keep < 0) {
        throw new Error(`Invalid keep value in --policy "${raw}"`);
      }
      opts.policies.push({ prefix, keep: Math.trunc(keep) });
      i++;
      continue;
    }
    if (a === '--dryRun') {
      opts.dryRun = true;
      continue;
    }
    if (a === '--out' && next()) {
      opts.outPath = path.resolve(next());
      i++;
      continue;
    }
    if (a === '--help' || a === '-h') {
      printUsageAndExit(0);
    }
  }

  if (opts.policies.length === 0) {
    opts.policies = [
      { prefix: 'release_gate_ci_pr_', keep: 10 },
      { prefix: 'release_gate_ci_nightly_', keep: 10 }
    ];
  }

  return opts;
}

function printUsageAndExit(code: number): never {
  // eslint-disable-next-line no-console
  console.log([
    'Usage: npm run bot:eval:cleanup -- [options]',
    '',
    'Options:',
    '  --root <dir>           Root directory (default: projects/bot_eval_run)',
    '  --policy <prefix:keep> Repeatable policy entry (example: release_gate_ci_pr_:10)',
    '  --dryRun               Show what would be deleted without deleting',
    '  --out <path>           Write JSON cleanup report',
    '  -h, --help             Show this help',
  ].join('\n'));
  process.exit(code);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const report: any = {
    generatedAt: new Date().toISOString(),
    root: opts.root,
    dryRun: opts.dryRun,
    policies: opts.policies,
    results: [] as any[]
  };

  if (!fs.existsSync(opts.root)) {
    // eslint-disable-next-line no-console
    console.log(`Cleanup root does not exist: ${opts.root}`);
    return;
  }

  const allDirs = fs.readdirSync(opts.root, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => ({
      name: d.name,
      fullPath: path.join(opts.root, d.name),
      mtimeMs: fs.statSync(path.join(opts.root, d.name)).mtimeMs
    }));

  for (const policy of opts.policies) {
    const matched = allDirs
      .filter(d => d.name.startsWith(policy.prefix))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    const keep = matched.slice(0, policy.keep);
    const deleteList = matched.slice(policy.keep);

    for (const target of deleteList) {
      if (!opts.dryRun) {
        await fs.promises.rm(target.fullPath, { recursive: true, force: true });
      }
    }

    report.results.push({
      prefix: policy.prefix,
      keep: policy.keep,
      matched: matched.length,
      kept: keep.map(d => d.name),
      deleted: deleteList.map(d => d.name)
    });
  }

  if (opts.outPath) {
    await fs.promises.mkdir(path.dirname(opts.outPath), { recursive: true });
    await fs.promises.writeFile(opts.outPath, JSON.stringify(report, null, 2), 'utf8');
  }

  // eslint-disable-next-line no-console
  console.log(`Cleanup completed for ${opts.root}`);
  for (const r of report.results) {
    // eslint-disable-next-line no-console
    console.log(`${r.prefix} matched=${r.matched} kept=${r.kept.length} deleted=${r.deleted.length}`);
  }
}

if (require.main === module) {
  main().catch(err => {
    // eslint-disable-next-line no-console
    console.error('botEvalCleanup failed:', err);
    process.exit(1);
  });
}

