# Working agreements

- Use English for repository content, including documentation, comments, and code identifiers. Continue chatting with the user in Ukrainian unless requested otherwise.
- The user makes commits. Do not commit, amend, push, or publish without a separate explicit request. Do not initialize Git on your own.
- The current phase is architecture and behavior discussion. Edit documentation and working instructions; begin application implementation only when the user requests it.
- Distinguish agreed requirements, proposals, and open questions. Do not treat assumptions as approved decisions.
- Use `docs/architecture.md` for component boundaries, `docs/editor-behavior.md` for editor commands, `docs/data-formats.md` for formats, and `docs/database.md` for schema and migrations. Read only the documents relevant to the task.
- Record significant architecture decisions and changes to agreements in `docs/decisions.md`. Keep the current direction and questions in `docs/README.md`; use `docs/milestones.md` for roadmap status and acceptance criteria.
- Support native local execution without Docker and container deployment. Makefile is the common entry point for running, building, and checking; native execution must not require Docker.
- Once code exists, add actual run and verification commands here. Do not invent test results; verify changed contracts and risks of data loss.
- Do not change global Codex settings or add secrets or user data to the repository.
