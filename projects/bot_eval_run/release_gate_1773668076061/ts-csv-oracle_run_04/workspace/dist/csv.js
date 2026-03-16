"use strict";
// src/csv.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.CsvFilter = exports.CsvParser = void 0;
const fs = require('node:fs');
class CsvParser {
    constructor(options = {}) {
        this.delimiter = options.delimiter || ',';
    }
    parse(text) {
        const lines = text.split('\n');
        const headers = lines[0].split(this.delimiter);
        return lines.slice(1).map(line => {
            const values = line.split(new RegExp(`\${this.delimiter}(?=(?:[^'"]*(?:['"](?:[^'"']*['"])*[^'"']*)*[^'"']*$)`));
            const record = {};
            headers.forEach((header, index) => {
                record[header] = values[index];
            });
            return record;
        }).filter(record => Object.keys(record).length > 0);
    }
    stringify(records) {
        if (records.length === 0)
            return '';
        const headers = Object.keys(records[0]);
        const quotedHeaders = headers.map(header => header.includes(this.delimiter) || header.includes('"') ? `"${header}"` : header);
        const quotedRecords = records.map(record => {
            return headers.map(header => record[header].includes(this.delimiter) || record[header].includes('"') ? `"${record[header]}"` : record[header]).join(this.delimiter);
        });
        return [quotedHeaders.join(this.delimiter), ...quotedRecords].join('\n');
    }
}
exports.CsvParser = CsvParser;
class CsvFilter {
    constructor(records) {
        this.records = records;
    }
    where(predicate) {
        return new CsvFilter(this.records.filter(predicate));
    }
    select(fields) {
        return this.records.map(record => {
            const selectedRecord = {};
            fields.forEach(field => {
                if (record.hasOwnProperty(field)) {
                    selectedRecord[field] = record[field];
                }
            });
            return selectedRecord;
        });
    }
    sortBy(field) {
        return new CsvFilter(this.records.slice().sort((a, b) => {
            if (a[field] < b[field])
                return -1;
            if (a[field] > b[field])
                return 1;
            return 0;
        }));
    }
    count() {
        return this.records.length;
    }
}
exports.CsvFilter = CsvFilter;
