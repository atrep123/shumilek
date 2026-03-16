// src/csv.ts

declare const require: any;
const fs = require('node:fs');
export {}

class CsvParser {
  private delimiter: string;

  constructor(options?: { delimiter?: string }) {
    this.delimiter = options?.delimiter || ',';
  }

  parse(text: string): Record<string, string>[] {
    const lines = text.split('\n');
    const headers = lines[0].split(this.delimiter);
    return lines.slice(1).map(line => {
      const values = line.split(new RegExp(`\s*${this.delimiter}\s*|(?<=")${this.delimiter}(?=")`, 'g'));
      return headers.reduce((acc, header, index) => {
        acc[header] = values[index].replace(/(^"|"$)/g, '');
        return acc;
      }, {} as Record<string, string>);
    });
  }

  stringify(rows: Record<string, string>[]): string {
    if (rows.length === 0) return '';

    const headers = Object.keys(rows[0]);
    const quotedFields = rows.map(row => {
      return headers.map(header => {
        const value = row[header];
        return value.includes(this.delimiter) || value.includes('"') ? `"${value.replace(/"/g, '"\")}"` : value;
      });
    });

    return [headers.join(this.delimiter), ...quotedFields.map(row => row.join(this.delimiter))].join('\n');
  }
}

class CsvFilter {
  private data: Record<string, string>[],

  constructor(data: Record<string, string>[]) {
    this.data = data;
  }

  where(condition: (row: Record<string, string>) => boolean): CsvFilter {
    return new CsvFilter(this.data.filter(condition));
  }

  select(fields: string[]): CsvFilter {
    return new CsvFilter(this.data.map(row => {
      const newRow = {} as Record<string, string>;
      fields.forEach(field => {
        if (row.hasOwnProperty(field)) {
          newRow[field] = row[field];
        }
      });
      return newRow;
    }));
  }

  sortBy(field: string): CsvFilter {
    return new CsvFilter([...this.data].sort((a, b) => {
      if (a[field] < b[field]) return -1;
      if (a[field] > b[field]) return 1;
      return 0;
    }));
  }

  count(): number {
    return this.data.length;
  }
}
