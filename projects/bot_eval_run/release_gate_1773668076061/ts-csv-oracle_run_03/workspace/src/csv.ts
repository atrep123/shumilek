declare const require: any;
declare const process: any;
const fs = require('node:fs');

export class CsvParser {
  private delimiter: string;

  constructor(options?: { delimiter?: string }) {
    this.delimiter = options?.delimiter ?? ',';
  }

  parse(text: string): Record<string, string>[] {
    const lines = text.split('\n');
    const headers = lines[0].split(this.delimiter);
    return lines.slice(1).map(line => {
      const values = line.split(this.delimiter).map(value => {
        if (value.startsWith('"') && value.endsWith('"')) {
          return value.slice(1, -1).replace(/""/g, '"');
        }
        return value;
      });
      return headers.reduce((acc, header, index) => ({ ...acc, [header]: values[index] }), {} as Record<string, string>);
    });
  }

  stringify(rows: Record<string, string>[]): string {
    if (rows.length === 0) return '';
    const headers = Object.keys(rows[0]);
    const delimiter = this.delimiter;
    const quote = '"';

    const escape = (value: string) => value.includes(delimiter) || value.includes(quote) ? `${quote}${value.replace(/"/g, '"")}${quote}` : value;

    return [
      headers.join(delimiter),
      ...rows.map(row => headers.map(header => escape(row[header])).join(delimiter))
    ].join('\n');
  }
}

export class CsvFilter {
  private rows: Record<string, string>[];

  constructor(rows: Record<string, string>[]) {
    this.rows = rows;
  }

  where(predicate: (row: Record<string, string>) => boolean): CsvFilter {
    return new CsvFilter(this.rows.filter(predicate));
  }

  select(columns: string[]): CsvFilter {
    return new CsvFilter(this.rows.map(row => columns.reduce((acc, column) => ({ ...acc, [column]: row[column] }), {} as Record<string, string>)));
  }

  sortBy(column: string): CsvFilter {
    return new CsvFilter([...this.rows].sort((a, b) => a[column].localeCompare(b[column])));
  }

  count(): number {
    return this.rows.length;
  }
}
