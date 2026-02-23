"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require('node:fs');
const store_1 = __importDefault(require("./store"));
const argv = process.argv.slice(2);
const command = argv[0];
const dataPath = (_a = argv.find(arg => arg.startsWith('--data='))) === null || _a === void 0 ? void 0 : _a.split('=')[1];
if (command === '--help') {
    console.log(`
Usage:
  add <title> --data <path>
  list --data <path>
  done <id> --data <path>
  remove <id> --data <path>
  --help
`);
}
else if (command && dataPath) {
    const taskStore = new store_1.default(dataPath);
    switch (command) {
        case 'add':
            const title = argv.find(arg => !arg.startsWith('--')) || '';
            console.log(taskStore.add(title));
            break;
        case 'list':
            console.log(JSON.stringify(taskStore.list(), null, 2));
            break;
        case 'done':
            const id = argv.find(arg => !arg.startsWith('--')) || '';
            console.log(taskStore.done(id));
            break;
        case 'remove':
            const removeId = argv.find(arg => !arg.startsWith('--')) || '';
            console.log(taskStore.remove(removeId));
            break;
        default:
            console.error('Unknown command');
    }
}
else {
    console.error('Invalid usage. Use --help for more information.');
}
