# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities through [GitHub private vulnerability
reporting](https://github.com/mit-sdg/sync-engine/security/advisories/new). Do
not disclose a suspected vulnerability in a public issue, discussion, pull
request, or social channel. Include affected versions, impact, reproduction or
proof of concept, and any known mitigations without including unrelated secrets
or production data.

Maintainers target an acknowledgement within three business days and a status
update at least weekly while an accepted report remains active. These are
response targets; remediation time depends on the reported defect. Reporters and
maintainers should coordinate disclosure, avoid exploitation or unnecessary
data access, and allow a fix and supported-user migration window before public
details are shared. Credit is offered when requested and appropriate.

## Supported versions

| Version               | Security fixes |
| --------------------- | -------------- |
| Newest `1.0.0-beta.x` | Supported      |
| Alpha releases        | Unsupported    |
| Earlier versions      | Unsupported    |

Published versions are immutable. Security corrections receive a new package
version; maintainers do not replace an existing tag or tarball. See the
[support policy](SUPPORT.md) for the complete compatibility and support window.

## Security boundary

sync-engine owns the behavior explicitly documented for its interpreter,
assembly, generated contracts, and gateway. The independently published
`@mit-sdg/sync-engine-http` package owns its production profile and cookie
floor. These packages do not provide authentication policy, domain authorization,
application input schemas, concept-state confidentiality or durability,
cross-concept transactions, dependency or host patching, TLS termination,
trusted-proxy configuration, CORS, HSTS, rate or connection limiting, DDoS
protection, secret management, exporter isolation, process supervision, or
incident response. Those controls belong to the host and application.

Generated TypeScript is not runtime validation. Applications must validate
untrusted values, enforce domain invariants in owning concepts, configure
public error projection and redaction, bound engine and host workloads, and
protect logs and custom observers as sensitive sinks. The [operational
limits](docs/operations.md) describe these responsibilities in detail.

`rawFaultReporter` is an unsanitized privileged sink. It receives original
values thrown by actions, interpreter stages, and endpoint validators without
the redaction applied to ordinary evidence and process logs. Restrict who can
configure or read this sink, apply an explicit scrubbing and retention policy,
and do not expose its reports through public errors or ordinary logs.
