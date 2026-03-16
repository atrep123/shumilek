"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CsvFilter = exports.CsvParser = void 0;
const fs = require('node:fs');
class CsvParser {
    constructor(options) {
        this.delimiter = options?.delimiter ?? ',';
    }
    parse(text) {
        const lines = text.split('\n');
        const headers = lines[0].split(this.delimiter);
        return lines.slice(1).map(line => {
            const values = line.split(this.delimiter).map(value => {
                if (value.startsWith('"') && value.endsWith('"')) {
                    return value.slice(1, -1).replace(/""/g, '"');
                }
                return value;
            });
            return headers.reduce((acc, header, index) => ({ ...acc, [header]: values[index] }), {});
        });
    }
    stringify(rows) {
        if (rows.length === 0)
            return '';
        const headers = Object.keys(rows[0]);
        const delimiter = this.delimiter;
        const quote = '"';
        const escape = (value) => value.includes(delimiter) || value.includes(quote) ? `${quote}${value.replace(/"/g, '"")}${quote}` : value;)
            :
        ;
        return [
            headers.join(delimiter),
            ...rows.map(row => headers.map(header => escape(row[header])).join(delimiter))
        ].join('\n');
    }
}
exports.CsvParser = CsvParser;
class CsvFilter {
    constructor(rows) {
        this.rows = rows;
    }
    where(predicate) {
        return new CsvFilter(this.rows.filter(predicate));
    }
    select(columns) {
        return new CsvFilter(this.rows.map(row => columns.reduce((acc, column) => ({ ...acc, [column]: row[column] }), {})));
    }
    sortBy(column) {
        return new CsvFilter([...this.rows].sort((a, b) => a[column].localeCompare(b[column])));
    }
    count() {
        return this.rows.length;
    }
}
exports.CsvFilter = CsvFilter;
