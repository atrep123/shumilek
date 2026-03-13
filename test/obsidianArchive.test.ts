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

  it('summary section reflects overall stats', () => {
    const existing = [
      '# Sumilek Archive Index',
      'Updated: 2026-03-12T00:00:00.000Z',
      '',
      '## Archives',
      '- 2026-03-11T08:00:00.000Z | [Archive X](notes/shumilek/archive/x.md) | messages: 5 | project: proj-a',
      '- 2026-03-12T09:00:00.000Z | [Archive Y](notes/shumilek/archive/y.md) | messages: 9 | project: proj-b',
      ''
    ].join('\n');

    const updated = updateObsidianArchiveIndex(existing, {
      archivePath: 'notes/shumilek/archive/z.md',
      title: 'Archive Z',
      createdAt: '2026-03-13T11:00:00.000Z',
      messageCount: 6,
      projectName: 'proj-a'
    }, new Date('2026-03-13T11:00:00.000Z'));

    assert.match(updated, /## Summary/);
    assert.match(updated, /- Total archives: 3/);
    assert.match(updated, /- Total messages: 20/);
    assert.match(updated, /- Average messages per archive: 7/);
    assert.match(updated, /- Archives this week: 3/);
    assert.match(updated, /- Most active day: 2026-03-12 \(9 messages\)/);
    assert.match(updated, /- First archive: 2026-03-11T08:00:00\.000Z/);
    assert.match(updated, /- Last archive: 2026-03-13T11:00:00\.000Z/);
    assert.match(updated, /- Active projects: 2/);
    assert.match(updated, /- Most active project: proj-a \(11 messages\)/);
    const summaryIdx = updated.indexOf('## Summary');
    const byDayIdx = updated.indexOf('## By Day');
    assert.ok(summaryIdx < byDayIdx, '## Summary should appear before ## By Day');
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
    assert.match(index, /## Summary/);
    assert.match(index, /- Total archives: 1/);
    assert.match(index, /- Total messages: 12/);
    assert.match(index, /- Average messages per archive: 12/);
    assert.match(index, /- Archives this week: 1/);
    assert.match(index, /- Most active day: 2026-03-13 \(12 messages\)/);
    assert.match(index, /- First archive: 2026-03-13T10:30:45\.000Z/);
    assert.match(index, /- Last archive: 2026-03-13T10:30:45\.000Z/);
    assert.match(index, /- Active projects: 1/);
    assert.match(index, /- Most active project: shumilek \(12 messages\)/);
    assert.match(index, /## By Day/);
    assert.match(index, /- 2026-03-13: archives 1, messages 12/);
    assert.match(index, /## Projects/);
    assert.match(index, /- shumilek: archives 1, messages 12/);
    assert.match(index, /## Top Archives/);
    assert.match(index, /1\. \[Archive A\]\(notes\/shumilek\/archive\/a\.md\) - 12 messages/);
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

    const archivesSection = (updated.match(/## Archives[\s\S]*$/) || [''])[0];
    const aCountInArchives = (archivesSection.match(/\(notes\/shumilek\/archive\/a\.md\)/g) || []).length;
    assert.equal(aCountInArchives, 1);
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
    assert.match(updated, /1\. \[Archive A\]\(notes\/shumilek\/archive\/a\.md\) - 14 messages/);
    assert.match(updated, /2\. \[Archive B\]\(notes\/shumilek\/archive\/b\.md\) - 8 messages/);
    assert.match(updated, /3\. \[Archive C\]\(notes\/shumilek\/archive\/c\.md\) - 7 messages/);
  });

  it('groups archives by project', () => {
    const existing = [
      '# Sumilek Archive Index',
      'Updated: 2026-03-13T00:00:00.000Z',
      '',
      '## Archives',
      '- 2026-03-12T09:00:00.000Z | [Archive B](notes/shumilek/archive/b.md) | messages: 8 | project: alpha',
      '- 2026-03-12T10:00:00.000Z | [Archive C](notes/shumilek/archive/c.md) | messages: 7 | project: alpha',
      '- 2026-03-12T11:00:00.000Z | [Archive D](notes/shumilek/archive/d.md) | messages: 5 | project: beta',
      ''
    ].join('\n');

    const updated = updateObsidianArchiveIndex(existing, {
      archivePath: 'notes/shumilek/archive/a.md',
      title: 'Archive A',
      createdAt: '2026-03-13T11:00:00.000Z',
      messageCount: 14,
      projectName: 'alpha'
    }, new Date('2026-03-13T11:00:00.000Z'));

    assert.match(updated, /## Projects/);
    assert.match(updated, /- alpha: archives 3, messages 29/);
    assert.match(updated, /- beta: archives 1, messages 5/);
    const projectsSection = updated.split('## Projects')[1].split('##')[0];
    const alphaIndex = projectsSection.indexOf('alpha');
    const betaIndex = projectsSection.indexOf('beta');
    assert.ok(alphaIndex < betaIndex, 'alpha (29 messages) should come before beta (5 messages)');
  });

  it('limits top archives section to five items', () => {
    const existing = [
      '# Sumilek Archive Index',
      'Updated: 2026-03-13T00:00:00.000Z',
      '',
      '## Archives',
      '- 2026-03-12T09:00:00.000Z | [A1](notes/shumilek/archive/a1.md) | messages: 1',
      '- 2026-03-12T09:10:00.000Z | [A2](notes/shumilek/archive/a2.md) | messages: 2',
      '- 2026-03-12T09:20:00.000Z | [A3](notes/shumilek/archive/a3.md) | messages: 3',
      '- 2026-03-12T09:30:00.000Z | [A4](notes/shumilek/archive/a4.md) | messages: 4',
      '- 2026-03-12T09:40:00.000Z | [A5](notes/shumilek/archive/a5.md) | messages: 5',
      ''
    ].join('\n');

    const updated = updateObsidianArchiveIndex(existing, {
      archivePath: 'notes/shumilek/archive/a6.md',
      title: 'A6',
      createdAt: '2026-03-13T11:00:00.000Z',
      messageCount: 6
    }, new Date('2026-03-13T11:00:00.000Z'));

    assert.match(updated, /1\. \[A6\]\(notes\/shumilek\/archive\/a6\.md\) - 6 messages/);
    assert.match(updated, /5\. \[A2\]\(notes\/shumilek\/archive\/a2\.md\) - 2 messages/);
    const topCount = (updated.match(/^\d+\. \[/gm) || []).length;
    assert.equal(topCount, 5);
  });

  it('uses n/a for most active project when no project tags exist', () => {
    const updated = updateObsidianArchiveIndex('', {
      archivePath: 'notes/shumilek/archive/a.md',
      title: 'Archive A',
      createdAt: '2026-03-13T10:30:45.000Z',
      messageCount: 12
    }, new Date('2026-03-13T10:30:45.000Z'));

    assert.match(updated, /- Active projects: 0/);
    assert.match(updated, /- Most active project: n\/a/);
  });

  it('ignores malformed index lines in aggregate stats', () => {
    const existing = [
      '# Sumilek Archive Index',
      'Updated: 2026-03-13T00:00:00.000Z',
      '',
      '## Archives',
      '- 2026-03-12T09:00:00.000Z | [Broken](notes/shumilek/archive/broken.md) | message_count: 8 | project: alpha',
      '- 2026-03-12T10:00:00.000Z | [Valid](notes/shumilek/archive/valid.md) | messages: 7 | project: beta',
      ''
    ].join('\n');

    const updated = updateObsidianArchiveIndex(existing, {
      archivePath: 'notes/shumilek/archive/new.md',
      title: 'New',
      createdAt: '2026-03-13T11:00:00.000Z',
      messageCount: 3,
      projectName: 'beta'
    }, new Date('2026-03-13T11:00:00.000Z'));

    assert.match(updated, /- Total archives: 2/);
    assert.match(updated, /- Total messages: 10/);
    assert.match(updated, /- Active projects: 1/);
    assert.match(updated, /- Most active project: beta \(10 messages\)/);
    assert.match(updated, /\[Broken\]\(notes\/shumilek\/archive\/broken\.md\)/);
  });

  it('uses unknown-day bucket for non-ISO createdAt values', () => {
    const existing = [
      '# Sumilek Archive Index',
      'Updated: 2026-03-13T00:00:00.000Z',
      '',
      '## Archives',
      '- yesterday | [Legacy](notes/shumilek/archive/legacy.md) | messages: 4',
      ''
    ].join('\n');

    const updated = updateObsidianArchiveIndex(existing, {
      archivePath: 'notes/shumilek/archive/new.md',
      title: 'New',
      createdAt: '2026-03-13T11:00:00.000Z',
      messageCount: 6
    }, new Date('2026-03-13T11:00:00.000Z'));

    assert.match(updated, /- unknown-day: archives 1, messages 4/);
    assert.match(updated, /- 2026-03-13: archives 1, messages 6/);
    assert.match(updated, /- Most active day: 2026-03-13 \(6 messages\)/);
  });

  it('counts archives exactly on 7-day boundary as this week', () => {
    const existing = [
      '# Sumilek Archive Index',
      'Updated: 2026-03-13T00:00:00.000Z',
      '',
      '## Archives',
      '- 2026-03-06T11:00:00.000Z | [Edge](notes/shumilek/archive/edge.md) | messages: 2',
      '- 2026-03-06T10:59:59.999Z | [Old](notes/shumilek/archive/old.md) | messages: 9',
      ''
    ].join('\n');

    const updated = updateObsidianArchiveIndex(existing, {
      archivePath: 'notes/shumilek/archive/new.md',
      title: 'New',
      createdAt: '2026-03-13T11:00:00.000Z',
      messageCount: 1
    }, new Date('2026-03-13T11:00:00.000Z'));

    assert.match(updated, /- Archives this week: 2/);
  });
});
