import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

import {
  PixelLabLocalBridgeServer,
  buildPixelLabManifestPath,
  normalizeMcpToolResult,
  readPixelLabConfigFromWorkspace
} from '../src/pixellabBridge';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shumilek-pixellab-'));
}

async function requestJson(baseUrl: string, requestPath: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ statusCode: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const url = new URL(requestPath, baseUrl);
    const req = http.request(
      url,
      {
        method: init?.method ?? 'GET',
        headers: init?.headers
      },
      res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const json = JSON.parse(body || '{}') as Record<string, unknown>;
            resolve({ statusCode: res.statusCode ?? 0, json });
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    req.on('error', reject);
    if (init?.body) {
      req.write(init.body);
    }
    req.end();
  });
}

describe('pixellabBridge', () => {
  it('reads pixellab MCP config from workspace .vscode/mcp.json', () => {
    const workspaceRoot = makeTempDir();
    const vscodeDir = path.join(workspaceRoot, '.vscode');
    fs.mkdirSync(vscodeDir, { recursive: true });
    fs.writeFileSync(
      path.join(vscodeDir, 'mcp.json'),
      JSON.stringify({
        servers: {
          pixellab: {
            type: 'http',
            url: 'https://api.pixellab.ai/mcp',
            headers: {
              Authorization: 'Bearer test-token'
            }
          }
        }
      }),
      'utf8'
    );

    const config = readPixelLabConfigFromWorkspace([workspaceRoot]);

    assert.ok(config);
    assert.equal(config?.workspaceRoot, workspaceRoot);
    assert.equal(config?.serverUrl, 'https://api.pixellab.ai/mcp');
    assert.equal(config?.headers.Authorization, 'Bearer test-token');
  });

  it('normalizes structured and text MCP tool results', () => {
    assert.deepEqual(
      normalizeMcpToolResult({ structuredContent: { character_id: 'char-1' } }),
      { character_id: 'char-1' }
    );

    assert.deepEqual(
      normalizeMcpToolResult({ content: [{ type: 'text', text: '{"status":"ready"}' }] }),
      { status: 'ready' }
    );
  });

  it('starts a localhost bridge, proxies tool calls, and writes a runtime manifest', async () => {
    const workspaceRoot = makeTempDir();
    const vscodeDir = path.join(workspaceRoot, '.vscode');
    const uiDir = path.join(workspaceRoot, 'projects', 'shumilek_ui');
    fs.mkdirSync(vscodeDir, { recursive: true });
    fs.mkdirSync(uiDir, { recursive: true });
    fs.writeFileSync(
      path.join(vscodeDir, 'mcp.json'),
      JSON.stringify({
        servers: {
          pixellab: {
            type: 'http',
            url: 'https://api.pixellab.ai/mcp',
            headers: {
              Authorization: 'Bearer live-token'
            }
          }
        }
      }),
      'utf8'
    );

    const clientCalls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    let transportClosed = false;

    const bridge = new PixelLabLocalBridgeServer(
      () => [workspaceRoot],
      {
        createClient: () => ({
          connect: async () => undefined,
          listTools: async () => ({
            tools: [
              { name: 'create_character' },
              { name: 'get_character' },
              { name: 'create_topdown_tileset' },
              { name: 'get_topdown_tileset' }
            ]
          }),
          callTool: async ({ name, arguments: args }) => {
            clientCalls.push({ name, args });
            if (name === 'create_character') {
              return { structuredContent: { character_id: 'char-99' } };
            }
            if (name === 'get_character') {
              return { content: [{ type: 'text', text: '{"status":"ready","download_url":"https://example.invalid/char.zip"}' }] };
            }
            if (name === 'create_topdown_tileset') {
              return { structuredContent: { tileset_id: 'tileset-77' } };
            }
            return { structuredContent: { status: 'processing' } };
          }
        }),
        createTransport: config => {
          assert.equal(config.headers.Authorization, 'Bearer live-token');
          return {
            close: async () => {
              transportClosed = true;
            }
          };
        }
      }
    );

    try {
      const started = await bridge.start();
      assert.equal(started, true);

      const manifestPath = buildPixelLabManifestPath(workspaceRoot);
      assert.ok(fs.existsSync(manifestPath));

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { baseUrl: string; availableTools: string[] };
      assert.ok(manifest.baseUrl.startsWith('http://127.0.0.1:'));
      assert.ok(manifest.availableTools.includes('create_character'));

      const healthResponse = await requestJson(manifest.baseUrl, '/health');
      const health = healthResponse.json as { ok: boolean; availableTools: string[] };
      assert.equal(health.ok, true);
      assert.ok(health.availableTools.includes('get_character'));

      const createResponse = await requestJson(manifest.baseUrl, '/character/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'forest spirit', n_directions: 8, size: 48 })
      });
      const created = createResponse.json as { ok: boolean; result: { character_id: string } };
      assert.equal(created.ok, true);
      assert.equal(created.result.character_id, 'char-99');

      const getResponse = await requestJson(manifest.baseUrl, '/character/get', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ character_id: 'char-99', include_preview: true })
      });
      const fetched = getResponse.json as { ok: boolean; result: { status: string; download_url: string } };
      assert.equal(fetched.ok, true);
      assert.equal(fetched.result.status, 'ready');
      assert.match(fetched.result.download_url, /char\.zip$/);

      assert.deepEqual(clientCalls[0], {
        name: 'create_character',
        args: { description: 'forest spirit', n_directions: 8, size: 48 }
      });
      assert.deepEqual(clientCalls[1], {
        name: 'get_character',
        args: { character_id: 'char-99', include_preview: true }
      });
    } finally {
      await bridge.dispose();
    }

    assert.equal(transportClosed, true);
    assert.ok(!fs.existsSync(buildPixelLabManifestPath(workspaceRoot)));
  });
});
