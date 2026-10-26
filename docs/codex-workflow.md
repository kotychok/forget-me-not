# Codex workflow

Checked against official OpenAI documentation on 2026-10-26.

## Current setup

The root `AGENTS.md` contains concise, durable agreements: repository content in English, chat in Ukrainian, current phase boundaries, documentation navigation, and the rule that the user makes commits. Product details live in `docs/` so instructions do not duplicate the specification.

No custom skills, hooks, or MCP servers have been added: the current scope does not need them. Model selection, global settings, project trust, and access policies have not been changed. Existing environment security settings remain in effect; AGENTS.md guides the agent but is not a technical block on Git commands.

## Configuration

A separate `.codex/config.toml` is not needed yet: there are no project-specific settings that need overriding. It can be added later if needed; project configuration applies only to trusted projects and remains subject to enforced policy. Do not automatically enable full access or project trust as part of documentation setup.

## Working cycle

For documentation tasks, update the relevant files and check links and decision consistency. For complex implementation, maintain a short plan in `docs/plans/` with scope, open questions, and actual verification; do not create a separate plan for every small edit.

Expose run, build, and check commands through Makefile, supporting native execution without Docker. Frontend/backend targets and native migrations are implemented in the root Makefile and documented in the root README; Docker targets remain planned.

Actual formatting, typecheck, Clippy, and test commands are listed in AGENTS.md. Browser tests use a separate temporary database and independent ports. Priority checks: tree invariants, commands and undo, format round-trips, revision conflicts, and draft recovery. Browser tests cover focus, cursor position, and keyboard interaction. Distinguish checks actually run from planned checks.

The user handles commits and publication. Git was initialized and the documentation was committed by the user before M1. Use `git diff --check` when reviewing changes.

## Sources

- [Custom instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) — instruction discovery and hierarchy.
- [Config basics](https://learn.chatgpt.com/docs/config-file/config-basic) — settings, configuration precedence, and project trust.
- [Rethinking skills and prompts](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra) — concise instructions and reading documentation as needed.
