import { assemble } from "@mit-sdg/sync-engine/assembly";
import { expect } from "vite-plus/test";
import { applicationConcepts, vocabulary } from "@catalog/concepts";
import { compositions } from "./message-board.ts";

const {
  AddMessageBoardComment,
  ChangeBoardPassword,
  CurrentBoardUser,
  DeleteBoardAccount,
  ListMessageBoard,
  PublishMessageBoardPost,
  RegisterBoardUser,
  RetractMessageBoardComment,
  SignInBoardUser,
  SignOutBoardUser,
} = compositions;

export type CatalogInstances = ReturnType<typeof applicationConcepts.implementations>;

type MessageBoardApplication = ReturnType<typeof assembleMessageBoard>;

const composition = {
  AddMessageBoardComment,
  ChangeBoardPassword,
  CurrentBoardUser,
  DeleteBoardAccount,
  ListMessageBoard,
  PublishMessageBoardPost,
  RegisterBoardUser,
  RetractMessageBoardComment,
  SignInBoardUser,
  SignOutBoardUser,
};

export function assembleMessageBoard(instances: CatalogInstances) {
  return assemble({ vocabulary, instances, composition, queryCache: "none" });
}

async function invoke(
  application: MessageBoardApplication,
  path: string,
  input: Record<string, unknown>,
) {
  return application.invoker.invoke(path as never, input as never);
}

async function success(
  application: MessageBoardApplication,
  path: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await invoke(application, path, input);
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(`Expected ${path} to succeed.`);
  return result.value as Record<string, unknown>;
}

function identity(value: unknown): string {
  expect(value).toEqual(expect.any(String));
  return value as string;
}

function observedTiming(instances: CatalogInstances) {
  const delegate = instances.Timing;
  const observed: Date[] = [];
  return {
    observed,
    timing: {
      async _now() {
        const answer = await delegate._now();
        observed.push(new Date(answer.time.getTime()));
        return answer;
      },
    } as CatalogInstances["Timing"],
  };
}

export async function exerciseMessageBoard(instances: CatalogInstances): Promise<void> {
  const { observed, timing } = observedTiming(instances);
  const application = assembleMessageBoard({ ...instances, Timing: timing });

  const registration = await success(application, "/message-board/register", {
    username: "ari",
    password: "correct horse",
  });
  expect(registration).toEqual({
    username: "ari",
    session: expect.any(String),
    expiresAt: expect.any(Date),
  });
  const firstSession = identity(registration.session);
  await expect(
    invoke(application, "/message-board/current-user", { session: firstSession }),
  ).resolves.toEqual({ ok: true, value: { username: "ari" } });
  await expect(
    invoke(application, "/message-board/sign-out", { session: firstSession }),
  ).resolves.toEqual({ ok: true, value: { signedOut: true } });
  await expect(
    invoke(application, "/message-board/current-user", { session: firstSession }),
  ).resolves.toEqual({
    ok: false,
    error: { kind: "domain", value: "UNKNOWN_SESSION" },
  });

  const signedIn = await success(application, "/message-board/sign-in", {
    username: "ari",
    password: "correct horse",
  });
  const session = identity(signedIn.session);
  await expect(
    invoke(application, "/message-board/change-password", {
      session,
      currentPassword: "correct horse",
      newPassword: "new correct horse",
    }),
  ).resolves.toEqual({ ok: true, value: { username: "ari" } });
  await expect(
    invoke(application, "/message-board/sign-in", {
      username: "ari",
      password: "correct horse",
    }),
  ).resolves.toEqual({
    ok: false,
    error: { kind: "domain", value: "INVALID_CREDENTIALS" },
  });

  const beforePost = observed.length;
  const published = await success(application, "/message-board/post", {
    session,
    content: "A floor-neutral post",
  });
  expect(observed).toHaveLength(beforePost + 1);
  const post = identity(published.post);
  const [postRecord] = await instances.Posting._get({ post });
  expect(postRecord).toEqual({
    author: "ari",
    content: "A floor-neutral post",
    publishedAt: observed[beforePost],
  });

  const beforeComment = observed.length;
  const added = await success(application, "/message-board/comment", {
    session,
    target: post,
    text: "A comment on the post",
  });
  expect(observed).toHaveLength(beforeComment + 1);
  const comment = identity(added.comment);
  const [commentRecord] = await instances.Commenting._get({ comment });
  expect(commentRecord).toEqual({
    target: post,
    author: "ari",
    text: "A comment on the post",
    addedAt: observed[beforeComment],
  });

  await expect(invoke(application, "/message-board/list", { session })).resolves.toEqual({
    ok: true,
    value: {
      board: {
        posts: [
          {
            post,
            author: "ari",
            content: "A floor-neutral post",
            publishedAt: observed[beforePost],
            comments: [
              {
                comment,
                author: "ari",
                text: "A comment on the post",
                addedAt: observed[beforeComment],
              },
            ],
          },
        ],
      },
    },
  });
  await expect(
    invoke(application, "/message-board/comment", {
      session,
      target: "missing-post",
      text: "This must not attach.",
    }),
  ).resolves.toEqual({
    ok: false,
    error: { kind: "domain", value: "POST_NOT_FOUND" },
  });
  await expect(
    invoke(application, "/message-board/retract-comment", { session, comment }),
  ).resolves.toEqual({ ok: true, value: { comment } });
  await expect(invoke(application, "/message-board/list", { session })).resolves.toEqual({
    ok: true,
    value: {
      board: {
        posts: [
          {
            post,
            author: "ari",
            content: "A floor-neutral post",
            publishedAt: observed[beforePost],
            comments: [],
          },
        ],
      },
    },
  });
}

