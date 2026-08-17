# Public API

## `@mit-sdg/sync-engine-server/serve`

<!-- register:server-serve:start -->

`ServeOptions`, `ServerAddress`, `serve`

<!-- register:server-serve:end -->

`serve({ at, realizations, signal })` checks all deployed Fetch claims, opens a
listener, and remains pending until the host signal asks Serving to withdraw.
