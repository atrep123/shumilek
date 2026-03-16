// src/csv.ts

declare const require: any;
declare const process: any;
const fs = require('node:fs');

export interface CsvParserOptions {
  delimiter?: string;
}

export class CsvParser {
  private delimiter: string;

  constructor(options: CsvParserOptions = {}) {
    this.delimiter = options.delimiter || ',';
  }

  parse(text: string): Record<string, string>[] {
    const lines = text.split('\n');
    const headers = lines[0].split(this.delimiter);
    return lines.slice(1).map(line => {
      const values = line.split(new RegExp(`\${this.delimiter}(?=(?:[^'"]*(?:['"](?:[^'"']*['"])*[^'"']*)*[^'"']*$)`));
      const record: Record<string, string> = {};
      headers.forEach((header, index) => {
        record[header] = values[index];
      });
      return record;
    }).filter(record => Object.keys(record).length > 0);
  }

  stringify(records: Record<string, string>[]): string {
    if (records.length === 0) return '';

    const headers = Object.keys(records[0]);
    const quotedHeaders = headers.map(header => header.includes(this.delimiter) || header.includes('"') ? `"${header}"` : header);
    const quotedRecords = records.map(record => {
      return headers.map(header => record[header].includes(this.delimiter) || record[header].includes('"') ? `"${record[header]}"` : record[header]).join(this.delimiter);
    });

    return [quotedHeaders.join(this.delimiter), ...quotedRecords].join('\n');
  }
}

export class CsvFilter {
  private records: Record<string, string>[];

  constructor(records: Record<string, string>[]) {
    this.records = records;
  }

  where(predicate: (record: Record<string, string>) => boolean): CsvFilter {
    return new CsvFilter(this.records.filter(predicate));
  }

  select(fields: string[]): Record<string, string>[] {
    return this.records.map(record => {
      const selectedRecord: Record<string, string> = {};
      fields.forEach(field => {
        if (record.hasOwnProperty(field)) {
          selectedRecord[field] = record[field];
        }
      });
      return selectedRecord;
    });
  }

  sortBy(field: string): CsvFilter {
    return new CsvFilter(this.records.slice().sort((a, b) => {
      if (a[field] < b[field]) return -1;
      if (a[field] > b[field]) return 1;
      return 0;
    }));
  }

  count(): number {
    return this.records.length;
  }
}
