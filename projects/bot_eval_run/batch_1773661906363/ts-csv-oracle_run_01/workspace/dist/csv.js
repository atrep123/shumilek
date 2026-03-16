"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CsvParser = void 0;
class CsvParser {
    parse(content) {
        const lines = content.split('\n');
        const headers = lines[0].split(',').map(header => header.trim());
        return lines.slice(1).map(line => {
            const values = line.split(',').map(value => value.trim());
            return headers.reduce((acc, header, index) => (Object.assign(Object.assign({}, acc), { [header]: values[index] })), {});
        });
    }
    stringify(data) {
        if (data.length === 0)
            return '';
        const headers = Object.keys(data[0]).join(', ') + '\n';
        const rows = data.map(item => Object.values(item).map(value => value.toString()).join(', ')).join('\n');
        return headers + rows;
    }
}
exports.CsvParser = CsvParser;
