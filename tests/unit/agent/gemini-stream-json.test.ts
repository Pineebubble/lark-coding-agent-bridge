import { describe, expect, it } from 'vitest';
import { GeminiJsonlTranslator } from '../../../src/agent/gemini/stream-json';
import { buildGeminiArgs } from '../../../src/agent/gemini/argv';

it('maps streamed text, tool calls, usage and session identity with one terminal event', () => {
  const t = new GeminiJsonlTranslator();
  expect([...t.translate({ type: 'init', session_id: 'session-a', model: 'auto' })]).toEqual([{ type: 'system', sessionId: 'session-a', model: 'auto' }]);
  expect([...t.translate({ type: 'message', role: 'user', content: 'ignore' })]).toEqual([]);
  t.translate({});
  expect([...t.translate({ type: 'message', role: 'assistant', content: 'Working', delta: true })]).toEqual([{ type: 'text', delta: 'Working' }]);
  expect([...t.translate({ type: 'tool_use', tool_id: 'tool-1', tool_name: 'read_file', parameters: { path: 'README.md' } })]).toEqual([{ type: 'tool_use', id: 'tool-1', name: 'read_file', input: { path: 'README.md' } }]);
  expect([...t.translate({ type: 'tool_result', tool_id: 'tool-1', status: 'success', output: 'hello' })]).toEqual([{ type: 'tool_result', id: 'tool-1', output: 'hello', isError: false }]);
  [...t.translate({ type: 'message', role: 'assistant', content: 'Hello ', delta: true })];
  [...t.translate({ type: 'message', role: 'assistant', content: 'world', delta: true })];
  expect([...t.translate({ type: 'result', status: 'success', stats: { input_tokens: 20, output_tokens: 4, cached: 2 } })]).toEqual([{ type: 'usage', inputTokens: 20, outputTokens: 4, cachedInputTokens: 2 }]);
  expect([...t.finish()]).toEqual([{ type: 'final_text', content: 'Hello world' }, { type: 'done', sessionId: 'session-a', terminationReason: 'normal' }]);
  expect([...t.finish()]).toEqual([]);
});

it('does not turn warnings into failures, but fails on errors and truncated streams', () => {
  const t = new GeminiJsonlTranslator();
  [...t.translate({ type: 'error', severity: 'warning', message: 'retrying' })];
  [...t.translate({ type: 'result', status: 'success' })];
  expect([...t.finish()]).toContainEqual({ type: 'done', terminationReason: 'normal' });
  const failed = new GeminiJsonlTranslator();
  [...failed.translate({ type: 'result', status: 'error', error: { message: 'Sign in first' } })];
  expect([...failed.finish()]).toEqual([{ type: 'error', message: 'Sign in first', terminationReason: 'failed' }]);
  expect([...new GeminiJsonlTranslator().finish()]).toMatchObject([{ type: 'error', terminationReason: 'failed' }]);
});

it('reports interruption without a fabricated final answer', () => {
  const t = new GeminiJsonlTranslator();
  [...t.translate({ type: 'message', role: 'assistant', content: 'partial', delta: true })];
  expect([...t.finish('interrupted')]).toEqual([{ type: 'done', terminationReason: 'interrupted' }]);
});

describe('Gemini argv', () => {
  it.each([['read-only', 'plan'], ['workspace-write', 'auto_edit'], ['danger-full-access', 'yolo']] as const)('maps %s to %s explicitly', (sandbox, approval) => {
    const args = buildGeminiArgs({ runId: '1', prompt: '<unsafe>$() &', sandbox, sessionId: 'session-id', model: 'auto' });
    expect(args).toContain(approval);
    expect(args).toContain('session-id');
    expect(args).toContain('auto');
    expect(args).not.toContain('<unsafe>$() &');
  });
  it('defaults to auto_edit and does not resume the latest session', () => {
    const args = buildGeminiArgs({ runId: '1', prompt: 'hello' });
    expect(args).toContain('auto_edit');
    expect(args).not.toContain('--resume');
  });
});
