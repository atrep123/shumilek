"use strict";
// src/cli.ts
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require('node:fs');
const csv_1 = require("./csv");
function parseCommand(inputFile) {
    const text = fs.readFileSync(inputFile, 'utf-8');
    const parser = new csv_1.CsvParser();
    const data = parser.parse(text);
    console.log(JSON.stringify(data, null, 2));
}
function statsCommand(inputFile) {
    const text = fs.readFileSync(inputFile, 'utf-8');
    const parser = new csv_1.CsvParser();
    const data = parser.parse(text);
    const filter = new csv_1.CsvFilter(data);
    console.log(`Total rows: ${filter.count()}`);
}
function helpCommand() {
    console.log('Usage:\n');
    console.log('Parsing CSV\nnode dist/cli.js parse --input <file>\n');
    console.log('Statistics\nnode dist/cli.js stats --input <file>\n');
    console.log('Help\nnode dist/cli.js --help\n');
}
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help') {
    helpCommand();
}
else if (args[0] === 'parse' && args[1] === '--input') {
    parseCommand(args[2]);
}
else if (args[0] === 'stats' && args[1] === '--input') {
    statsCommand(args[2]);
}
else {
    console.error('Invalid command. Use --help for more information.');
}
