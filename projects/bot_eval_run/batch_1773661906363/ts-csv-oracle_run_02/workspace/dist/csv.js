"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CsvFilter = exports.CsvParser = void 0;
class CsvParser {
    parse(content) {
        const lines = content.split('\n');
        const headers = lines[0].split(',').map(header => header.trim());
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            const row = {};
            const values = lines[i].split(',').map(value => value.trim());
            headers.forEach((header, index) => {
                row[header] = values[index];
            });
            rows.push(row);
        }
        return rows;
    }
}
exports.CsvParser = CsvParser;
class CsvFilter {
    filter(rows, column, value) {
        return rows.filter(row => row[column] === value);
    }
}
exports.CsvFilter = CsvFilter;
