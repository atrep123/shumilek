"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
import { Command } from 'commander';
import * as path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { TaskStore, Task } from './store';

const program = new Command();

program.version('1.0.0').description('A simple todo list CLI');

program
  .command('list')
  .option('--data <path>', 'Path to the data file', './data/tasks.json')
  .action((opts) => {
    const store = new TaskStore(opts.data);
    console.log(JSON.stringify({ ok: true, tasks: store.list() }, null, 2));
  });

program
  .command('add <title>')
  .option('--data <path>', 'Path to the data file', './data/tasks.json')
  .action((title, opts) => {
    const store = new TaskStore(opts.data);
    const task = store.add(title);
    console.log(JSON.stringify({ ok: true, task }, null, 2));
  });

program
  .command('done <id>')
  .option('--data <path>', 'Path to the data file', './data/tasks.json')
  .action((id, opts) => {
    const store = new TaskStore(opts.data);
    const task = store.done(id);
    console.log(JSON.stringify({ ok: true, task }, null, 2));
  });

program
  .command('remove <id>')
  .option('--data <path>', 'Path to the data file', './data/tasks.json')
  .action((id, opts) => {
    const store = new TaskStore(opts.data);
    const task = store.remove(id);
    console.log(JSON.stringify({ ok: true, task }, null, 2));
  });

program.parse(process.argv);
