# Sessions

Sessions connect accepted account credentials to opaque, independently expiring
application sessions.

Registration [establishes a new account and starts a session](reaction:Sessions.EnteringApplication.Register)
for the returned account reference, which is that account's username.
[Sign-in](reaction:Sessions.EnteringApplication.SignIn) proves an existing account's
credentials and starts a new session for the returned account reference. In both
cases callers cannot choose a different subject.

```endpoints
Sessions.EnteringApplication.Register at /auth/register
Sessions.EnteringApplication.SignIn at /auth/sign-in
```

An [active session resolves to its subject username](reaction:Sessions.CurrentAccount.CurrentUser).
Board activity uses that resolved username as its author. An unknown, ended, or
expired session does not identify a current account.

```endpoints
Sessions.CurrentAccount.CurrentUser at /auth/current
```

[Signing out ends the presented active session](reaction:Sessions.LeavingApplication.SignOut).
Other sessions for the same account remain independent, and an ended session no
longer grants access to the board.

```endpoints
Sessions.LeavingApplication.SignOut at /auth/sign-out
```
