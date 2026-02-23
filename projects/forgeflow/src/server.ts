import * as http from 'node:http';
import * as path from 'node:path';
import { loadConfig } from './config';
import { createLogger } from './logger';
import { runPipeline } from './runner/pipelineRunner';
import { validatePipeline } from './runner/validator';
import { PipelineDefinition, PipelineRunReport } from './runner/types';
import { writeReport } from './runner/reporter';

function sendJson(res: http.ServerResponse, code: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(body);
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf-8');
  return JSON.parse(raw || '{}');
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

export async function startServer(port?: number): Promise<http.Server> {
  const config = loadConfig(process.cwd());
  const logger = createLogger(config.logLevel);
  const runs = new Map<string, PipelineRunReport>();
  const serverPort = typeof port === 'number' ? port : config.serverPort;

  const server = http.createServer(async (req, res) => {
    if (!req.url) return sendJson(res, 404, { error: 'Missing URL' });

    const method = req.method || 'GET';
    const url = req.url.split('?')[0];

    if (method === 'GET' && url === '/health') {
      return sendJson(res, 200, { status: 'ok' });
    }

    if (method === 'POST' && url === '/pipelines/validate') {
      try {
        const body = await readJson(req);
        const validation = validatePipeline(body);
        return sendJson(res, validation.valid ? 200 : 400, validation);
      } catch (err) {
        return sendJson(res, 400, { error: String(err) });
      }
    }

    if (method === 'POST' && url === '/runs') {
      try {
        const body = await readJson(req);
        const validation = validatePipeline(body);
        if (!validation.valid) {
          return sendJson(res, 400, validation);
        }
        const report = await runPipeline(body as PipelineDefinition, {
          cwd: config.projectRoot,
          maxConcurrency: config.maxConcurrency,
          failFast: config.failFast,
          logger
        });
        runs.set(report.runId, report);

        const reportFile = path.join(
          config.reportDir,
          `${safeName(report.pipelineName)}-${report.runId}.json`
        );
        await writeReport(report, reportFile);

        return sendJson(res, 200, report);
      } catch (err) {
        return sendJson(res, 500, { error: String(err) });
      }
    }

    if (method === 'GET' && url.startsWith('/runs/')) {
      const runId = url.replace('/runs/', '');
      const report = runs.get(runId);
      if (!report) return sendJson(res, 404, { error: 'Run not found' });
      return sendJson(res, 200, report);
    }

    return sendJson(res, 404, { error: 'Not found' });
  });

  return new Promise(resolve => {
    server.listen(serverPort, () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : serverPort;
      logger.info(`ForgeFlow server listening on ${actualPort}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
