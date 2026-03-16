// src/cli.ts

export {}
declare const require: any;
const fs = require('node:fs');
const path = require('node:path');
const { CsvParser, CsvFilter } = require('../dist/csv.js');

function help() {
  console.log(`
# CSV Processor CLI

## Usage
### Parsing CSV
	node dist/cli.js parse --input <file>

### Statistics
	node dist/cli.js stats --input <file>

### Help
	node dist/cli.js --help
`);
}

function parse(args: string[]) {
  const input = args.find(arg => arg.startsWith('--input='));
  if (!input) {
    console.error('Missing --input argument');
    return;
  }

  const filePath = path.resolve(input.split('=')[1]);
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const parser = new CsvParser();
  const data = parser.parse(fileContent);
  console.log(JSON.stringify(data, null, 2));
}

function stats(args: string[]) {
  const input = args.find(arg => arg.startsWith('--input='));
  if (!input) {
    console.error('Missing --input argument');
    return;
  }

  const filePath = path.resolve(input.split('=')[1]);
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const parser = new CsvParser();
  const data = parser.parse(fileContent);
  const filter = new CsvFilter(data);
  console.log(`Total rows: ${filter.count()}`);
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    help();
  } else if (args[0] === 'parse') {
    parse(args);
  } else if (args[0] === 'stats') {
    stats(args);
  } else {
    console.error('Unknown command');
  }
}

main();