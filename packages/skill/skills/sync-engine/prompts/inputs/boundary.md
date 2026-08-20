# What a design says about its boundary

An endpoint takes one request and produces one answer. Endpoints are the only way into
the application, and every caller reaches them the same way, regardless of caller.

Say what a caller supplies, what comes back, and every refusal with a stable code and
its meaning. Do not say how any of that is rendered: no methods, status codes, headers,
exit codes, or address shapes beyond an endpoint's own name.

When two refusals have to be indistinguishable to a caller, say that as behaviour.

A concept that depends on the current time or on a generated identifier says so in its
prose. The implementation injects it; the concept never reaches for a clock itself.
