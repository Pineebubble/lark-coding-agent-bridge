import type { AgentEvent } from '../types';

type RecordValue = Record<string, unknown>;
const object = (v: unknown): RecordValue => v && typeof v === 'object' && !Array.isArray(v) ? v as RecordValue : {};
const number = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** Stateful because Gemini emits text deltas and a final result separately. */
export class GeminiJsonlTranslator {
  private sessionId: string | undefined;
  private text = '';
  private completed = false;
  private resultSeen = false;
  private failure: string | undefined;

  terminalEmitted(): boolean { return this.completed; }

  *translate(value: unknown): Generator<AgentEvent> {
    if (this.completed) return;
    const e = object(value);
    switch (e.type) {
      case 'init':
        if (typeof e.session_id === 'string' && e.session_id) this.sessionId = e.session_id;
        yield { type: 'system', ...(this.sessionId ? { sessionId: this.sessionId } : {}), ...(typeof e.model === 'string' ? { model: e.model } : {}) };
        break;
      case 'message':
        if (e.role === 'assistant' && typeof e.content === 'string') {
          if (e.delta === true) {
            this.text += e.content;
            yield { type: 'text', delta: e.content };
          } else {
            this.text = e.content;
            yield { type: 'final_text', content: this.text };
          }
        }
        break;
      case 'tool_use':
        if (typeof e.tool_id === 'string' && typeof e.tool_name === 'string') {
          // Text before a tool call is progress, not the final answer.
          this.text = '';
          yield { type: 'tool_use', id: e.tool_id, name: e.tool_name, input: e.parameters ?? {} };
        }
        break;
      case 'tool_result':
        if (typeof e.tool_id === 'string') {
          const error = object(e.error);
          yield { type: 'tool_result', id: e.tool_id, output: typeof e.output === 'string' ? e.output : typeof error.message === 'string' ? error.message : JSON.stringify(e.output ?? e.error ?? ''), isError: e.status === 'error' || Boolean(e.error) };
        }
        break;
      case 'error': {
        // Warnings are recoverable; defer terminal errors until process exit.
        if (e.severity !== 'warning') this.failure = typeof e.message === 'string' ? e.message : 'Gemini reported an error';
        break;
      }
      case 'result': {
        this.resultSeen = true;
        const stats = object(e.stats);
        yield { type: 'usage', inputTokens: number(stats.input_tokens), outputTokens: number(stats.output_tokens), cachedInputTokens: number(stats.cached) };
        if (e.status !== 'success') {
          const error = object(e.error);
          this.failure = typeof error.message === 'string' ? error.message : this.failure ?? 'Gemini task failed';
        }
        break;
      }
    }
  }

  *fail(message: string): Generator<AgentEvent> {
    if (this.completed) return;
    this.completed = true;
    yield { type: 'error', message, terminationReason: 'failed' };
  }

  *finish(reason: 'normal' | 'interrupted' | 'timeout' = 'normal'): Generator<AgentEvent> {
    if (this.completed) return;
    if (reason === 'normal' && (this.failure || !this.resultSeen)) {
      yield* this.fail(this.failure ?? 'Gemini exited without a result event. Check Gemini CLI login and stream-json support.');
      return;
    }
    this.completed = true;
    if (reason === 'normal' && this.text) yield { type: 'final_text', content: this.text };
    yield { type: 'done', ...(this.sessionId ? { sessionId: this.sessionId } : {}), terminationReason: reason };
  }
}
