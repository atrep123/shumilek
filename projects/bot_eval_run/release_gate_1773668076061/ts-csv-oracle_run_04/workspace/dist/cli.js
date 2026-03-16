"use strict";
// src/cli.ts
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require('node:fs');
const csv_1 = require("./csv");
function parseCommand(inputFile) {
    const text = fs.readFileSync(inputFile, 'utf-8');
    const parser = new csv_1.CsvParser();
    const records = parser.parse(text);
    console.log(JSON.stringify(records, null, 2));
}
function statsCommand(inputFile) {
    const text = fs.readFileSync(inputFile, 'utf-8');
    const parser = new csv_1.CsvParser();
    const records = parser.parse(text);
    const filter = new csv_1.CsvFilter(records);
    console.log(`Total rows: ${filter.count()}`);
}
function helpCommand() {
    console.log('Usage:\n');
    console.log('Parsing CSV\nnode dist/cli.js parse --input <file>\n');
    console.log('Statistics\nnode dist/cli.js stats --input <file>\n');
    console.log('Help\nnode dist/cli.js --help\n');
}
if (process.argv.length < 3) {
    helpCommand();
}
else {
    const command = process.argv[2];
    if (command === 'parse') {
        const inputFile = process.argv.find(arg => arg.startsWith('--input='))?.split('=')[1];
        if (inputFile) {
            parseCommand(inputFile);
        }
        else {
            console.error('Missing input file. Use --input=<file>');
        }
    }
    else if (command === 'stats') {
        const inputFile = process.argv.find(arg => arg.startsWith('--input='))?.split('=')[1];
        if (inputFile) {
            statsCommand(inputFile);
        }
        else {
            console.error('Missing input file. Use --input=<file>');
        }
    }
    else if (command === '--help') {
        helpCommand();
    }
    else {
        console.error(`Unknown command: ${command}`);
    }
}
