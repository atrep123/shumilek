const mock = require('mock-require');
mock('vscode', {});
mock('node-fetch', () => { throw new Error('fetch not mocked'); });

const { expect } = require('chai');
const { formatDoctorReport } = require('../src/doctor');

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
