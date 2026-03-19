import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import fetch from 'node-fetch';

const { Client } = require('@modelcontextprotocol/sdk/client') as {
  Client: new (
    clientInfo: { name: string; version: string },
    options?: { capabilities?: Record<string, unknown> }
  ) => PixelLabMcpClient;
};
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js') as {
  StreamableHTTPClientTransport: new (
    url: URL,
    options?: {
      fetch?: typeof globalThis.fetch;
      requestInit?: { headers?: Record<string, string> };
    }
  ) => PixelLabTransport;
};

export interface PixelLabServerConfig {
  workspaceRoot: string;
  serverKey: string;
  serverUrl: string;
  headers: Record<string, string>;
}

export interface PixelLabBridgeManifest {
  version: 1;
  mode: 'live-mcp';
  port: number;
  baseUrl: string;
  manifestPath: string;
  availableTools: string[];
  serverUrl: string;
  updatedAt: string;
}

export interface PixelLabMcpClient {
  connect(transport: PixelLabTransport): Promise<void>;
  listTools(): Promise<{ tools: Array<{ name: string }> }>;
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<Record<string, unknown>>;
}

export interface PixelLabTransport {
  close(): Promise<void>;
}

interface PixelLabBridgeDeps {
  createClient?: () => PixelLabMcpClient;
  createTransport?: (config: PixelLabServerConfig) => PixelLabTransport;
  now?: () => Date;
  log?: (message: string) => void;
}

interface PendingServerState {
  httpServer?: http.Server;
  client?: PixelLabMcpClient;
  transport?: PixelLabTransport;
  availableTools: Set<string>;
  manifestPath?: string;
  manifest?: PixelLabBridgeManifest;
}

function defaultClientFactory(): PixelLabMcpClient {
  return new Client(
    { name: 'Shumilek PixelLab Bridge', version: '0.1.0' },
    { capabilities: {} }
  ) as unknown as PixelLabMcpClient;
}

function defaultTransportFactory(config: PixelLabServerConfig): PixelLabTransport {
  return new StreamableHTTPClientTransport(new URL(config.serverUrl), {
    fetch: fetch as unknown as typeof globalThis.fetch,
    requestInit: {
      headers: config.headers
    }
  }) as unknown as PixelLabTransport;
}

export function buildPixelLabManifestPath(workspaceRoot: string): string {
  const uiRoot = path.join(workspaceRoot, 'projects', 'shumilek_ui');
  if (fs.existsSync(uiRoot) && fs.statSync(uiRoot).isDirectory()) {
    return path.join(uiRoot, '.pixellab-bridge.json');
  }
  return path.join(workspaceRoot, '.pixellab-bridge.json');
}

export function listCandidateManifestPaths(workspaceRoot: string): string[] {
  return [
    path.join(workspaceRoot, 'projects', 'shumilek_ui', '.pixellab-bridge.json'),
    path.join(workspaceRoot, '.pixellab-bridge.json')
  ];
}

export function readPixelLabConfigFromWorkspace(workspaceRoots: string[]): PixelLabServerConfig | undefined {
  for (const workspaceRoot of workspaceRoots) {
    const configPath = path.join(workspaceRoot, '.vscode', 'mcp.json');
    if (!fs.existsSync(configPath)) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      continue;
    }

    if (!parsed || typeof parsed !== 'object') {
      continue;
    }

    const servers = (parsed as { servers?: Record<string, unknown> }).servers;
    if (!servers || typeof servers !== 'object') {
      continue;
    }

    const pixellab = servers.pixellab;
    if (!pixellab || typeof pixellab !== 'object') {
      continue;
    }

    const rawUrl = (pixellab as { url?: unknown }).url;
    if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
      continue;
    }

    const rawHeaders = (pixellab as { headers?: Record<string, unknown> }).headers;
    const headers: Record<string, string> = {};
    if (rawHeaders && typeof rawHeaders === 'object') {
      for (const [key, value] of Object.entries(rawHeaders)) {
        if (typeof value === 'string') {
          headers[key] = value;
        }
      }
    }

    return {
      workspaceRoot,
      serverKey: 'pixellab',
      serverUrl: rawUrl.trim(),
      headers
    };
  }

  return undefined;
}

