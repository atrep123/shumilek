"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const store_1 = require("./store");
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';

const program = new Command();

program
  .option('--data <path>', 'specify the data file path')
  .parse(process.argv);

const options = program.opts();

if (!options.data) {
  console.error('Error: --data option is required');
  process.exit(1);
}

const store = new store_1.TaskStore(options.data);

program
  .command('list')
  .description('List all tasks')
  .action(() => {
    console.log(JSON.stringify({ ok: true, tasks: store.list() }));
  });

program
  .command('add <title>')
  .description('Add a new task')
  .action((title) => {
    const task = store.add(title);
    console.log(JSON.stringify({ ok: true, task }));
  });

program
  .command('done <id>')
  .description('Mark a task as done')
  .action((id) => {
    const task = store.done(id);
    console.log(JSON.stringify({ ok: true, task }));
  });

program
  .command('remove <id>')
  .description('Remove a task')
  .action((id) => {
    const task = store.remove(id);
    console.log(JSON.stringify({ ok: true, task }));
  });

program.parse();
