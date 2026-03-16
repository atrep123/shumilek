# CSV Processor
This is a simple CSV processor written in TypeScript using Node.js built-in modules.

## Features
- Parse CSV files with support for quoted fields.
- Filter, select, sort, and count rows.
- CLI interface for parsing and statistics.

## Usage
### Parsing CSV
```bash
node dist/cli.js parse --input <file>
```

### Statistics
```bash
node dist/cli.js stats --input <file>
```

### Help
```bash
node dist/cli.js --help
```
