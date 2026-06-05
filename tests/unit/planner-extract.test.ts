import { describe, expect, it } from 'vitest';

import { PlannerError } from '../../src/planner/errors.js';
import { extractJson } from '../../src/planner/extract.js';

describe('extractJson', () => {
  it('parses plain JSON object', () => {
    const result = extractJson('{"a":1}');
    expect(result).toEqual({ a: 1 });
  });

  it('parses plain JSON with surrounding whitespace', () => {
    const result = extractJson('   \n {"a":1} \n  ');
    expect(result).toEqual({ a: 1 });
  });

  it('parses JSON wrapped in a json-tagged fence', () => {
    const output = '```json\n{"a":1}\n```';
    expect(extractJson(output)).toEqual({ a: 1 });
  });

  it('parses JSON wrapped in an untagged fence', () => {
    const output = '```\n{"a":1}\n```';
    expect(extractJson(output)).toEqual({ a: 1 });
  });

  it('parses JSON wrapped in a fence with surrounding prose', () => {
    const output =
      'Here is the plan:\n\n```json\n{"a":1}\n```\n\nLet me know what you think.';
    expect(extractJson(output)).toEqual({ a: 1 });
  });

  it('parses JSON preceded by prose (no fence) via brace-match', () => {
    const output = 'Here is the plan: {"a":1} that should work.';
    expect(extractJson(output)).toEqual({ a: 1 });
  });

  it('finds the outermost balanced object when multiple levels of braces exist', () => {
    const output = 'Sure: {"outer":{"inner":1},"x":2}';
    expect(extractJson(output)).toEqual({ outer: { inner: 1 }, x: 2 });
  });

  it('respects string literals containing braces', () => {
    const output = 'Output: {"text":"foo { bar } baz","n":1}';
    expect(extractJson(output)).toEqual({ text: 'foo { bar } baz', n: 1 });
  });

  it('respects escaped quotes inside string literals', () => {
    const output = 'Output: {"text":"he said \\"hi\\" and {nope}","n":1}';
    expect(extractJson(output)).toEqual({ text: 'he said "hi" and {nope}', n: 1 });
  });

  it('throws extract-failed on empty string input', () => {
    expect(() => extractJson('')).toThrow(PlannerError);
    try { extractJson(''); } catch (err) {
      expect((err as PlannerError).code).toBe('extract-failed');
      expect((err as PlannerError).details.snippet).toBe('');
    }
  });

  it('throws extract-failed when no JSON is present', () => {
    expect(() => extractJson('no json here, just words')).toThrowError(PlannerError);
    try {
      extractJson('no json here, just words');
    } catch (err) {
      expect(err).toBeInstanceOf(PlannerError);
      expect((err as PlannerError).code).toBe('extract-failed');
      expect((err as PlannerError).details.snippet).toBe('no json here, just words');
    }
  });

  it('throws extract-failed when fence content is malformed JSON', () => {
    expect(() => extractJson('```json\n{not valid json}\n```')).toThrowError(PlannerError);
  });

  it('truncates snippet to 500 chars in error details', () => {
    const long = 'x'.repeat(1000);
    try {
      extractJson(long);
    } catch (err) {
      expect((err as PlannerError).details.snippet?.length).toBe(500);
      expect((err as PlannerError).details.snippet).toMatch(/^x{500}$/);
    }
  });
});
