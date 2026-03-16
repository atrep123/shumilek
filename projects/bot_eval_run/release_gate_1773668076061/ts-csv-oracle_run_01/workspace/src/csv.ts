// src/csv.ts

declare const require: any;
const fs = require('node:fs');

export {};

type CsvParserOptions = {
  delimiter?: string;
};

class CsvParser {
  private delimiter: string;

  constructor(options: CsvParserOptions = {}) {
    this.delimiter = options.delimiter || ',';
  }

  parse(text: string): Record<string, string>[] {
    const lines = text.split('\n');
    const headers = lines[0].split(this.delimiter);
    return lines.slice(1).map(line => {
      const values = line.split(this.delimiter);
      const record: Record<string, string> = {};
      for (let i = 0; i < headers.length; i++) {
        record[headers[i]] = values[i];
      }
      return record;
    });
  }

  stringify(rows: Record<string, string>[]): string {
    if (rows.length === 0) return '';

    const headers = Object.keys(rows[0]);
    const headerLine = headers.join(this.delimiter);

    const lines = rows.map(row => {
      return headers.map(header => {
        const value = row[header];
        if (value.includes(this.delimiter) || value.includes('