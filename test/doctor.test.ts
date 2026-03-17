var mock = require('mock-require');
var expect = require('chai').expect;

function loadDoctor(fetchImpl?: (url: string, options?: Record<string, unknown>) => Promise<any>) {
  mock.stopAll();
  mock('vscode', {});
  mock('node-fetch', fetchImpl || (async () => { throw new Error('fetch not mocked'); }));
  return mock.reRequire('../src/doctor');
}

describe('doctor', () => {
  afterEach(() => {
    mock.stopAll();
  });

  describe('runDoctorChecks', () => {
    it('fails fast when Ollama connection is unavailable', async () => {
      const { runDoctorChecks } = loadDoctor(async () => {
        throw new Error('connect ECONNREFUSED');
      });

      const report = await runDoctorChecks({
        baseUrl: 'http://localhost:11434',
        mainModel: 'main',
        writerModel: 'writer',
        rozumModel: 'rozum',
        svedomiModel: 'svedomi',
        timeoutMs: 100
      });

      expect(report.ok).to.equal(false);
      expect(report.checks).to.have.length(2);
      expect(report.checks[0].name).to.equal('Ollama spojení');
      expect(report.checks[0].status).to.equal('fail');
      expect(report.checks[1]).to.deep.equal({
        name: 'Modely',
        status: 'fail',
        detail: 'Nelze ověřit — Ollama nedostupná'
      });
    });

    it('reports healthy local setup with available models and successful generation', async () => {
      const fetchCalls: string[] = [];
      const { runDoctorChecks } = loadDoctor(async (url: string) => {
        fetchCalls.push(url);
        if (url.endsWith('/api/tags')) {
          if (fetchCalls.filter(value => value.endsWith('/api/tags')).length === 1) {
            return { ok: true, status: 200 };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              models: [
                { name: 'main:latest', size: 1 },
                { name: 'writer', size: 1 },
                { name: 'svedomi', size: 1 }
              ]
            })
          };
        }
        if (url.endsWith('/api/generate')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ response: 'OK generated' })
          };
        }
        throw new Error(`unexpected url ${url}`);
      });

      const report = await runDoctorChecks({
        baseUrl: 'http://localhost:11434',
        mainModel: 'main',
        writerModel: 'writer',
        rozumModel: 'main',
        svedomiModel: 'svedomi',
        timeoutMs: 100
      });

      expect(report.ok).to.equal(true);
      expect(report.checks.some((check: any) => check.name === 'Model: main' && check.status === 'ok')).to.equal(true);
      expect(report.checks.some((check: any) => check.name === 'Model: writer' && check.status === 'ok')).to.equal(true);
      expect(report.checks.some((check: any) => check.name === 'Model: svedomi' && check.status === 'ok')).to.equal(true);
      expect(report.checks.some((check: any) => check.name === 'Dostupné modely' && check.detail.includes('3 modelů'))).to.equal(true);
      expect(report.checks.some((check: any) => check.name === 'Generování' && check.status === 'ok' && check.detail.includes('OK generated'))).to.equal(true);
      expect(report.checks.some((check: any) => check.name === 'Bezpečnost URL' && check.detail.includes('Lokální backend'))).to.equal(true);
      expect(report.checks.filter((check: any) => check.name.startsWith('Model:'))).to.have.length(3);
    });

    it('adds remote backend warning without failing an otherwise healthy report', async () => {
      let tagCallCount = 0;
      const { runDoctorChecks } = loadDoctor(async (url: string) => {
        if (url.endsWith('/api/tags')) {
          tagCallCount++;
          if (tagCallCount === 1) return { ok: true, status: 200 };
          return {
            ok: true,
            status: 200,
            json: async () => ({
              models: [
                { name: 'main', size: 1 },
                { name: 'writer', size: 1 },
                { name: 'rozum', size: 1 },
                { name: 'svedomi', size: 1 }
              ]
            })
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ response: 'OK' })
        };
      });

      const report = await runDoctorChecks({
        baseUrl: 'http://remote.example.test:11434',
        mainModel: 'main',
        writerModel: 'writer',
        rozumModel: 'rozum',
        svedomiModel: 'svedomi',
        timeoutMs: 100
      });

      expect(report.ok).to.equal(true);
      const remoteCheck = report.checks.find((check: any) => check.name === 'Bezpečnost URL');
      expect(remoteCheck).to.include({ status: 'warn' });
      expect(remoteCheck.detail).to.include('Remote backend');
    });
  });
});

const { formatDoctorReport } = loadDoctor();

describe('formatDoctorReport', () => {
  it('should format all-ok report', () => {
    const report = {
      checks: [
        { name: 'Ollama spojení', status: 'ok', detail: 'localhost — OK' },
        { name: 'Model: qwen', status: 'ok', detail: 'Hlavní model — dostupný' },
      ],
      ok: true,
    };
    const text = formatDoctorReport(report);
    expect(text).to.include('✅');
    expect(text).to.include('Vše v pořádku');
    expect(text).to.include('Ollama spojení');
    expect(text).to.include('Model: qwen');
  });

  it('should format report with failures', () => {
    const report = {
      checks: [
        { name: 'Ollama spojení', status: 'fail', detail: 'nedostupná' },
        { name: 'Modely', status: 'fail', detail: 'Nelze ověřit' },
      ],
      ok: false,
    };
    const text = formatDoctorReport(report);
    expect(text).to.include('❌');
    expect(text).to.include('Nalezeny problémy');
  });

  it('should format report with warnings', () => {
    const report = {
      checks: [
        { name: 'Ollama spojení', status: 'ok', detail: 'OK' },
        { name: 'Bezpečnost URL', status: 'warn', detail: 'Remote backend' },
      ],
      ok: true,
    };
    const text = formatDoctorReport(report);
    expect(text).to.include('⚠️');
    expect(text).to.include('Bezpečnost URL');
  });

  it('should include header', () => {
    const report = { checks: [], ok: true };
    const text = formatDoctorReport(report);
    expect(text).to.include('Doctor');
    expect(text).to.include('Diagnostika');
  });

  it('should handle empty checks', () => {
    const report = { checks: [], ok: true };
    const text = formatDoctorReport(report);
    expect(text).to.include('Vše v pořádku');
  });

  it('should include check details', () => {
    const report = {
      checks: [
        { name: 'Generování', status: 'ok', detail: 'qwen — OK (250ms): "OK"' },
      ],
      ok: true,
    };
    const text = formatDoctorReport(report);
    expect(text).to.include('250ms');
    expect(text).to.include('Generování');
  });
});
