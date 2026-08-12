# Sessions

Sessions connect accepted account credentials to opaque, independently expiring
application sessions.

## Compositions

### EnteringApplication

Registration establishes a new account and starts a session for that account's
username. Sign-in proves an existing account's credentials and starts a new
session for the same username. Callers cannot choose a different subject.

### CurrentAccount

An active session resolves to its subject username. Board activity uses that
resolved username as its author. An unknown, ended, or expired session does not
identify a current account.

### LeavingApplication

Signing out ends the presented active session. Other sessions for the same
account remain independent, and an ended session no longer grants access to the
board.
