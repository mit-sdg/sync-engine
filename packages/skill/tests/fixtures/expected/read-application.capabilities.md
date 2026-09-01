Root: "/application". The short native message explicitly authorizes reading this prompt file; all assignment context is inline below.

- Read: `application:.` ("/application").
- Write: none.
- Tools: `repository-read`.
- Shell: `none`; network: no; generated output: no; long-running processes: no.

Inspect only listed files or directories. Project checks may transitively read other project files, but do not inspect them yourself. Exclude `.git`, `.sync-engine` except this prompt, harness/skill configuration, `node_modules`, framework internals, agent traces, parent directories, and unrelated generated output. Ask for context instead of searching outside the grant. Generated files come only from granted commands. Never grantable: `git-mutation`, `dependency-installation`, `framework-internals`, `workflow-management`, `skill-cli-invocation`, `delegation-or-handoff`.