export async function exerciseRegistrationPartialFailure(
  instances: CatalogInstances,
): Promise<void> {
  const delegate = instances.Sessioning;
  let failNextStart = true;
  const interruptedSessioning = {
    start(input: Parameters<CatalogInstances["Sessioning"]["start"]>[0]) {
      if (failNextStart) {
        failNextStart = false;
        throw new Error("injected session start fault");
      }
      return delegate.start(input);
    },
    current(input: Parameters<CatalogInstances["Sessioning"]["current"]>[0]) {
      return delegate.current(input);
    },
    end(input: Parameters<CatalogInstances["Sessioning"]["end"]>[0]) {
      return delegate.end(input);
    },
    _active(input: Parameters<CatalogInstances["Sessioning"]["_active"]>[0]) {
      return delegate._active(input);
    },
  } as CatalogInstances["Sessioning"];
  const application = assembleMessageBoard({ ...instances, Sessioning: interruptedSessioning });

  await expect(
    invoke(application, "/message-board/register", {
      username: "partial-user",
      password: "correct horse",
    }),
  ).resolves.toEqual({
    ok: false,
    error: { kind: "framework", code: "INTERNAL_ERROR" },
  });
  expect(await instances.Authenticating._registered({ username: "partial-user" })).toEqual({
    registered: true,
  });

  const signedIn = await success(application, "/message-board/sign-in", {
    username: "partial-user",
    password: "correct horse",
  });
  expect(signedIn).toEqual({
    username: "partial-user",
    session: expect.any(String),
    expiresAt: expect.any(Date),
  });
}

