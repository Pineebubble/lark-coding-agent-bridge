import type { AgentRunOptions } from '../types';

/** Prompts go through stdin, never shell-interpreted argv (including Windows shims). */
export function buildGeminiArgs(opts: AgentRunOptions): string[] {
  const access = opts.sandbox ?? 'workspace-write';
  const approval = access === 'read-only' ? 'plan' : access === 'danger-full-access' ? 'yolo' : 'auto_edit';
  const args = ['--prompt', 'Follow the task provided on stdin.', '--output-format', 'stream-json', '--approval-mode', approval];
  if (opts.sessionId) args.push('--resume', opts.sessionId);
  if (opts.model) args.push('--model', opts.model);
  return args;
}
