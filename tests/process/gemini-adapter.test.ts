import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { GeminiAdapter } from '../../src/agent/gemini/adapter';
import type { AgentEvent } from '../../src/agent/types';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function fake(body: string) {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-gemini-'));
  dirs.push(dir);
  const script = join(dir, 'fake.cjs');
  const binary = join(dir, process.platform === 'win32' ? 'gemini.cmd' : 'gemini');
  const record = join(dir, 'record.json');
  await writeFile(script, `const fs = require('node:fs');
if (process.argv.includes('--version')) { console.log('1.0.0'); process.exit(0); }
let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', s => input += s);
process.stdin.on('end', () => {
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: process.argv.slice(2), input, cwd: process.cwd(), profile: process.env.LARK_CHANNEL_PROFILE }));
const emit = x => console.log(JSON.stringify(x));
${body}
});`);
  await writeFile(binary, process.platform === 'win32' ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n` : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
  await chmod(binary, 0o755);
  return { dir, binary, record };
}
async function collect(events: AsyncIterable<AgentEvent>) { const result: AgentEvent[] = []; for await (const e of events) result.push(e); return result; }

it('sends prompts on stdin, resumes the exact session, and preserves the active profile', async () => {
  const f = await fake(`emit({type:'init',session_id:'session-a'}); emit({type:'message',role:'assistant',content:'Done',delta:true}); emit({type:'result',status:'success'});`);
  const adapter = new GeminiAdapter({ binary: f.binary, larkChannel: { profile: 'gemini-test', rootDir: f.dir } });
  expect(await adapter.isAvailable()).toBe(true);
  const run = adapter.run({ runId: 'r', cwd: f.dir, prompt: '<task> "hello" & $(test)', sessionId: 'session-a' });
  const events = await collect(run.events);
  expect(events).toContainEqual({ type: 'done', sessionId: 'session-a', terminationReason: 'normal' });
  expect(await run.waitForExit(1000)).toBe(true);
  const record = JSON.parse(await readFile(f.record, 'utf8'));
  expect(record.argv).toContain('session-a');
  expect(record.argv).toContain('auto_edit');
  expect(record.argv.join(' ')).not.toContain('<task>');
  expect(record.input).toContain('<task> "hello" & $(test)');
  expect(record.input).toContain('__bridge_cb');
  expect(record.profile).toBe('gemini-test');
});

it('does not accept a successful result followed by a nonzero process exit', async () => {
  const f = await fake(`emit({type:'result',status:'success'}); process.stderr.write('auth failed'); process.exitCode = 1;`);
  const events = await collect(new GeminiAdapter({ binary: f.binary }).run({ runId: 'r', cwd: f.dir, prompt: 'hello' }).events);
  expect(events.filter(e => e.type === 'error')).toHaveLength(1);
  expect(events.some(e => e.type === 'done')).toBe(false);
});

it('reports malformed or truncated output and spawn failures without hanging', async () => {
  const f = await fake(`console.log('not json'); emit({type:'init',session_id:'partial'});`);
  const events = await collect(new GeminiAdapter({ binary: f.binary }).run({ runId: 'r', cwd: f.dir, prompt: 'hello' }).events);
  expect(events).toContainEqual(expect.objectContaining({ type: 'error', terminationReason: 'failed' }));
  const missing = await collect(new GeminiAdapter({ binary: join(f.dir, 'missing') }).run({ runId: 'r', cwd: f.dir, prompt: 'hello' }).events);
  expect(missing).toMatchObject([{ type: 'error', terminationReason: 'failed' }]);
});

it('stops an active run and emits one interrupted terminal event', async () => {
  const f = await fake(`emit({type:'init',session_id:'slow'}); setInterval(() => {}, 100);`);
  const run = new GeminiAdapter({ binary: f.binary, stopGraceMs: 50 }).run({ runId: 'r', cwd: f.dir, prompt: 'hello' });
  const events: AgentEvent[] = [];
  for await (const event of run.events) {
    events.push(event);
    if (event.type === 'system') await run.stop();
  }
  expect(events.filter(e => e.type === 'done')).toEqual([{ type: 'done', sessionId: 'slow', terminationReason: 'interrupted' }]);
  expect(await run.waitForExit(100)).toBe(true);
});
