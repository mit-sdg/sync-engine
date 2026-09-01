# Concept implementation

Implement each concept as a plain TypeScript class. Actions take one named input object and return the exact object-shaped result:

- `return (item: Item)` becomes `{ item }`;
- `return ()` becomes `{}`, never `void` or `undefined`;
- `one` returns one row object;
- `optional` is annotated `Row[]` or `Array<Row>` and returns zero or one row, never the tuple union `[] | [Row]`; and
- `many` returns an array in its promised stable ordering.

Registration reads the prototype. Keep undeclared helpers `#private` or module-level; TypeScript `private` still emits a prototype method. Provide an explicit constructor whose parameters have real defaults so runtime arity is zero:

```ts
constructor(initial: Iterable<Row> = []) {
  this.#rows = new Map(Array.from(initial, (row) => [row.id, row]));
}
```

Test no-argument construction and `ConceptClass.length === 0`.

Export the raw class and one stable error class per declared refusal. Production registration belongs to application integration. A refusal must leave the requested transition unapplied. Enforce race-sensitive and security-critical invariants in the owner action and, for persistence, in the same transaction or constraint.

Keep peer identities opaque; never import, call, or inspect peer concept facts. Implement only approved behavior even when an example shows more.

Test exact result objects, success, refusals, repetition, lifecycle, query cardinality/order, and contracted persistence. Test public behavior rather than layout or framework internals.
