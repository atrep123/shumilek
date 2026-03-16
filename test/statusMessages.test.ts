import { expect } from 'chai';
import { PIPELINE_STATUS_ICONS, PIPELINE_STATUS_TEXT } from '../src/statusMessages';

describe('statusMessages', () => {

  describe('PIPELINE_STATUS_ICONS', () => {
    it('has all expected keys', () => {
      const expected = ['chat', 'history', 'svedomi', 'tools', 'editor'];
      for (const key of expected) {
        expect(PIPELINE_STATUS_ICONS).to.have.property(key);
      }
    });

    it('all values are non-empty strings', () => {
      for (const [key, value] of Object.entries(PIPELINE_STATUS_ICONS)) {
        expect(value, `icon for ${key}`).to.be.a('string').and.not.be.empty;
      }
    });

    it('has exactly 5 icon entries', () => {
      expect(Object.keys(PIPELINE_STATUS_ICONS)).to.have.lengthOf(5);
    });
  });

  describe('PIPELINE_STATUS_TEXT', () => {
    it('has all expected keys', () => {
      const expected = [
        'generatingResponse',
        'checkingHistory',
        'svedomiValidation',
        'toolsActive',
        'editorApplying'
      ];
      for (const key of expected) {
        expect(PIPELINE_STATUS_TEXT).to.have.property(key);
      }
    });

    it('all values are non-empty strings', () => {
      for (const [key, value] of Object.entries(PIPELINE_STATUS_TEXT)) {
        expect(value, `text for ${key}`).to.be.a('string').and.not.be.empty;
      }
    });

    it('has exactly 5 text entries', () => {
      expect(Object.keys(PIPELINE_STATUS_TEXT)).to.have.lengthOf(5);
    });
  });
});
