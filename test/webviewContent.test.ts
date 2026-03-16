const mock = require('mock-require');
const { vscodeMock } = require('./helpers/vscodeMockShared');
mock('vscode', vscodeMock);

import { expect } from 'chai';
import { getMinimalWebviewContent, getWebviewContent } from '../src/webviewContent';

describe('webviewContent', () => {
  // ======================================
  // getMinimalWebviewContent
  // ======================================
  describe('getMinimalWebviewContent', () => {
    it('should return valid HTML string', () => {
      const html = getMinimalWebviewContent({} as any);
      expect(html).to.be.a('string');
      expect(html).to.include('<!DOCTYPE html>');
      expect(html).to.include('</html>');
    });

    it('should include CSP with nonce', () => {
      const html = getMinimalWebviewContent({} as any);
      expect(html).to.include('Content-Security-Policy');
      expect(html).to.match(/script-src 'nonce-[a-zA-Z0-9_-]+'/); // base64url chars
    });

    it('should include chat UI elements', () => {
      const html = getMinimalWebviewContent({} as any);
      expect(html).to.include('id="chat"');
      expect(html).to.include('id="prompt"');
      expect(html).to.include('id="send-btn"');
    });

    it('should include guardian button', () => {
      const html = getMinimalWebviewContent({} as any);
      expect(html).to.include('id="guardian-btn"');
    });

    it('should include script tag with nonce', () => {
      const html = getMinimalWebviewContent({} as any);
      // CSP uses nonce-XXX pattern
      const cspMatch = html.match(/nonce-([a-zA-Z0-9_-]+)/);
      expect(cspMatch).to.exist;
      // Script tag uses nonce="XXX" pattern
      const scriptMatch = html.match(/nonce="([a-zA-Z0-9_-]+)"/);
      expect(scriptMatch).to.exist;
      expect(cspMatch![1]).to.equal(scriptMatch![1]);
    });
  });

  // ======================================
  // getWebviewContent
  // ======================================
  describe('getWebviewContent', () => {
    it('should return valid HTML string with no initial messages', () => {
      const html = getWebviewContent({} as any, []);
      expect(html).to.be.a('string');
      expect(html).to.include('<!DOCTYPE html>');
      expect(html).to.include('</html>');
    });

    it('should include CSP with nonce', () => {
      const html = getWebviewContent({} as any, []);
      expect(html).to.include('Content-Security-Policy');
      expect(html).to.match(/script-src 'nonce-[a-zA-Z0-9_-]+'/);
    });

    it('should initialize empty messages array in script', () => {
      const html = getWebviewContent({} as any, []);
      expect(html).to.include('var messages = [];');
    });

    it('should include chat container and input area', () => {
      const html = getWebviewContent({} as any, []);
      expect(html).to.include('id="chat"');
      expect(html).to.include('id="prompt"');
    });

    it('should include guardian alert element', () => {
      const html = getWebviewContent({} as any, []);
      expect(html).to.include('guardian-alert');
    });

    it('should include undo snackbar', () => {
      const html = getWebviewContent({} as any, []);
      expect(html).to.include('undo-snackbar');
    });

    it('should include pipeline CSS classes', () => {
      const html = getWebviewContent({} as any, []);
      expect(html).to.include('.message.pipeline');
    });
  });
});
