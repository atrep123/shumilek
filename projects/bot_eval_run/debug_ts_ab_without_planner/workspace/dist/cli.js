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
function parseArgs(argv) {
    const args = [];
    const options = {};
    let currentOption = null;
    for (const arg of argv) {
        if (arg.startsWith('--')) {
            if (currentOption !== null) {
                options[currentOption] = '';
            }
            currentOption = arg.slice(2);
        }
        else if (currentOption !== null) {
            options[currentOption] = arg;
            currentOption = null;
        }
        else {
            args.push(arg);
        }
    }
    return { cmd: args[0], args: args.slice(1), options };
}
function help() {
    console.log(`
Usage:
  node dist/cli.js add <title> --data <path>
  node dist/cli.js list --data <path>
  node dist/cli.js done <id> --data <path>
  node dist/cli.js remove <id> --data <path>
`);
    process.exit(0);
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        const { cmd, args, options } = parseArgs(process.argv.slice(2));
        if (cmd === '--help') {
            help();
        }
        if (!options.data) {
            console.error('Missing --data option');
            process.exit(1);
        }
        const store = new store_1.TaskStore(options.data);
        try {
            switch (cmd) {
                case 'list':
                    const tasks = store.list();
                    console.log(JSON.stringify({ ok: true, tasks }));
                    break;
                case 'add':
                    if (!args[0]) {
                        throw new Error('Missing title');
                    }
                    const addedTask = store.add(args[0]);
                    console.log(JSON.stringify({ ok: true, task: addedTask }));
                    break;
                case 'done':
                    if (!args[0]) {
                        throw new Error('Missing id');
                    }
                    const doneTask = store.done(args[0]);
                    console.log(JSON.stringify({ ok: true, task: doneTask }));
                    break;
                case 'remove':
                    if (!args[0]) {
                        throw new Error('Missing id');
                    }
                    const removedTask = store.remove(args[0]);
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
