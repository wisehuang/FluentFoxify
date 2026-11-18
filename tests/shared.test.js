// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_TONE,
  DEFAULT_REASONING_EFFORT,
  TONES,
  MAX_CUSTOM_TONES,
  normalizeCustomTones,
  toneTable,
  resolveTone,
  resolveReasoningEffort,
  buildMessages,
  containsChinese,
  parseResult,
  diffWords
} = require('../shared.js');

test('resolveTone falls back to the default for unknown keys', () => {
  assert.equal(resolveTone('formal'), 'formal');
  assert.equal(resolveTone('nope'), DEFAULT_TONE);
  assert.equal(resolveTone(undefined), DEFAULT_TONE);
  assert.equal(resolveTone('toString'), DEFAULT_TONE);
});

test('resolveReasoningEffort falls back to the default for unknown values', () => {
  assert.equal(resolveReasoningEffort('high'), 'high');
  assert.equal(resolveReasoningEffort('extreme'), DEFAULT_REASONING_EFFORT);
  assert.equal(resolveReasoningEffort(undefined), DEFAULT_REASONING_EFFORT);
});

test('buildMessages puts the tone style in the system prompt and the raw text in the user turn', () => {
  const messages = buildMessages('i has a apple', 'casual');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.ok(messages[0].content.includes(TONES.casual.style));
  assert.ok(messages[0].content.includes('JSON'));
  assert.deepEqual(messages[1], { role: 'user', content: 'i has a apple' });
});

test('buildMessages tells the model to translate Chinese in the same request', () => {
  const messages = buildMessages('我明天會晚點到', 'work');
  assert.equal(messages.length, 2);
  assert.ok(messages[0].content.includes('translate it into English'));
  assert.ok(messages[0].content.includes(TONES.work.style));
  assert.deepEqual(messages[1], { role: 'user', content: '我明天會晚點到' });
});

test('containsChinese detects Chinese characters', () => {
  assert.equal(containsChinese('我明天會晚點到'), true);
  assert.equal(containsChinese('I will 遲到 tomorrow'), true);
  assert.equal(containsChinese('I will be late tomorrow.'), false);
  assert.equal(containsChinese(''), false);
  assert.equal(containsChinese(undefined), false);
});

test('parseResult reads the rewrite and note from JSON', () => {
  const out = parseResult('{"rewrite":"I have an apple.","note":" Fixed verb and article. "}');
  assert.deepEqual(out, { text: 'I have an apple.', note: 'Fixed verb and article.', meaning: '' });
});

test('parseResult handles code fences and a quoted rewrite', () => {
  const out = parseResult('```json\n{"rewrite":"\\"I have an apple.\\""}\n```');
  assert.deepEqual(out, { text: 'I have an apple.', note: '', meaning: '' });
});

test('parseResult falls back to the plain reply when it is not JSON', () => {
  assert.deepEqual(parseResult('"I have an apple."'), { text: 'I have an apple.', note: '', meaning: '' });
  assert.deepEqual(parseResult("It's fine."), { text: "It's fine.", note: '', meaning: '' });
});

test('parseResult rejects JSON without a usable rewrite', () => {
  assert.throws(() => parseResult('{"rewrite":""}'), /no rewrite/);
  assert.throws(() => parseResult('{"note":"x"}'), /no rewrite/);
});

test('parseResult rejects an empty reply', () => {
  assert.throws(() => parseResult('   '), /empty reply/);
  assert.throws(() => parseResult(undefined), /empty reply/);
});

test('diffWords flags only words that changed and keeps the text intact', () => {
  const tokens = diffWords('i has a apple today', 'I have an apple today').filter(t => !t.removed);
  assert.equal(tokens.map(t => t.text).join(''), 'I have an apple today');
  assert.deepEqual(
    tokens.filter(t => t.changed).map(t => t.text),
    ['I', 'have', 'an']
  );
});

