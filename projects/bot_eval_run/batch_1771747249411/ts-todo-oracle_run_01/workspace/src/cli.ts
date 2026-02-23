declare const require: any;
declare const process: any;
const { TaskStore } = require('./store');

function usage(): string {
  return 'Usage:\n  list --data <path>\n  add <title> --data <path>\n  done <id> --data <path>\n  remove <id> --data <path>\n  --help';
}

function parseDataPath(args: string[]): string | null {
  const idx = args.indexOf('--data');
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return null;
}

function firstPositional(args: string[]): string | null {
  for (const token of args) {
    if (!token.startsWith('--')) return token;
  }
  return null;
}

function main(): number {
  const argv = process.argv.slice(2);
  const cmd = String(argv[0] || '');

  if (cmd === '' || cmd === '--help') {
    console.log(usage());
    return 0;
  }

  const dataPath = parseDataPath(argv);
  if (!dataPath) {
    console.error('Missing --data <path>');
    return 1;
  }

  const value = firstPositional(argv.slice(1));
  const store = new TaskStore(dataPath);

  try {
    if (cmd === 'list') {
      console.log(JSON.stringify({ ok: true, tasks: store.list() }));
      return 0;
    }
    if (cmd === 'add') {
      if (!value) throw new Error('Missing title');
      console.log(JSON.stringify({ ok: true, task: store.add(value) }));
      return 0;
    }
    if (cmd === 'done') {
      if (!value) throw new Error('Missing id');
      console.log(JSON.stringify({ ok: true, task: store.done(value) }));
      return 0;
    }
    if (cmd === 'remove') {
      if (!value) throw new Error('Missing id');
      console.log(JSON.stringify({ ok: true, task: store.remove(value) }));
      return 0;
    }
    console.error('Unknown command');
    return 1;
  } catch (error: any) {
    console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }));
    return 1;
  }
}

const exitCode = main();
if (typeof process?.exit === "function") process.exit(exitCode);
