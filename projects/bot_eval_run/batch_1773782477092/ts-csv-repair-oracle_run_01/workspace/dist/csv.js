"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CsvFilter = exports.CsvParser = void 0;
class CsvParser {
    constructor(options) {
        this.delimiter = (options && options.delimiter) || ',';
    }
    parse(text) {
        if (!text || !text.trim())
            return [];
        const lines = text.replace(/\r\n/g, '\n').split('\n');
        const headerLine = lines[0];
        if (!headerLine)
            return [];
        const headers = this.splitRow(headerLine);
        const result = [];
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trim())
                continue;
            const values = this.splitRow(line);
            const row = {};
            for (let j = 0; j < headers.length; j++) {
                row[headers[j]] = values[j] || '';
            }
            result.push(row);
        }
        return result;
    }
    stringify(rows) {
        if (rows.length === 0)
            return "";
        const headers = Object.keys(rows[0]);
        const lines = [headers.map(h => this.quoteField(h)).join(this.delimiter)];
        for (const row of rows) {
            lines.push(headers.map(h => this.quoteField(String(row[h] ?? ""))).join(this.delimiter));
        }
        return lines.join('\n') + '\n';
    }
    quoteField(field) {
        if (field.indexOf(this.delimiter) >= 0 || field.indexOf('"') >= 0 || field.indexOf("\n") >= 0) {
            return '"' + field.replace(/"/g, '""') + '"';
        }
        return field;
    }
    splitRow(line) {
        const fields = [];
        let current = '';
        let inQuotes = false;
        let i = 0;
        while (i < line.length) {
            const ch = line[i];
            if (inQuotes) {
                if (ch === '"') {
                    if (i + 1 < line.length && line[i + 1] === '"') {
                        current += '"';
                        i += 2;
                    }
                    else {
                        inQuotes = false;
                        i++;
                    }
                }
                else {
                    current += ch;
                    i++;
                }
            }
            else {
                if (ch === '"') {
                    inQuotes = true;
                    i++;
                }
                else if (ch === this.delimiter) {
                    fields.push(current);
                    current = '';
                    i++;
                }
                else {
                    current += ch;
                    i++;
                }
            }
        }
        fields.push(current);
        return fields;
    }
}
exports.CsvParser = CsvParser;
class CsvFilter {
    constructor(rows) {
        this.rows = rows;
    }
    where(predicate) {
        return this.rows.filter(predicate);
    }
    select(columns) {
        return this.rows.map(row => {
            const out = {};
            for (const col of columns) {
                out[col] = row[col] ?? '';
            }
            return out;
        });
    }
    sortBy(column) {
        return [...this.rows].sort((a, b) => {
            const va = a[column] ?? '';
            const vb = b[column] ?? '';
            return va < vb ? -1 : va > vb ? 1 : 0;
        });
    }
    count() {
        return this.rows.length;
    }
}
exports.CsvFilter = CsvFilter;
