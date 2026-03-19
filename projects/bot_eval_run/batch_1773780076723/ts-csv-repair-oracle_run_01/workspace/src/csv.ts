declare const require: any;

export class CsvParser {
  private delimiter: string;

  constructor(options?: { delimiter?: string }) {
    this.delimiter = (options && options.delimiter) || ',';
  }

  parse(text: string): Record<string, string>[] {
    if (!text || !text.trim()) return [];
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const headerLine = lines[0];
    if (!headerLine) return [];
    const headers = this.splitRow(headerLine);
    const result: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const values = this.splitRow(line);
      const row: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = values[j] || '';
      }
      result.push(row);
    }
    return result;
  }

  stringify(rows: Record<string, string>[]): string {
    if (rows.length === 0) return "";
    const headers = Object.keys(rows[0]);
    const lines: string[] = [headers.map(h => this.quoteField(h)).join(this.delimiter)];
    for (const row of rows) {
      lines.push(headers.map(h => this.quoteField(String(row[h] ?? ""))).join(this.delimiter));
    }
    return lines.join('\n') + '\n';
  }

  private quoteField(field: string): string {
    if (field.indexOf(this.delimiter) >= 0 || field.indexOf('"') >= 0 || field.indexOf("\n") >= 0) {
      return '"' + field.replace(/"/g, '""') + '"';
    }
    return field;
  }

  private splitRow(line: string): string[] {
    const fields: string[] = [];
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
          } else {
            inQuotes = false;
            i++;
          }
        } else {
          current += ch;
          i++;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
          i++;
        } else if (ch === this.delimiter) {
          fields.push(current);
          current = '';
          i++;
        } else {
          current += ch;
          i++;
        }
      }
    }
    fields.push(current);
    return fields;
  }
}

export class CsvFilter {
  private rows: Record<string, string>[];

  constructor(rows: Record<string, string>[]) {
    this.rows = rows;
  }

  where(predicate: (row: Record<string, string>) => boolean): Record<string, string>[] {
    return this.rows.filter(predicate);
  }

  select(columns: string[]): Record<string, string>[] {
    return this.rows.map(row => {
      const out: Record<string, string> = {};
      for (const col of columns) {
        out[col] = row[col] ?? '';
      }
      return out;
    });
  }

  sortBy(column: string): Record<string, string>[] {
    return [...this.rows].sort((a, b) => {
      const va = a[column] ?? '';
      const vb = b[column] ?? '';
      return va < vb ? -1 : va > vb ? 1 : 0;
    });
  }

  count(): number {
    return this.rows.length;
  }
}
