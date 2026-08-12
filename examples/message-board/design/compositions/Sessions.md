# Sessions

## Compositions

### Entering the application

Registration establishes a new account and starts a session for that account's
username. Sign-in proves an existing account's credentials and starts a new
session for the same username. A session subject is therefore always a username
that Authenticating has accepted; callers cannot choose a different subject.

### Acting as the current account

An active session resolves to its subject username. Board activity uses that
resolved username as its author rather than accepting an author claim from the
caller. An unknown, ended, or expired session does not identify a current
account.

### Leaving the application

Signing out ends the presented active session. Other sessions for the same
account remain independent, and an ended session no longer grants access to the
board.
