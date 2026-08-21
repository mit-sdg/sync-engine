## Repository boundary

The application root is "/application". Resolve every relative path from that root and stay inside it. Never search, list, read, or write a parent directory, sibling repository or trial, home-directory configuration, global skill, or temporary directory. Do not seek prior implementations, prior trial output, or examples outside this application. The generated prompt and supplied context below are authoritative: do not reread their task, brief, decomposition, contracts, guidance, or role files from disk. Use repository reads only for granted application context that is not already embedded.

- Read: `application:.` ("/application").
- Write: none.
- Tools: `repository-read`.
- Project shell: `none`.
- Network: not granted.
- Generated output: not granted.
- Long-running processes: not granted.

Application read `.` excludes `.git`, `.sync-engine`, `node_modules`, framework internals, and generated/build output unless separately supplied or granted.

Anything not granted above is unavailable. Generated output may only come from a granted project command and must not be edited manually. Never grantable: `git-mutation`, `dependency-installation`, `framework-internals`, `workflow-management`, `skill-cli-invocation`, `delegation-or-handoff`.