export function normalizeMcpToolResult(result: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  if (typeof result.isError === 'boolean') {
    normalized.is_error = result.isError;
  }

  const structuredContent = result.structuredContent;
  if (structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)) {
    return { ...normalized, ...(structuredContent as Record<string, unknown>) };
  }

  const toolResult = result.toolResult;
  if (toolResult && typeof toolResult === 'object' && !Array.isArray(toolResult)) {
    return { ...normalized, ...(toolResult as Record<string, unknown>) };
  }

  const content = result.content;
  if (Array.isArray(content)) {
    const textParts = content
      .filter(entry => entry && typeof entry === 'object' && (entry as { type?: unknown }).type === 'text')
      .map(entry => (entry as { text?: unknown }).text)
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

    if (textParts.length > 0) {
      const combined = textParts.join('\n').trim();
      try {
        const parsed = JSON.parse(combined);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return { ...normalized, ...(parsed as Record<string, unknown>) };
        }
      } catch {
        return { ...normalized, text: combined };
      }
      return { ...normalized, text: combined };
    }
  }

  return { ...normalized, raw: result };
}

export class PixelLabLocalBridgeServer {
  private readonly deps: Required<PixelLabBridgeDeps>;
  private readonly workspaceRootsProvider: () => string[];
  private readonly state: PendingServerState = { availableTools: new Set<string>() };
  private startPromise: Promise<boolean> | undefined;

  constructor(workspaceRootsProvider: () => string[], deps: PixelLabBridgeDeps = {}) {
    this.workspaceRootsProvider = workspaceRootsProvider;
    this.deps = {
      createClient: deps.createClient ?? defaultClientFactory,
      createTransport: deps.createTransport ?? defaultTransportFactory,
      now: deps.now ?? (() => new Date()),
      log: deps.log ?? (() => undefined)
    };
  }

  async start(): Promise<boolean> {
    if (!this.startPromise) {
      this.startPromise = this.startInternal();
    }
    return this.startPromise;
  }

  async dispose(): Promise<void> {
    this.startPromise = undefined;
    await this.stopInternal();
  }

  getManifest(): PixelLabBridgeManifest | undefined {
    return this.state.manifest;
  }

