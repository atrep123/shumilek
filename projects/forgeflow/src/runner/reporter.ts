import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PipelineRunReport } from './types';

export async function writeReport(report: PipelineRunReport, reportPath: string): Promise<void> {
  const dir = path.dirname(reportPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), { encoding: 'utf-8' });
}
