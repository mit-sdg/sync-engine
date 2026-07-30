# @mit-sdg/sync-engine-http

The maintained HTTP transport for `@mit-sdg/sync-engine`.

- `@mit-sdg/sync-engine-http/server` provides policies and `createHttpHandler`.
- `@mit-sdg/sync-engine-http/client` provides the fetch client transport.
- `@mit-sdg/sync-engine-http/tooling` projects the generated logical wire.

Use one policy value for the handler and projector:

```ts
const policy = httpFloor({/* origin, credential, and public error policy */});
const handler = createHttpHandler({ application, gateway, floor: policy });

export default {
  assemble,
  title: "Application",
  projections: [httpWire({ policy, name: "ApplicationWireHttp" })],
};
```
