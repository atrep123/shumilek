import * as fs from 'fs';
import * as path from 'path';
import Mocha from 'mocha';
import { register } from 'ts-node';

function collectTestFiles(dir: string, files: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTestFiles(fullPath, files);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }
}

export function run(): Promise<void> {
  register({
    project: path.resolve(__dirname, '../../../tsconfig.test.json'),
    transpileOnly: true
  });

  const mocha = new Mocha({
    ui: 'bdd',
    color: true
  });

  const testsRoot = path.resolve(__dirname, '../../../test');
  const files: string[] = [];
  collectTestFiles(testsRoot, files);
  files.forEach(file => mocha.addFile(file));

  return new Promise((resolve, reject) => {
    try {
      mocha.run(failures => {
        if (failures > 0) {
          reject(new Error(`${failures} test(s) failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}
