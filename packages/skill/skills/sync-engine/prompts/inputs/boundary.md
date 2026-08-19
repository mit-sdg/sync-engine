# What a design says about its boundary

An endpoint takes one request and produces one answer. Endpoints are the only way into
the application, and every caller reaches them the same way, whether that caller is a
browser, a command line, or another part of the same program.

Say what a caller supplies, what comes back, and every refusal with a stable code and
its meaning. Do not say how any of that is rendered: no methods, status codes, headers,
exit codes, or address shapes beyond an endpoint's own name. Rendering belongs to the
application layer and differs by transport, so naming one asks for a guarantee the
boundary may not be able to give.

When two refusals have to be indistinguishable to a caller, say that as behaviour.

A concept that depends on the current time or on a generated identifier says so in its
prose. The implementation injects it; the concept never reaches for a clock itself.
