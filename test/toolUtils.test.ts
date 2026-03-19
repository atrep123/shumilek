import { expect } from 'chai';
import {
  buildToolOnlyPrompt,
  buildEditorFirstInstructions,
  sanitizeEditorAnswer,
  buildEditorStateMessage,
  extractJsonPayload,
  coerceEditorAction,
  parseEditorPlanResponse,
  getToolRequirements,
  getStepToolRequirements
} from '../src/toolUtils';

describe('toolUtils', () => {
  // ---- buildToolOnlyPrompt ----
  describe('buildToolOnlyPrompt', () => {
    it('includes mutation requirement when requireMutation is true', () => {
      const result = buildToolOnlyPrompt(true);
      expect(result).to.include('write_file/replace_lines');
    });

    it('includes tool_call requirement when requireMutation is false', () => {
      const result = buildToolOnlyPrompt(false);
      expect(result).to.include('alespon jeden tool_call');
    });

    it('lists available tools', () => {
      const result = buildToolOnlyPrompt(false);
      expect(result).to.include('list_files');
      expect(result).to.include('write_file');
      expect(result).to.include('fetch_webpage');
      expect(result).to.include('browser_open_page');
    });
  });

  // ---- buildEditorFirstInstructions ----
  describe('buildEditorFirstInstructions', () => {
    it('returns EDITOR-FIRST MODE instructions', () => {
      const result = buildEditorFirstInstructions();
      expect(result).to.include('EDITOR-FIRST MODE');
      expect(result).to.include('JSON');
    });

    it('mentions supported actions', () => {
      const result = buildEditorFirstInstructions();
      expect(result).to.include('apply_patch');
      expect(result).to.include('write_file');
      expect(result).to.include('replace_lines');
    });
  });

  // ---- sanitizeEditorAnswer ----
  describe('sanitizeEditorAnswer', () => {
    it('returns empty for empty input', () => {
      expect(sanitizeEditorAnswer('', [])).to.equal('');
      expect(sanitizeEditorAnswer('  ', [])).to.equal('');
    });

    it('filters build/lint/test lines', () => {
      const text = 'Done\nRun npm build to compile\nAll good';
      expect(sanitizeEditorAnswer(text, [])).to.equal('Done\nAll good');
    });

    it('filters error lines when all results ok', () => {
      const results = [{ ok: true, tool: 'write_file', approved: true }];
      const text = 'Done\nSoubor nebyl nalezen\nAll good';
      expect(sanitizeEditorAnswer(text, results)).to.equal('Done\nAll good');
    });

    it('keeps error lines when some results failed', () => {
      const results = [{ ok: false, tool: 'write_file' }];
      const text = 'Done\nSoubor nebyl nalezen\nAll good';
      expect(sanitizeEditorAnswer(text, results)).to.include('Soubor nebyl nalezen');
    });
  });

  // ---- buildEditorStateMessage ----
  describe('buildEditorStateMessage', () => {
    it('returns undefined for undefined session', () => {
      expect(buildEditorStateMessage(undefined)).to.be.undefined;
    });

    it('returns undefined for empty session', () => {
      expect(buildEditorStateMessage({
        hadMutations: false,
        mutationTools: []
      })).to.be.undefined;
    });

    it('includes lastWritePath', () => {
      const result = buildEditorStateMessage({
        hadMutations: true,
        mutationTools: ['write_file'],
        lastWritePath: 'src/foo.ts'
      });
      expect(result).to.include('EDITOR_STATE');
      expect(result).to.include('src/foo.ts');
    });

    it('includes lastWriteAction', () => {
      const result = buildEditorStateMessage({
        hadMutations: true,
        mutationTools: ['write_file'],
        lastWriteAction: 'created'
      });
      expect(result).to.include('created');
    });
  });

  // ---- extractJsonPayload ----
  describe('extractJsonPayload', () => {
    it('returns undefined for empty string', () => {
      expect(extractJsonPayload('')).to.be.undefined;
      expect(extractJsonPayload('  ')).to.be.undefined;
    });

    it('returns raw JSON object', () => {
      expect(extractJsonPayload('{"a":1}')).to.equal('{"a":1}');
    });

    it('returns raw JSON array', () => {
      expect(extractJsonPayload('[1,2]')).to.equal('[1,2]');
    });

    it('extracts from fenced code block', () => {
      const text = 'some text\n```json\n{"a":1}\n```\nmore text';
      expect(extractJsonPayload(text)).to.equal('{"a":1}');
    });

    it('extracts from braces as fallback', () => {
      const text = 'here is the result: {"name":"test"} end';
      expect(extractJsonPayload(text)).to.equal('{"name":"test"}');
    });

    it('returns undefined for text without JSON', () => {
      expect(extractJsonPayload('no json here')).to.be.undefined;
    });
  });

  // ---- coerceEditorAction ----
  describe('coerceEditorAction', () => {
    it('returns null for empty object', () => {
      expect(coerceEditorAction({})).to.be.null;
    });

    it('extracts name from "name" key', () => {
      const result = coerceEditorAction({ name: 'write_file', arguments: { path: 'a.txt' } });
      expect(result).to.deep.equal({ name: 'write_file', arguments: { path: 'a.txt' } });
    });

    it('extracts name from "tool" key', () => {
      const result = coerceEditorAction({ tool: 'read_file', path: 'b.txt' });
      expect(result).to.not.be.null;
      expect(result!.name).to.equal('read_file');
    });

    it('extracts name from "action" key', () => {
      const result = coerceEditorAction({ action: 'delete_file', path: 'c.txt' });
      expect(result).to.not.be.null;
      expect(result!.name).to.equal('delete_file');
    });

    it('collects remaining keys as arguments when no arguments key', () => {
      const result = coerceEditorAction({ name: 'write_file', path: 'd.txt', text: 'hello' });
      expect(result).to.not.be.null;
      expect(result!.arguments).to.deep.equal({ path: 'd.txt', text: 'hello' });
    });
  });

  // ---- parseEditorPlanResponse ----
  describe('parseEditorPlanResponse', () => {
    it('returns error for missing JSON', () => {
      const result = parseEditorPlanResponse('no json here');
      expect(result.error).to.include('missing JSON');
    });

    it('returns error for invalid JSON', () => {
      const result = parseEditorPlanResponse('{invalid}');
      expect(result.error).to.include('invalid JSON');
    });

    it('parses array of actions', () => {
      const json = JSON.stringify([
        { name: 'write_file', arguments: { path: 'a.txt', text: 'hi' } }
      ]);
      const result = parseEditorPlanResponse(json);
      expect(result.plan).to.not.be.undefined;
      expect(result.plan!.actions).to.have.lengthOf(1);
      expect(result.plan!.actions![0].name).to.equal('write_file');
    });

    it('parses object with answer and actions', () => {
      const json = JSON.stringify({
        answer: 'Done',
        actions: [{ name: 'replace_lines', arguments: { path: 'b.txt', startLine: 1, endLine: 1, text: 'x' } }]
      });
      const result = parseEditorPlanResponse(json);
      expect(result.plan).to.not.be.undefined;
      expect(result.plan!.answer).to.equal('Done');
      expect(result.plan!.actions).to.have.lengthOf(1);
    });

    it('parses notes', () => {
      const json = JSON.stringify({ answer: 'OK', notes: ['note1', 'note2'] });
      const result = parseEditorPlanResponse(json);
      expect(result.plan!.notes).to.deep.equal(['note1', 'note2']);
    });

    it('handles single tool call object', () => {
      const json = JSON.stringify({ name: 'write_file', arguments: { path: 'c.txt', text: 'content' } });
      const result = parseEditorPlanResponse(json);
      expect(result.plan!.actions).to.have.lengthOf(1);
    });

    it('recognizes alternative action keys (toolCalls, edits, calls)', () => {
      const json = JSON.stringify({ toolCalls: [{ name: 'read_file', arguments: { path: 'x.ts' } }] });
      const result = parseEditorPlanResponse(json);
      expect(result.plan!.actions).to.have.lengthOf(1);
    });

    it('returns error for non-object JSON', () => {
      const result = parseEditorPlanResponse('"just a string"');
      expect(result.error).to.include('missing JSON');
    });
  });

  // ---- getToolRequirements ----
  describe('getToolRequirements', () => {
    it('detects mutation for write/edit keywords', () => {
      expect(getToolRequirements('vytvor soubor test.ts').requireMutation).to.be.true;
      expect(getToolRequirements('uprav teto soubor').requireMutation).to.be.true;
      expect(getToolRequirements('write the code').requireMutation).to.be.true;
      expect(getToolRequirements('delete old file').requireMutation).to.be.true;
    });

    it('detects tool call for read keywords', () => {
      const result = getToolRequirements('přečti soubor main.ts');
      expect(result.requireToolCall).to.be.true;
      expect(result.requireMutation).to.be.false;
    });

    it('detects tool call for search keywords', () => {
      expect(getToolRequirements('najdi funkci handleChat').requireToolCall).to.be.true;
      expect(getToolRequirements('search for errors').requireToolCall).to.be.true;
    });

    it('returns false for simple questions', () => {
      const result = getToolRequirements('co je TypeScript?');
      expect(result.requireToolCall).to.be.false;
      expect(result.requireMutation).to.be.false;
    });

    it('mutation implies tool call', () => {
      const result = getToolRequirements('smaž soubor');
      expect(result.requireToolCall).to.be.true;
      expect(result.requireMutation).to.be.true;
    });
  });

  describe('getStepToolRequirements', () => {
    it('does not force mutation for analyze steps even when original task implied edits', () => {
      const result = getStepToolRequirements('analyze', 'Analyzovat požadavky a strukturu projektu');
      expect(result.requireToolCall).to.be.true;
      expect(result.requireMutation).to.be.false;
    });

    it('forces mutation for code steps even with neutral instruction wording', () => {
      const result = getStepToolRequirements('code', 'Navrh hlavniho souboru');
      expect(result.requireToolCall).to.be.true;
      expect(result.requireMutation).to.be.true;
    });

    it('keeps debug steps flexible based on instruction content', () => {
      const inspectOnly = getStepToolRequirements('debug', 'Zjisti proc pada validace');
      expect(inspectOnly.requireToolCall).to.be.true;
      expect(inspectOnly.requireMutation).to.be.false;

      const withFix = getStepToolRequirements('debug', 'Oprav chybu v parseru');
      expect(withFix.requireToolCall).to.be.true;
      expect(withFix.requireMutation).to.be.true;
    });
  });
});
