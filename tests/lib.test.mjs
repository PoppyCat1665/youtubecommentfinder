import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseVideoId,
  extractChannelRef,
  normalizeAuthorFilter,
  matchesComment,
  highlightParts,
  formatCount,
  formatNumber,
  formatRelativeTime,
  formatDuration,
  commentLink,
  toCsv,
} from '../lib.js';

test('parseVideoId accepts common YouTube link shapes', () => {
  assert.equal(parseVideoId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseVideoId('https://youtu.be/dQw4w9WgXcQ?si=abc123'), 'dQw4w9WgXcQ');
  assert.equal(parseVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ?start=2'), 'dQw4w9WgXcQ');
  assert.equal(parseVideoId('https://www.youtube.com/live/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseVideoId('m.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseVideoId('https://music.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseVideoId('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
});

test('parseVideoId rejects invalid or non-YouTube input', () => {
  assert.equal(parseVideoId(''), null);
  assert.equal(parseVideoId('   '), null);
  assert.equal(parseVideoId('too-short'), null);
  assert.equal(parseVideoId('https://www.youtube.com/watch?v=short'), null);
  assert.equal(parseVideoId('https://vimeo.com/123456789'), null);
  assert.equal(parseVideoId('https://www.youtube.com/@somechannel'), null);
  assert.equal(parseVideoId(null), null);
});

test('extractChannelRef understands handles, URLs and names', () => {
  assert.deepEqual(extractChannelRef('@MrBeast'), { type: 'handle', value: '@MrBeast' });
  assert.deepEqual(extractChannelRef('https://www.youtube.com/@MrBeast/videos'), {
    type: 'handle',
    value: '@MrBeast',
  });
  assert.deepEqual(
    extractChannelRef('https://www.youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA'),
    { type: 'id', value: 'UCX6OQ3DkcsbYNE6H8uQQuVA' },
  );
  assert.deepEqual(extractChannelRef('https://www.youtube.com/user/MrBeast6000'), {
    type: 'username',
    value: 'MrBeast6000',
  });
  assert.deepEqual(extractChannelRef('https://www.youtube.com/c/MrBeast6000'), {
    type: 'search',
    value: 'MrBeast6000',
  });
  assert.deepEqual(extractChannelRef('MrBeast'), { type: 'search', value: 'MrBeast' });
  assert.equal(extractChannelRef(''), null);
});

test('author filters ignore a leading @', () => {
  assert.equal(normalizeAuthorFilter('  @@SomeUser '), 'SomeUser');
  assert.equal(normalizeAuthorFilter(null), '');
});

test('matchesComment intersects phrase and author filters', () => {
  const comment = {
    text: 'This video made my whole day, honestly.',
    author: 'CoolCat @coolcat https://youtube.com/@coolcat',
  };

  assert.equal(matchesComment(comment, { phrase: 'whole day' }), true);
  assert.equal(matchesComment(comment, { phrase: 'WHOLE DAY' }), true);
  assert.equal(matchesComment(comment, { phrase: 'WHOLE DAY', matchCase: true }), false);
  assert.equal(matchesComment(comment, { author: '@coolcat' }), true);
  assert.equal(matchesComment(comment, { author: 'coolcat', phrase: 'made' }), true);
  assert.equal(matchesComment(comment, { author: 'someone-else' }), false);
  assert.equal(matchesComment(comment, { phrase: 'not there' }), false);
  assert.equal(matchesComment(comment, {}), true);
});

test('highlightParts finds every occurrence without losing text', () => {
  const parts = highlightParts('Hello WORLD, world!', 'world');
  assert.deepEqual(parts, [
    { text: 'Hello ', match: false },
    { text: 'WORLD', match: true },
    { text: ', ', match: false },
    { text: 'world', match: true },
    { text: '!', match: false },
  ]);
  assert.equal(parts.map((part) => part.text).join(''), 'Hello WORLD, world!');

  assert.deepEqual(highlightParts('No match here', 'world'), [
    { text: 'No match here', match: false },
  ]);
  assert.deepEqual(highlightParts('Anything', ''), [{ text: 'Anything', match: false }]);

  const caseSensitive = highlightParts('world WORLD', 'world', true);
  assert.deepEqual(caseSensitive, [
    { text: 'world', match: true },
    { text: ' WORLD', match: false },
  ]);
});

test('number, duration and date formatting', () => {
  assert.equal(formatCount(0), '0');
  assert.equal(formatCount(999), '999');
  assert.equal(formatCount(1200), '1.2K');
  assert.equal(formatNumber(1234567), '1,234,567');
  assert.equal(formatDuration('PT3M33S'), '3:33');
  assert.equal(formatDuration('PT1H2M3S'), '1:02:03');
  assert.equal(formatDuration('P1DT2H'), '26:00:00');
  assert.equal(formatDuration('nope'), '');
  assert.equal(formatRelativeTime('not-a-date'), '');
  assert.match(formatRelativeTime('2020-01-01T00:00:00Z', Date.parse('2020-01-02T00:00:00Z')), /yesterday/);
});

test('commentLink builds a deep link with lc parameter', () => {
  assert.equal(
    commentLink('dQw4w9WgXcQ', 'UgxKREWc0Z1'),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&lc=UgxKREWc0Z1',
  );
  assert.equal(commentLink('dQw4w9WgXcQ', ''), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(commentLink('', 'abc'), '');
});

test('toCsv quotes commas, quotes and newlines', () => {
  const csv = toCsv([
    ['Name', 'Comment'],
    ['Rick', 'Never gonna give you up, never gonna let you down'],
    ['Quote"Guy', 'Line one\nLine two'],
  ]);
  assert.equal(
    csv,
    'Name,Comment\r\nRick,"Never gonna give you up, never gonna let you down"\r\n"Quote""Guy","Line one\nLine two"',
  );
});
