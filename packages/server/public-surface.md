# Public API

## `@mit-sdg/sync-engine-server/serve`

<!-- register:server-serve:start -->

`RunningServer`, `ServeOptions`, `ServerAddress`, `open`, `serve`

<!-- register:server-serve:end -->

`serve({ at, realizations, signal })` checks all deployed Fetch claims, opens a
listener, and remains pending until the host signal asks Serving to withdraw.

`open(options)` is the same admission with the listener handed back as a
`RunningServer`: `mount(realization)` serves one more checked realization
after the same overlap check (candidate previews mount this way),
`unmount(realization)` stops serving one while its open requests finish, and
`close()` withdraws exactly as `serve` does on its signal. Routing reads each
mounted realization's claims live, so a realization whose claim set changes —
the promotable Web realization — is routed by what it currently claims.
