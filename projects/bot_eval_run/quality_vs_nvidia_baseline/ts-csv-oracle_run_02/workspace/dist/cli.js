const fs = require('node:fs');
const path = require('node:path');
const { CsvParser } = require('./csv');
function main() {
    const args = process.argv.slice(2);
    const command = args[0] || '';
    if (command === '--help' || command === '-h' || command === '') {
        console.log('Usage:');
        console.log('  parse --input <file>   Parse CSV and output JSON');
        console.log('  stats --input <file>   Show CSV statistics');
        console.log('  --help                 Show this help');
        return 0;
    }
    const inputIdx = args.indexOf('--input');
    if (inputIdx < 0 || inputIdx + 1 >= args.length) {
        console.error('Missing --input <file>');
        return 1;
    }
    const inputFile = args[inputIdx + 1];
    let content;
    try {
        content = fs.readFileSync(inputFile, 'utf8');
    }
    catch (err) {
        console.error('Error reading file: ' + String(err && err.message ? err.message : err));
        return 1;
    }
    const parser = new CsvParser();
    const rows = parser.parse(content);
    if (command === 'parse') {
        console.log(JSON.stringify(rows, null, 2));
        return 0;
    }
    if (command === 'stats') {
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        console.log('Rows: ' + rows.length);
        console.log('Columns: ' + columns.join(', '));
        return 0;
    }
    console.error('Unknown command: ' + command);
    return 1;
}
const exitCode = main();
if (typeof process !== "undefined" && typeof process.exit === "function")
    process.exit(exitCode);
