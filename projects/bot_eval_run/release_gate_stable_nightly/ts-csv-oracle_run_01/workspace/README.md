# CSV Processor

This project provides a simple CSV parser and filter written in TypeScript using only Node.js built-in modules. It includes a command-line interface (CLI) for parsing and analyzing CSV files.

## Features

- **CSV Parsing**: Reads CSV data from a string, supports quoted fields with commas or double quotes inside.
- **CSV Filtering**: Filters, selects columns, sorts, and counts rows based on specified criteria.
- **CLI Commands**:
  - `parse --input <file>`: Parses the CSV file and outputs the data as a JSON array.
  - `stats --input <file>`: Provides statistics about the CSV file, including row count and column names.
  - `--help`: Displays help information.

## Usage

1. **Install Node.js**: Ensure you have Node.js installed on your system.
2. **Compile TypeScript**: Run `tsc` to compile the TypeScript code into JavaScript in the `dist/` directory.
3. **Run CLI Commands**:
   - `node dist/cli.js parse --input <file>`
   - `node dist/cli.js stats --input <file>`
   - `node dist/cli.js --help`

## Project Structure

- `README.md`: This file.
- `package.json`: Project configuration.
- `tsconfig.json`: TypeScript compiler options.
- `src/csv.ts`: Contains the `CsvParser` and `CsvFilter` classes.
- `src/cli.ts`: Implements the command-line interface.