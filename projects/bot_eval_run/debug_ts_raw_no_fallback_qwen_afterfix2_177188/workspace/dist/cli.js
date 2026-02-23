"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require('node:fs');
const path = require('node:path');
const store_1 = require("./store");
function parseArgs() {
    const args = process.argv.slice(2);
    const cmd = args[0];
    let dataPath = 'tasks.json';
    for (let i = 1; i < args.length; i++) {
        if (args[i] === '--data' && i + 1 < args.length) {
            dataPath = args[i + 1];
            break;
        }
    }
    return { cmd, dataPath };
}
function help() {
    console.log(`Usage:
  node dist/cli.js add <title> --data <path>
  node dist/cli.js list --data <path>
  node dist/cli.js done <id> --data <path>
  node dist/cli.js remove <id> --data <path>`);
    process.exit(0);
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        const { cmd, dataPath } = parseArgs();
        if (cmd === '--help' || process.argv.slice(2).includes('--help')) {
            help();
        }
        const store = new store_1.TaskStore(dataPath);
        try {
            switch (cmd) {
                case 'list':
                    console.log(JSON.stringify({ ok: true, tasks: store.list() }));
                    break;
                case 'add':
                    if (!args[1])
                        throw new Error('Title is required');
                    const task = store.add(args[1]);
                    console.log(JSON.stringify({ ok: true, task }));
                    break;
                case 'done':
                    if (!args[1])
                        throw new Error('ID is required');
                    const doneTask = store.done(args[1]);
                    console.log(JSON.stringify({ ok: true, task: doneTask }));
                    break;
                case 'remove':
                    if (!args[1])
                        throw new Error('ID is required');
                    const removedTask = store.remove(args[1]);
                    console.log(JSON.stringify({ ok: true, task: removedTask }));
                    break;
                default:
                    help();
            }
        }
        catch (error) {
            console.error(JSON.stringify({ ok: false, error: error.message }));
            process.exit(1);
        }
    });
}
main();
