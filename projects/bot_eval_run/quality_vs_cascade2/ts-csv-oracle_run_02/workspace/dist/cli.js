const fs = require('node:fs');
const { CsvParser } = require('./csv');
function printHelp() {
    console.log('Usage:');
    console.log('  node dist/cli.js parse --input <file>');
    console.log('  node dist/cli.js stats --input <file>');
    console.log('  node dist/cli.js --help');
    console.log();
    console.log('Commands:');
    console.log('  parse   Parse CSV file and output JSON array');
    console.log('  stats   Show row count and column names');
    console.log('  --help  Show this help message');
}
function parseCommand(inputPath) {
    const content = fs.readFileSync(inputPath, 'utf8');
    const parser = new CsvParser();
    const rows = parser.parse(content);
    const json = JSON.stringify(rows);
    process.stdout.write(json + '\n');
}
function statsCommand(inputPath) {
    const content = fs.readFileSync(inputPath, 'utf8');
    const parser = new CsvParser();
    const rows = parser.parse(content);
    const columnNames = rows.length ? Object.keys(rows[0]) : [];
    console.log(`Rows: ${rows.length}`);
    console.log(`Columns: ${columnNames.join(', ')}`);
}
function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        printHelp();
        process.exit(1);
    }
    const helpIdx = args.indexOf('--help');
    if (helpIdx !== -1) {
        printHelp();
        process.exit(0);
    }
    const inputIdx = args.indexOf('--input');
    if (inputIdx === -1 || inputIdx === args.length - 1) {
        console.error('Error: --input <file> is required');
        process.exit(1);
    }
    const command = args[0];
    const inputPath = args[inputIdx + 1];
    if (command === 'parse') {
        parseCommand(inputPath);
    }
    else if (command === 'stats') {
        statsCommand(inputPath);
    }
    else {
        console.error(`Error: Unknown command '${command}'`);
        process.exit(1);
    }
}
main();