export async function exerciseMessageBoardSecurity(instances: CatalogInstances): Promise<void> {
  const application = assembleMessageBoard(instances);
  const ariRegistration = await success(application, "/message-board/register", {
    username: "ari-secure",
    password: "correct horse",
  });
  const boRegistration = await success(application, "/message-board/register", {
    username: "bo-secure",
    password: "correct horse",
  });
  const ariSession = identity(ariRegistration.session);
  const boSession = identity(boRegistration.session);

  const published = await success(application, "/message-board/post", {
    session: ariSession,
    author: "administrator",
    content: "The session decides the author",
  });
  const post = identity(published.post);
  expect((await instances.Posting._get({ post }))[0]).toMatchObject({ author: "ari-secure" });

  const ariComment = await success(application, "/message-board/comment", {
    session: ariSession,
    target: post,
    author: "bo-secure",
    text: "Ari's comment",
  });
  const comment = identity(ariComment.comment);
  expect((await instances.Commenting._get({ comment }))[0]).toMatchObject({
    author: "ari-secure",
  });
  await expect(
    invoke(application, "/message-board/retract-comment", {
      session: boSession,
      comment,
      author: "ari-secure",
    }),
  ).resolves.toEqual({
    ok: false,
    error: { kind: "domain", value: "COMMENT_AUTHOR_MISMATCH" },
  });

  await expect(
    invoke(application, "/message-board/comment", {
      session: "invented-session",
      target: "missing-post",
      text: "Do not reveal target state first.",
    }),
  ).resolves.toEqual({
    ok: false,
    error: { kind: "domain", value: "UNKNOWN_SESSION" },
  });
  await expect(
    invoke(application, "/message-board/comment", {
      session: ariSession,
      target: "missing-post",
      text: "The authenticated request may check the target.",
    }),
  ).resolves.toEqual({
    ok: false,
    error: { kind: "domain", value: "POST_NOT_FOUND" },
  });

  await expect(
    invoke(application, "/message-board/change-password", {
      session: ariSession,
      username: "bo-secure",
      currentPassword: "correct horse",
      newPassword: "new correct horse",
    }),
  ).resolves.toEqual({ ok: true, value: { username: "ari-secure" } });
  await expect(
    invoke(application, "/message-board/sign-in", {
      username: "ari-secure",
      password: "correct horse",
    }),
  ).resolves.toEqual({
    ok: false,
    error: { kind: "domain", value: "INVALID_CREDENTIALS" },
  });
  const secondAriSignIn = await success(application, "/message-board/sign-in", {
    username: "ari-secure",
    password: "new correct horse",
  });
  const secondAriSession = identity(secondAriSignIn.session);
  await expect(
    invoke(application, "/message-board/sign-in", {
      username: "bo-secure",
      password: "correct horse",
    }),
  ).resolves.toMatchObject({ ok: true, value: { username: "bo-secure" } });

  await expect(
    invoke(application, "/message-board/delete-account", {
      session: ariSession,
      username: "bo-secure",
      password: "new correct horse",
    }),
  ).resolves.toEqual({ ok: true, value: { username: "ari-secure" } });
  expect(await instances.Authenticating._registered({ username: "ari-secure" })).toEqual({
    registered: false,
  });
  await expect(
    invoke(application, "/message-board/current-user", { session: ariSession }),
  ).resolves.toEqual({ ok: true, value: { username: "ari-secure" } });
  await expect(
    invoke(application, "/message-board/current-user", { session: secondAriSession }),
  ).resolves.toEqual({ ok: true, value: { username: "ari-secure" } });
  await expect(
    invoke(application, "/message-board/post", {
      session: secondAriSession,
      content: "An existing session remains active after account deletion",
    }),
  ).resolves.toMatchObject({ ok: true, value: { post: expect.any(String) } });
  await expect(
    invoke(application, "/message-board/sign-in", {
      username: "ari-secure",
      password: "new correct horse",
    }),
  ).resolves.toEqual({
    ok: false,
    error: { kind: "domain", value: "INVALID_CREDENTIALS" },
  });

  await expect(
    invoke(application, "/message-board/sign-out", { session: ariSession }),
  ).resolves.toEqual({ ok: true, value: { signedOut: true } });
  await expect(
    invoke(application, "/message-board/current-user", { session: ariSession }),
  ).resolves.toEqual({
    ok: false,
    error: { kind: "domain", value: "UNKNOWN_SESSION" },
  });
  await expect(
    invoke(application, "/message-board/current-user", { session: secondAriSession }),
  ).resolves.toEqual({ ok: true, value: { username: "ari-secure" } });
}
