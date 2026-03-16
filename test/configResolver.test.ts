const mock = require('mock-require');
mock('vscode', {
  workspace: {
    getConfiguration: () => ({
      get: (key: string, def: any) => def
    })
  }
});

import { expect } from 'chai';
import { parseServerUrl, resolveModelPreset, clampNumber, MODEL_PRESETS, resolveExecutionMode } from '../src/configResolver';

describe('configResolver', () => {
  describe('parseServerUrl', () => {
    it('should parse a valid http URL', () => {
      const result = parseServerUrl('http://localhost:11434', 'http://localhost:11434');
      expect(result.baseUrl).to.equal('http://localhost:11434');
      expect(result.host).to.equal('localhost');
      expect(result.port).to.equal(11434);
    });

    it('should add http:// if missing', () => {
      const result = parseServerUrl('localhost:11434', 'http://localhost:11434');
      expect(result.baseUrl).to.equal('http://localhost:11434');
    });

    it('should use fallback for undefined input', () => {
      const result = parseServerUrl(undefined, 'http://localhost:11434');
      expect(result.baseUrl).to.equal('http://localhost:11434');
    });

    it('should use fallback for empty string', () => {
      const result = parseServerUrl('', 'http://localhost:11434');
      expect(result.baseUrl).to.equal('http://localhost:11434');
    });

    it('should use fallback for whitespace-only string', () => {
      const result = parseServerUrl('   ', 'http://localhost:11434');
      expect(result.baseUrl).to.equal('http://localhost:11434');
    });

    it('should default to port 80 for http without explicit port', () => {
      const result = parseServerUrl('http://example.com', 'http://localhost:11434');
      expect(result.port).to.equal(80);
    });

    it('should default to port 443 for https without explicit port', () => {
      const result = parseServerUrl('https://example.com', 'http://localhost:11434');
      expect(result.port).to.equal(443);
    });

    it('should parse unusual but valid-ish URLs tolerantly', () => {
      const result = parseServerUrl('not://a valid::url:::////', 'http://localhost:11434');
      // URL constructor may parse this; just verify we get some result
      expect(result.baseUrl).to.be.a('string');
      expect(result.host).to.be.a('string');
    });
  });

  describe('clampNumber', () => {
    it('should return the value when within range', () => {
      expect(clampNumber(5, 0, 1, 10)).to.equal(5);
    });

    it('should clamp to min when below', () => {
      expect(clampNumber(-1, 0, 1, 10)).to.equal(1);
    });

    it('should clamp to max when above', () => {
      expect(clampNumber(20, 0, 1, 10)).to.equal(10);
    });

    it('should use fallback for NaN', () => {
      expect(clampNumber(NaN, 5, 1, 10)).to.equal(5);
    });

    it('should use fallback for non-number', () => {
      expect(clampNumber('hello' as any, 5, 1, 10)).to.equal(5);
    });

    it('should use fallback for undefined', () => {
      expect(clampNumber(undefined, 5, 1, 10)).to.equal(5);
    });
  });

  describe('resolveModelPreset', () => {
    it('should return preset for known key', () => {
      const preset = resolveModelPreset('fast');
      expect(preset).to.exist;
      expect(preset!.model).to.be.a('string');
    });

    it('should return undefined for unknown model', () => {
      const preset = resolveModelPreset('unknown-model');
      expect(preset).to.be.undefined;
    });

    it('should return undefined for undefined', () => {
      const preset = resolveModelPreset(undefined);
      expect(preset).to.be.undefined;
    });
  });

  describe('MODEL_PRESETS', () => {
    it('should have at least one preset', () => {
      expect(Object.keys(MODEL_PRESETS).length).to.be.greaterThan(0);
    });

    it('each preset should have required fields', () => {
      for (const [name, preset] of Object.entries(MODEL_PRESETS)) {
        expect(preset, `${name} missing model`).to.have.property('model');
        expect(preset, `${name} missing writerModel`).to.have.property('writerModel');
        expect(preset, `${name} missing rozumModel`).to.have.property('rozumModel');
        expect(typeof preset.model, `${name} model not string`).to.equal('string');
      }
    });
  });

  describe('resolveExecutionMode', () => {
    it('should return chat for chat mode', () => {
      expect(resolveExecutionMode('chat', { requireToolCall: false, requireMutation: false })).to.equal('chat');
    });

    it('should return editor for editor mode', () => {
      expect(resolveExecutionMode('editor', { requireToolCall: false, requireMutation: false })).to.equal('editor');
    });

    it('should return editor for hybrid when mutation required', () => {
      expect(resolveExecutionMode('hybrid', { requireToolCall: true, requireMutation: true })).to.equal('editor');
    });

    it('should return chat for hybrid when no mutation required', () => {
      expect(resolveExecutionMode('hybrid', { requireToolCall: false, requireMutation: false })).to.equal('chat');
    });
  });
});
