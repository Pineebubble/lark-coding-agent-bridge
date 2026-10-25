# Gemini CLI in Feishu / Lark

This fork adds `--agent gemini` to the bridge. Gemini runs on your computer;
Feishu is the conversation interface. The Gemini CLI must already be installed
and authenticated as the OS user who runs the bridge.

## Set up

Use a Node.js version supported by both the bridge and your installed Gemini CLI.
Install Gemini from Google's official npm package and complete login interactively:

```sh
npm install -g @google/gemini-cli
gemini
```

Before starting the bridge, verify that non-interactive mode works in your project:

```sh
cd /absolute/path/to/your/project
gemini -p "Describe this project without making changes" --output-format stream-json --approval-mode plan
```

If authentication is missing, finish it in the terminal. The bridge does not
complete Google sign-in for you. OAuth, API key and Vertex AI authentication
follow Gemini CLI's own configuration; do not put secrets in chat or this repo.

Build and run **this checkout**, rather than the upstream npm package:

```sh
npm install -g pnpm@10.33.0
pnpm install --frozen-lockfile
pnpm build
node bin/lark-channel-bridge.mjs run --profile gemini --agent gemini --workspace /absolute/path/to/your/project
```

Follow the QR wizard to bind a dedicated Feishu / Lark PersonalAgent application.
Do not share one application's live connection between two bridge profiles.
If an app already exists, append `--app-id cli_xxx`; the wizard prompts for its secret.
For international Lark, append `--tenant lark`.

If `gemini` is not on PATH, set `LARK_CHANNEL_GEMINI_BIN` to its executable path
before creating the profile. The resolved path is persisted as
`profiles.gemini.gemini.binaryPath` in the bridge config. The profile name is
arbitrary; the inner `gemini` field identifies the agent configuration.

In Feishu, DM the bot or @ it in a group. Try:

1. "Describe this project."
2. "Which entry file did you just mention?" (checks conversation continuity).
3. "Create a file named bridge-test.txt containing hello." (checks file editing).
4. `/status`, `/new`, `/cd /another/project`, and `/stop`.

After successful foreground testing, Ctrl-C and run the built checkout in the
background from this permanent directory:

```sh
node bin/lark-channel-bridge.mjs start --profile gemini
node bin/lark-channel-bridge.mjs status --profile gemini
node bin/lark-channel-bridge.mjs stop --profile gemini
```

Keep the computer awake, online, and this checkout in place. A background service
may have a different PATH / proxy / environment from your terminal; check its logs
and use the persisted executable path. Authentication must be available to that
same OS user in non-interactive mode.

## Permissions and limitations

New Gemini profiles default to `workspace` for both `defaultAccess` and
`maxAccess`. The adapter maps the bridge policy to Gemini's approval modes:

| Bridge access | Gemini mode | Behavior |
| --- | --- | --- |
| `read-only` | `plan` | Gemini's read-only planning mode |
| `workspace` | `auto_edit` | Auto-approves edit tools; other tools follow Gemini policy |
| `full` | `yolo` | Auto-approves tools, including shell commands |

The working directory and `auto_edit` are **not an OS filesystem sandbox**.
Gemini's local settings, policies, trusted folders, MCP servers, and extensions
still apply. Interactive tool confirmation is not forwarded to Feishu in this
version. A tool requiring confirmation in headless mode can be denied; handle
it in the local CLI or configure narrowly scoped Gemini policies locally.
The bridge never automatically retries a denied operation in `yolo` mode.

Full access is available only through an explicit profile policy change; it is
not the Gemini default. Review the implications before changing both limits to
`full`. Existing Claude / Codex permission defaults are unchanged.

Each chat/topic gets a catalog entry containing its exact Gemini session UUID,
workspace and policy fingerprint. The adapter resumes that UUID, never the
latest local session. `/new` archives the current binding; changing directory
or permissions starts a compatible new session. `/resume` lists bridge-recorded
Gemini sessions for the current chat, workspace and policy; it does not scan
unrelated native Gemini CLI history.

Text and tool activity stream into the existing Feishu renderer. Attachments
use the bridge's downloaded-file context; they are not sent as a separate native
Gemini multimodal payload. Model selection currently follows the local Gemini
CLI default. Native Gemini history browsing and Feishu approval buttons are
not implemented.

## Verification

```sh
pnpm test
pnpm typecheck
pnpm build
```

The tests include a fake Gemini executable, so streaming, exact resume, safe
stdin transport, interruption, errors and session isolation can be checked
without Google credentials. They do not replace a live Feishu / Gemini login test.

## Official references

- https://geminicli.com/docs/get-started/installation/
- https://geminicli.com/docs/get-started/authentication/
- https://geminicli.com/docs/cli/headless/
- https://geminicli.com/docs/cli/session-management/
- https://geminicli.com/docs/reference/configuration/
