declare const require: any;
declare const process: any;
const fs = require('node:fs');
import { CsvParser, CsvFilter } from './csv';

function help() {
  console.log(`
# CSV Processor
This is a simple CSV processor written in TypeScript using Node.js built-in modules.

## Features
- Parse CSV files with support for quoted fields.
- Filter, select, sort, and count rows.
- CLI interface for parsing and statistics.

## Usage
### Parsing CSV

cd dist
node cli.js parse --input <file>

### Statistics

cd dist
node cli.js stats --input <file>

### Help

cd dist
node cli.js --help
`);
}

function parse(input: string) {
  const parser = new CsvParser();
  const data = fs.readFileSync(input, 'utf-8');
  console.log(JSON.stringify(parser.parse(data), null, 2));
}

function stats(input: string) {
  const parser = new CsvParser();
  const data = fs.readFileSync(input, 'utf-8');
  const filter = new CsvFilter(parser.parse(data));
  console.log(`Total rows: ${filter.count()}`);
}

if (process.argv.length < 3) {
  help();
} else {
  switch (process.argv[2]) {
    case 'parse':
      if (process.argv.includes('--input')) {
        parse(process.argv[process.argv.indexOf('--input') + 1]);
      } else {
        console.error('Missing --input option');
      }
      break;
    case 'stats':
      if (process.argv.includes('--input')) {
        stats(process.argv[process.argv.indexOf('--input') + 1]);
      } else {
        console.error('Missing --input option');
      }
      break;
    default:
      help();
  }
}
