# CSV CLI

A simple command-line tool to parse CSV files and output JSON or statistics.

## Usage

```
node dist/cli.js parse --input data.csv
node dist/cli.js stats --input data.csv
node dist/cli.js --help
```

## Features

- Parse CSV with support for quoted fields and escaped quotes
- Select columns and sort rows using the CsvFilter class
- Simple stats: row count and column names

## License

MIT