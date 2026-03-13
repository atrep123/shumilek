const { strict: assert } = require('assert');

const { buildObsidianChatArchive, updateObsidianArchiveIndex } = require('../src/obsidianArchive');

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
    assert.match(result.markdown, /### 2024-03-09/);
    assert.match(result.markdown, /#### user @ 2024-03-09T16:00:00.000Z/);
    assert.match(result.markdown, /#### assistant @ 2024-03-09T16:00:01.000Z/);
    assert.equal(result.stats.totalMessages, 2);
    assert.equal(result.stats.userMessages, 1);
    assert.equal(result.stats.assistantMessages, 1);
  });

  it('groups timeline entries by day', () => {
    const now = new Date('2026-03-13T10:30:45.000Z');
    const messages = [
      { role: 'user', content: 'Day one', timestamp: Date.parse('2024-03-09T16:00:00.000Z') },
      { role: 'assistant', content: 'Day one reply', timestamp: Date.parse('2024-03-09T16:05:00.000Z') },
      { role: 'user', content: 'Day two', timestamp: Date.parse('2024-03-10T08:00:00.000Z') }
    ];

    const result = buildObsidianChatArchive(messages, now);

    assert.match(result.markdown, /### 2024-03-09[\s\S]*#### user @ 2024-03-09T16:00:00.000Z[\s\S]*#### assistant @ 2024-03-09T16:05:00.000Z/);
    assert.match(result.markdown, /### 2024-03-10[\s\S]*#### user @ 2024-03-10T08:00:00.000Z/);
  });

  it('handles empty history safely', () => {
    const now = new Date('2026-03-13T10:30:45.000Z');
    const result = buildObsidianChatArchive([], now);

    assert.equal(result.stats.totalMessages, 0);
    assert.match(result.markdown, /_No chat messages to archive\._/);
  });

  it('builds archive index with newest entry first', () => {
    const now = new Date('2026-03-13T10:30:45.000Z');
    const index = updateObsidianArchiveIndex('', {
      archivePath: 'notes/shumilek/archive/a.md',
      title: 'Archive A',
      createdAt: '2026-03-13T10:30:45.000Z',
      messageCount: 12,
      projectName: 'shumilek'
    }, now);

    assert.match(index, /^# Sumilek Archive Index/m);
    assert.match(index, /## By Day/);
    assert.match(index, /- 2026-03-13: archives 1, messages 12/);
    assert.match(index, /## Archives/);
    assert.match(index, /\[Archive A\]\(notes\/shumilek\/archive\/a\.md\)/);
    assert.match(index, /messages: 12/);
    assert.match(index, /project: shumilek/);
  });

  it('deduplicates existing index entry for same archive path', () => {
    const existing = [
      '# Sumilek Archive Index',
      'Updated: 2026-03-13T00:00:00.000Z',
      '',
      '## Archives',
      '- 2026-03-13T10:00:00.000Z | [Archive A](notes/shumilek/archive/a.md) | messages: 10',
      '- 2026-03-13T09:00:00.000Z | [Archive B](notes/shumilek/archive/b.md) | messages: 8',
      ''
    ].join('\n');

    const updated = updateObsidianArchiveIndex(existing, {
      archivePath: 'notes/shumilek/archive/a.md',
      title: 'Archive A New',
      createdAt: '2026-03-13T11:00:00.000Z',
      messageCount: 14
    }, new Date('2026-03-13T11:00:00.000Z'));

    const aCount = (updated.match(/\(notes\/shumilek\/archive\/a\.md\)/g) || []).length;
    assert.equal(aCount, 1);
    assert.match(updated, /\[Archive A New\]\(notes\/shumilek\/archive\/a\.md\)/);
  });

  it('aggregates by day across multiple archive entries', () => {
    const existing = [
      '# Sumilek Archive Index',
      'Updated: 2026-03-13T00:00:00.000Z',
      '',
      '## Archives',
      '- 2026-03-12T09:00:00.000Z | [Archive B](notes/shumilek/archive/b.md) | messages: 8',
      '- 2026-03-12T10:00:00.000Z | [Archive C](notes/shumilek/archive/c.md) | messages: 7',
      ''
    ].join('\n');

    const updated = updateObsidianArchiveIndex(existing, {
      archivePath: 'notes/shumilek/archive/a.md',
      title: 'Archive A',
      createdAt: '2026-03-13T11:00:00.000Z',
      messageCount: 14
    }, new Date('2026-03-13T11:00:00.000Z'));

    assert.match(updated, /- 2026-03-13: archives 1, messages 14/);
    assert.match(updated, /- 2026-03-12: archives 2, messages 15/);
  });
});