test('diffWords never flags whitespace and handles empty input', () => {
  assert.deepEqual(diffWords('', 'Hello  there'), [
    { text: 'Hello', changed: false },
    { text: '  ', changed: false },
    { text: 'there', changed: false }
  ]);
  assert.deepEqual(diffWords('hello', ''), []);
  assert.ok(diffWords('a b', 'a\nc b').every(t => !/^\s+$/.test(t.text) || !t.changed));
});

test('diffWords interleaves words removed from the original', () => {
  const tokens = diffWords('i has a apple today', 'I have an apple today');
  assert.deepEqual(tokens.filter(t => t.removed).map(t => t.text), ['i', 'has', 'a']);
  assert.equal(tokens.findIndex(t => t.removed), 0);

  const trailing = diffWords('a b c', 'a');
  assert.deepEqual(trailing, [
    { text: 'a', changed: false },
    { text: 'b', removed: true },
    { text: 'c', removed: true }
  ]);

  const middle = diffWords('we really should go', 'we should go');
  assert.deepEqual(middle.filter(t => t.removed).map(t => t.text), ['really']);
  assert.equal(middle.filter(t => !t.removed).map(t => t.text).join(''), 'we should go');
});

test('diffWords skips the diff, and removed words, past the size limit', () => {
  const long = Array.from({ length: 600 }, (_, i) => `w${i}`).join(' ');
  const tokens = diffWords(long, `${long} extra`);
  assert.ok(tokens.every(t => !t.removed && !t.changed));
});

test('normalizeCustomTones keeps valid entries, trims them and drops the rest', () => {
  const out = normalizeCustomTones([
    { id: 'custom-a1', label: '  Slack to PM ', style: ' Short and upbeat. ' },
    { id: 'custom-a1', label: 'Duplicate', style: 'x' },
    { id: 'formal', label: 'Bad id', style: 'x' },
    { id: 'custom-b2', label: '', style: 'x' },
    { id: 'custom-c3', label: 'No style', style: '   ' },
    null,
    'nope'
  ]);
  assert.deepEqual(out, [{ id: 'custom-a1', label: 'Slack to PM', style: 'Short and upbeat.' }]);
  assert.deepEqual(normalizeCustomTones(undefined), []);
  assert.deepEqual(normalizeCustomTones({}), []);
});

test('normalizeCustomTones caps the count and the text length', () => {
  const many = Array.from({ length: MAX_CUSTOM_TONES + 3 }, (_, i) => ({
    id: `custom-${i}`, label: 'L'.repeat(100), style: 'S'.repeat(1000)
  }));
  const out = normalizeCustomTones(many);
  assert.equal(out.length, MAX_CUSTOM_TONES);
  assert.equal(out[0].label.length, 24);
  assert.equal(out[0].style.length, 300);
});

test('custom tones resolve, label and style the prompt', () => {
  const custom = [{ id: 'custom-x', label: 'Pirate', style: 'Talk like a pirate.' }];
  assert.equal(resolveTone('custom-x', custom), 'custom-x');
  assert.equal(resolveTone('custom-x'), DEFAULT_TONE);
  assert.equal(toneTable(custom)['custom-x'].label, 'Pirate');
  assert.equal(toneTable(custom).formal, TONES.formal);
  assert.ok(buildMessages('hi', 'custom-x', custom)[0].content.includes('Talk like a pirate.'));
  assert.ok(buildMessages('hi', 'custom-x')[0].content.includes(TONES[DEFAULT_TONE].style));
});

test('buildMessages asks for a Chinese meaning only for Chinese input', () => {
  assert.ok(buildMessages('我明天會晚點到', 'work')[0].content.includes('"meaning"'));
  assert.ok(!buildMessages('i has a apple', 'work')[0].content.includes('"meaning"'));
});

test('parseResult reads the meaning when present', () => {
  const out = parseResult('{"rewrite":"I will be late tomorrow.","note":"Translated.","meaning":" 我明天會晚到。 "}');
  assert.deepEqual(out, { text: 'I will be late tomorrow.', note: 'Translated.', meaning: '我明天會晚到。' });
});
