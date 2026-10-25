import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { capabilityForProfile } from '../../../src/agent/capability';
import { ActiveRuns } from '../../../src/bot/active-runs';
import { ProcessPool } from '../../../src/bot/process-pool';
import { startRunFlow, recordRunSessionEvent } from '../../../src/bot/run-flow';
import { createDefaultProfileConfig, normalizeProfileConfig } from '../../../src/config/profile-schema';
import { RunExecutor } from '../../../src/runtime/run-executor';
import { createRuntimeAgent } from '../../../src/runtime/agent-runtime';
import { SessionCatalog } from '../../../src/session/catalog';
import { SessionStore } from '../../../src/session/store';
import { WorkspaceStore } from '../../../src/workspace/store';
import { FakeAgentAdapter } from '../../helpers/fake-agent';
import { createTmpProfile } from '../../helpers/tmp-profile';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(f => f())); });

it('normalizes Gemini profiles and selects Gemini rather than the Claude fallback', () => {
  const profile = createDefaultProfileConfig({ agentKind: 'gemini', accounts: { app: { id: 'cli_test', secret: '${APP_SECRET}', tenant: 'feishu' } }, gemini: { binaryPath: '/custom/gemini' } });
  expect(profile.permissions).toEqual({ defaultAccess: 'workspace', maxAccess: 'workspace' });
  expect(normalizeProfileConfig(JSON.parse(JSON.stringify(profile)))).toMatchObject({ agentKind: 'gemini', gemini: { binaryPath: '/custom/gemini' } });
  expect(capabilityForProfile(profile)).toMatchObject({ agentId: 'gemini', sessionKind: 'gemini-session' });
  expect(createRuntimeAgent(profile, { profileDir: '/tmp/test' }).id).toBe('gemini');
});

it('persists exact sessions and isolates chats, workspaces and permission changes', async () => {
  const tmp = await createTmpProfile('bridge-gemini-flow-');
  cleanups.push(tmp.cleanup);
  const cwd = await realpath(tmp.workspace);
  const profile = createDefaultProfileConfig({ agentKind: 'gemini', accounts: { app: { id: 'cli_test', secret: '${APP_SECRET}', tenant: 'feishu' } } });
  profile.workspaces.default = cwd;
  const sessions = new SessionStore(join(tmp.root, 'sessions.json'));
  const workspaces = new WorkspaceStore(join(tmp.root, 'workspaces.json'));
  const catalogPath = join(tmp.root, 'catalog.json');
  let catalog = new SessionCatalog(catalogPath);
  const agent = new FakeAgentAdapter({ events: [{ type: 'done', terminationReason: 'normal' }] });
  const executor = new RunExecutor({ agent, pool: new ProcessPool(() => 1), activeRuns: new ActiveRuns(), now: () => 1000 });
  const start = async (scopeId: string) => {
    const result = await startRunFlow({ scopeId, scope: { source: 'im', chatId: scopeId, actorId: 'user' }, prompt: 'hi', attachments: [], access: { ok: true, reason: 'allowed-user' }, capability: capabilityForProfile(profile), profileConfig: profile, sessions, sessionCatalog: catalog, workspaces, executor, now: 1000 });
    if (!result.ok) throw new Error(result.rejectReason.code);
    for await (const _ of result.execution.subscribe()) { /* drain */ }
    return result;
  };
  const first = await start('chat-a');
  expect(first.resumeFrom).toBeUndefined();
  recordRunSessionEvent({ scopeId: 'chat-a', sessions, sessionCatalog: catalog, capability: capabilityForProfile(profile), policy: first.policy, event: { type: 'system', sessionId: 'gemini-session-a' } });
  await catalog.flush();
  catalog = new SessionCatalog(catalogPath);
  await catalog.load();
  expect((await start('chat-a')).resumeFrom).toBe('gemini-session-a');
  expect(agent.runOptions.at(-1)).toMatchObject({ sessionId: 'gemini-session-a', cwd });
  expect((await start('chat-b')).resumeFrom).toBeUndefined();
  profile.permissions = { defaultAccess: 'read-only', maxAccess: 'read-only' };
  expect((await start('chat-a')).resumeFrom).toBeUndefined();
  profile.permissions = { defaultAccess: 'workspace', maxAccess: 'workspace' };
  catalog.archiveActive({ scopeId: 'chat-a', agentId: 'gemini', cwdRealpath: cwd, policyFingerprint: first.policy.policyFingerprint });
  expect((await start('chat-a')).resumeFrom).toBeUndefined();
  await catalog.flush();
});
