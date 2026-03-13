const { strict: assert } = require('assert');

const { buildObsidianChatArchive } = require('../src/obsidianArchive');

describe('obsidianArchive', () => {
  it('builds archive markdown with frontmatter, summary and timeline', () => {
    const now = new Date('2026-03-13T10:30:45.000Z');
    const messages = [
      { role: 'user', content: 'Please summarize this session', timestamp: 1710000000000 },
      { role: 'assistant', content: 'Summary ready', timestamp: 1710000001000 }
    ];

    const result = buildObsidianChatArchive(messages, { projectName: 'shumilek-test' }, now);

    assert.match(result.fileName, /^shumilek-history-2026-03-13-10-30-45-/);
    assert.match(result.markdown, /^---[\s\S]*type: shumilek-chat-archive/m);
    assert.match(result.markdown, /title: "Sumilek Chat Archive 2026-03-13"/);
    assert.match(result.markdown, /slug: please-summarize-this-session/);
    assert.match(result.markdown, /project: "shumilek-test"/);
    assert.match(result.markdown, /user_messages: 1/);
    assert.match(result.markdown, /assistant_messages: 1/);
    assert.match(result.markdown, /first_message_at: "2024-03-09T16:00:00.000Z"/);
    assert.match(result.markdown, /last_message_at: "2024-03-09T16:00:01.000Z"/);
    assert.match(result.markdown, /## Summary/);
    assert.match(result.markdown, /- Project: shumilek-test/);
    assert.match(result.markdown, /## Timeline/);
    assert.match(result.markdown, /### user @ 2024-03-09T16:00:00.000Z/);
    assert.match(result.markdown, /### assistant @ 2024-03-09T16:00:01.000Z/);
    assert.equal(result.stats.totalMessages, 2);
    assert.equal(result.stats.userMessages, 1);
    assert.equal(result.stats.assistantMessages, 1);
  });

  it('handles empty history safely', () => {
    const now = new Date('2026-03-13T10:30:45.000Z');
    const result = buildObsidianChatArchive([], now);

    assert.equal(result.stats.totalMessages, 0);
    assert.match(result.markdown, /_No chat messages to archive\._/);
  });
});
