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
const crypto = require('node:crypto');
const store_1 = require("./store");
function parseArgs() {
    const args = process.argv.slice(2);
    const cmd = args[0];
    let dataPath = '';
    let titleOrId = '';
    for (let i = 1; i < args.length; i++) {
        if (args[i] === '--data') {
            dataPath = args[i + 1];
            i++;
        }
        else {
            titleOrId = args[i];
        }
    }
    return { cmd, dataPath, titleOrId };
}
function help() {
    console.log(`Usage:
  add <title> --data <path>
  list --data <path>
  done <id> --data <path>
  remove <id> --data <path>`);
    process.exit(0);
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        const { cmd, dataPath, titleOrId } = parseArgs();
        if (cmd === '--help') {
            help();
        }
        if (!dataPath) {
            console.error('Missing --data <path> argument');
            process.exit(1);
        }
        const store = new store_1.TaskStore(dataPath);
        try {
            switch (cmd) {
                case 'list':
                    const tasks = store.list();
                    console.log(JSON.stringify({ ok: true, tasks }));
                    break;
                case 'add':
                    if (!titleOrId) {
                        console.error('Missing title argument');
                        process.exit(1);
                    }
                    const task = store.add(titleOrId);
                    console.log(JSON.stringify({ ok: true, task }));
                    break;
                case 'done':
                    if (!titleOrId) {
                        console.error('Missing id argument');
                        process.exit(1);
                    }
                    const doneTask = store.done(titleOrId);
                    console.log(JSON.stringify({ ok: true, task: doneTask }));
                    break;
                case 'remove':
                    if (!titleOrId) {
                        console.error('Missing id argument');
                        process.exit(1);
                    }
                    const removedTask = store.remove(titleOrId);
                    console.log(JSON.stringify({ ok: true, task: removedTask }));
                    break;
                default:
                    console.error(`Unknown command: ${cmd}`);
                    process.exit(1);
            }
        }
        catch (error) {
            console.error(JSON.stringify({ ok: false, error: error.message }));
            process.exit(1);
        }
    });
}
main();
