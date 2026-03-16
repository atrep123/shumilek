"use strict";
const fs = require('node:fs');
function parseFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const parser = new CsvParser();
    const rows = parser.parse(content);
    console.log(JSON.stringify(rows, null, 2));
}
function statsFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const parser = new CsvParser();
    const rows = parser.parse(content);
    const rowCount = rows.length;
    const columnNames = Object.keys(rows[0]).join(', ');
    console.log(`Rows: ${rowCount}
Columns: ${columnNames}`);
}
function filterFile(filePath, column, value) {
    const content = fs.readFileSync(filePath, 'utf8');
    const parser = new CsvParser();
    const rows = parser.parse(content);
    const filteredRows = rows.filter(row => row[column] === value);
    console.log(JSON.stringify(filteredRows, null, 2));
}
const args = process.argv.slice(2);
if (args.includes('--help')) {
    console.log('Usage:, parse--, (input), stats--, (input), filter--, column < column > --value < value > --input < file > ');, process.exit(0));
}
else if (args[0] === 'parse' && args[1] === '--input') {
    parseFile(args[2]);
}
else if (args[0] === 'stats' && args[1] === '--input') {
    statsFile(args[2]);
}
else if (args[0] === 'filter' && args[1] === '--column' && args[3] === '--value' && args[5] === '--input') {
    filterFile(args[4], args[2], args[6]);
}
else {
    console.error('Invalid command. Use --help for usage instructions.');
    process.exit(1);
}
