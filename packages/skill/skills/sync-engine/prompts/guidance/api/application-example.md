# Worked application composition

This example shows documented realization patterns, not required design prose. Approved
design fixes behavioral commitments and declaration links; source chooses stages,
bindings, and disjoint branches that preserve them.

## Endpoint-owned sequencing

An endpoint-linked reaction may perform every action required before its visible success.
Values returned by one action travel to the next stage through `.responds(...)` bindings:

```ts
const PublishPost = endpoint(
  "/board/post",
  ({ session, username, content, post }) =>
    receive({ session, content })
      .then(Sessioning.current({ session }).responds({ subject: username }))
      .then(Posting.publish({ author: username, content }).responds({ post }))
      .then(respond({ post })),
  {
    input: { required: ["session", "content"] },
    validators: { input: sessionContentInput, output: postOutput },
  },
);
```

Do not split a required consequence into a second reaction merely because the behavior
has several steps. If success must acknowledge all required effects, perform those effects
before `respond(...)` unless approved failure semantics explicitly say otherwise.

## Guarded success and total fallback

Sibling branches are alternatives. Give them disjoint conditions and ensure every
admitted request has an answer. A state-dependent success branch may call one action and
then respond; its sibling may return an application error directly:

```ts
const AddComment = endpoint(
  "/board/comment",
  ({ session, username, target, content, comment }) =>
    receive({ session, target, content })
      .then(Sessioning.current({ session }).responds({ subject: username }))
      .then(
        where(Posting._get({ post: target }))
          .then(Commenting.add({ target, author: username, content }).responds({ comment }))
          .then(respond({ comment }))
          .named("post-exists"),
        where(no(Posting._get({ post: target })))
          .then(respond({ error: "POST_NOT_FOUND" }))
          .named("post-missing"),
      ),
  {
    input: { required: ["session", "target", "content"] },
    validators: { input: sessionCommentInput, output: commentOutput },
  },
);
```

`MISSING_ENDPOINT_FALLBACK` means an admitted request can fall through every answer. Add a
disjoint answer required by approved behavior; do not silence the diagnostic with an
unconditional branch that overlaps a guarded success.

## Intentionally separate reaction

Use a separate reaction only when approved design selects a distinct internal reaction
link. Trigger it from a real concept action or outcome whose bindings supply the
consequence:

```ts
const SelectedReadingOpensDiscussion = reaction(({ selection }) =>
  // An empty input pattern ({}) matches any choose regardless of scope or item.
  when(Selecting.choose({}).responds({ selection })).then(Discussing.open({ subject: selection })),
);
```

Do not target an endpoint path or declaration name through `returned(..., { by })` unless
a supplied public contract explicitly defines that occurrence. Do not duplicate the
reaction's consequence inside its triggering endpoint.

## Linked placement and assembly

Place declarations under the exact groups named by accepted links, then register that
group record under its module:

```ts
export const boardComposition = {
  BoardPublishing: { PublishPost },
  BoardComments: { AddComment },
};

export const circleComposition = {
  ReadingDiscussion: { SelectedReadingOpensDiscussion },
};

assemble({
  conceptSet: applicationConceptSet,
  instances: applicationConceptSet.implementations(),
  composition: { Board: boardComposition, Circle: circleComposition },
});
```

Use the project's generation, application check, typecheck, and black-box boundary tests
as the repair loop. Public generated wire declarations may be read as caller contracts.
If documented constructions cannot preserve an approved behavioral commitment, report the
blocker instead of discovering alternate API shapes by runtime reflection.
