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

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage:
  parse --input <file>
  stats --input <file>');
  process.exit(0);
} else if (args[0] === 'parse' && args[1] === '--input') {
  parseFile(args[2]);
} else if (args[0] === 'stats' && args[1] === '--input') {
  statsFile(args[2]);
} else {
  console.error('Invalid command. Use --help for usage instructions.');
  process.exit(1);
}
