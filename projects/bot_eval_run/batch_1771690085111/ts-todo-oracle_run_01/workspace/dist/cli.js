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
    const argv = process.argv.slice(2);
    const cmd = argv[0];
    let dataPath = 'tasks.json';
    for (let i = 1; i < argv.length; i++) {
        if (argv[i] === '--data' && i + 1 < argv.length) {
            dataPath = argv[i + 1];
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
        if (cmd === '--help') {
            help();
        }
        const store = new store_1.TaskStore(dataPath);
        try {
            switch (cmd) {
                case 'list':
                    console.log(JSON.stringify({ ok: true, tasks: store.list() }));
                    break;
                case 'add':
                    if (!process.argv[3])
                        throw new Error('Title is required');
                    const title = process.argv[3];
                    console.log(JSON.stringify({ ok: true, task: store.add(title) }));
                    break;
                case 'done':
                    if (!process.argv[3])
                        throw new Error('ID is required');
                    const idDone = process.argv[3];
                    console.log(JSON.stringify({ ok: true, task: store.done(idDone) }));
                    break;
                case 'remove':
                    if (!process.argv[3])
                        throw new Error('ID is required');
                    const idRemove = process.argv[3];
                    console.log(JSON.stringify({ ok: true, task: store.remove(idRemove) }));
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
