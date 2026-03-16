const mock = require('mock-require');
mock('vscode', {
  workspace: {
    getConfiguration: () => ({
      get: (key: string, def: any) => def
    })
  }
});

import { expect } from 'chai';
import { parseServerUrl, resolveModelPreset, clampNumber, MODEL_PRESETS, resolveExecutionMode, resolveChatConfig } from '../src/configResolver';

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

  describe('resolveChatConfig', () => {
    function makeConfig(overrides: Record<string, any> = {}) {
      return {
        get: (key: string, def: any) => (key in overrides ? overrides[key] : def)
      } as any;
    }

    it('should return default config when no overrides', () => {
      const cfg = resolveChatConfig(makeConfig());
      expect(cfg.baseUrl).to.equal('http://localhost:11434');
      expect(cfg.maxRetries).to.equal(2);
      expect(cfg.guardianEnabled).to.equal(true);
      expect(cfg.toolsEnabled).to.equal(true);
      expect(cfg.rewardThreshold).to.equal(0.7);
    });

    it('should apply fast preset', () => {
      const cfg = resolveChatConfig(makeConfig({ modelPreset: 'fast' }));
      expect(cfg.baseModel).to.equal('qwen2.5-coder:7b');
      expect(cfg.writerModel).to.equal('qwen2.5-coder:7b');
      expect(cfg.miniModel).to.equal('qwen2.5:3b');
      expect(cfg.modelPreset).to.equal('fast');
    });

    it('should apply quality preset', () => {
      const cfg = resolveChatConfig(makeConfig({ modelPreset: 'quality' }));
      expect(cfg.baseModel).to.equal('deepseek-coder-v2:16b');
      expect(cfg.writerModel).to.equal('deepseek-coder-v2:16b');
    });

    it('should override all models for AirLLM backend', () => {
      const cfg = resolveChatConfig(makeConfig({
        backendType: 'airllm',
        'airllm.model': 'test-model'
      }));
      expect(cfg.useAirLLM).to.equal(true);
      expect(cfg.baseModel).to.equal('test-model');
      expect(cfg.writerModel).to.equal('test-model');
      expect(cfg.rozumModel).to.equal('test-model');
      expect(cfg.miniModel).to.equal('test-model');
      expect(cfg.summarizerModel).to.equal('test-model');
      expect(cfg.brainModels).to.deep.equal(['test-model']);
    });

    it('should use AirLLM server URL when backend is airllm', () => {
      const cfg = resolveChatConfig(makeConfig({
        backendType: 'airllm',
        'airllm.serverUrl': 'http://remote:9000'
      }));
      expect(cfg.baseUrl).to.equal('http://remote:9000');
    });

    it('should clamp maxRetries to 5', () => {
      const cfg = resolveChatConfig(makeConfig({ maxRetries: 100 }));
      expect(cfg.maxRetries).to.equal(5);
    });

    it('should default negative maxRetries to 2', () => {
      const cfg = resolveChatConfig(makeConfig({ maxRetries: -1 }));
      expect(cfg.maxRetries).to.equal(2);
    });

    it('should resolve effectiveAutoSteps as min of toolsMaxIterations and maxAutoSteps', () => {
      const cfg = resolveChatConfig(makeConfig({ toolsMaxIterations: 3, maxAutoSteps: 10 }));
      expect(cfg.effectiveAutoSteps).to.equal(3);
    });

    it('should use custom baseUrl when backend is ollama', () => {
      const cfg = resolveChatConfig(makeConfig({ baseUrl: 'http://my-host:5555' }));
      expect(cfg.baseUrl).to.equal('http://my-host:5555');
    });

    it('should fallback pegasus-large summarizerModel to baseModel', () => {
      const cfg = resolveChatConfig(makeConfig({
        modelPreset: 'custom',
        summarizerModel: 'pegasus-large',
        model: 'my-model'
      }));
      expect(cfg.summarizerModel).to.equal('my-model');
    });
  });
});
