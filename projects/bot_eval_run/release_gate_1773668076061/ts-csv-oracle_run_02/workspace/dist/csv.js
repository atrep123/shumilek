"use strict";
// src/csv.ts
const fs = require('node:fs');
class CsvParser {
    constructor(options = {}) {
        this.delimiter = options.delimiter || ',';
    }
    parse(text) {
        const lines = text.split('\n');
        const headers = lines[0].split(this.delimiter);
        return lines.slice(1).map(line => {
            const values = line.split(this.delimiter);
            const record = {};
            for (let i = 0; i < headers.length; i++) {
                record[headers[i]] = values[i];
            }
            return record;
        });
    }
    stringify(rows) {
        if (rows.length === 0)
            return '';
        const headers = Object.keys(rows[0]);
        const headerLine = headers.join(this.delimiter);
        const lines = rows.map(row => {
            return headers.map(header => {
                const value = row[header];
                if (value.includes(this.delimiter) || value.includes('))
                    ;
            });
        });
    }
}
