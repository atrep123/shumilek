export class CsvParser {
  parse(content: string): any[] {
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

export class CsvFilter {
  filter(rows: any[], column: string, value: string): any[] {
    return rows.filter(row => row[column] === value);
  }
}