  private async startInternal(): Promise<boolean> {
    const workspaceRoots = this.workspaceRootsProvider();
    const config = readPixelLabConfigFromWorkspace(workspaceRoots);
    if (!config) {
      await this.cleanupManifests(workspaceRoots);
      this.deps.log('[PixelLab] No pixellab MCP config found, bridge not started');
      return false;
    }

    await this.stopInternal();

    const client = this.deps.createClient();
    const transport = this.deps.createTransport(config);
    await client.connect(transport);
    const tools = await client.listTools();
    const availableTools = new Set((tools.tools ?? []).map(tool => tool.name));

    const httpServer = http.createServer((request, response) => {
      void this.handleRequest(request, response);
    });

    const port = await new Promise<number>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(0, '127.0.0.1', () => {
        const address = httpServer.address();
        if (!address || typeof address === 'string') {
          reject(new Error('PixelLab bridge failed to obtain a local port'));
          return;
        }
        resolve(address.port);
      });
    });

    const manifestPath = buildPixelLabManifestPath(config.workspaceRoot);
    const manifest: PixelLabBridgeManifest = {
      version: 1,
      mode: 'live-mcp',
      port,
      baseUrl: `http://127.0.0.1:${port}`,
      manifestPath,
      availableTools: Array.from(availableTools).sort(),
      serverUrl: config.serverUrl,
      updatedAt: this.deps.now().toISOString()
    };

    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    this.state.client = client;
    this.state.transport = transport;
    this.state.httpServer = httpServer;
    this.state.availableTools = availableTools;
    this.state.manifestPath = manifestPath;
    this.state.manifest = manifest;

    this.deps.log(`[PixelLab] Local bridge started on ${manifest.baseUrl}`);
    return true;
  }

  private async stopInternal(): Promise<void> {
    const server = this.state.httpServer;
    this.state.httpServer = undefined;

    if (server) {
      await new Promise<void>(resolve => {
        server.close(() => resolve());
      });
    }

    const transport = this.state.transport;
    this.state.transport = undefined;
    if (transport) {
      await transport.close().catch(() => undefined);
    }

    if (this.state.manifestPath) {
      try {
        if (fs.existsSync(this.state.manifestPath)) {
          fs.unlinkSync(this.state.manifestPath);
        }
      } catch {
        // ignore cleanup failure
      }
    }

    this.state.client = undefined;
    this.state.manifest = undefined;
    this.state.manifestPath = undefined;
    this.state.availableTools.clear();
  }

  private async cleanupManifests(workspaceRoots: string[]): Promise<void> {
    for (const workspaceRoot of workspaceRoots) {
      for (const manifestPath of listCandidateManifestPaths(workspaceRoot)) {
        try {
          if (fs.existsSync(manifestPath)) {
            fs.unlinkSync(manifestPath);
          }
        } catch {
          // ignore cleanup failure
        }
      }
    }
  }

  private async handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    try {
      const method = String(request.method ?? 'GET').toUpperCase();
      const pathname = new URL(String(request.url ?? '/'), 'http://127.0.0.1').pathname;

      if (method === 'GET' && pathname === '/health') {
        this.sendJson(response, 200, {
          ok: true,
          mode: 'live-mcp',
          availableTools: Array.from(this.state.availableTools).sort()
        });
        return;
      }

      const client = this.state.client;
      if (!client) {
        this.sendJson(response, 503, { ok: false, error: 'PixelLab bridge is not initialized' });
        return;
      }

      if (method === 'POST' && pathname === '/character/create') {
        const body = await this.readJsonBody(request);
        const result = await this.callTool(client, 'create_character', {
          description: body.description,
          n_directions: body.n_directions,
          size: body.size
        });
        this.sendJson(response, 200, { ok: true, result });
        return;
      }

      if (method === 'POST' && pathname === '/character/get') {
        const body = await this.readJsonBody(request);
        const result = await this.callTool(client, 'get_character', {
          character_id: body.character_id,
          include_preview: body.include_preview
        });
        this.sendJson(response, 200, { ok: true, result });
        return;
      }

      if (method === 'POST' && pathname === '/tileset/create') {
        const body = await this.readJsonBody(request);
        const result = await this.callTool(client, 'create_topdown_tileset', {
          lower_description: body.lower_description,
          upper_description: body.upper_description,
          tile_size: body.tile_size
        });
        this.sendJson(response, 200, { ok: true, result });
        return;
      }

      if (method === 'POST' && pathname === '/tileset/get') {
        const body = await this.readJsonBody(request);
        const result = await this.callTool(client, 'get_topdown_tileset', {
          tileset_id: body.tileset_id
        });
        this.sendJson(response, 200, { ok: true, result });
        return;
      }

      this.sendJson(response, 404, { ok: false, error: 'Not found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.sendJson(response, 500, { ok: false, error: message });
    }
  }

  private async callTool(
    client: PixelLabMcpClient,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    if (!this.state.availableTools.has(toolName)) {
      throw new Error(`PixelLab tool is not available: ${toolName}`);
    }

    const result = await client.callTool({ name: toolName, arguments: args });
    const normalized = normalizeMcpToolResult(result);
    if (result.isError === true) {
      const text = typeof normalized.text === 'string' ? normalized.text : undefined;
      throw new Error(text || `PixelLab tool failed: ${toolName}`);
    }
    return normalized;
  }

  private async readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
    const body = await new Promise<string>((resolve, reject) => {
      let collected = '';
      request.on('data', chunk => {
        collected += String(chunk);
      });
      request.on('end', () => resolve(collected));
      request.on('error', reject);
    });

    if (!body.trim()) {
      return {};
    }

    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Expected a JSON object body');
    }
    return parsed as Record<string, unknown>;
  }

  private sendJson(response: http.ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
    response.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    });
    response.end(JSON.stringify(payload));
  }
}