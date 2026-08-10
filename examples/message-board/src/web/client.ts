import { createMessageBoardClient } from "../client.ts";

const client = createMessageBoardClient({ baseUrl: "/api" });
const status = required("status");
const authPanel = required("auth-panel");
const boardPanel = required("board-panel");
const posts = required("posts");
function required(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`#${id}`);
  if (element === null) throw new Error(`Missing #${id}.`);
  return element;
}

function form(id: string): HTMLFormElement {
  const element = required(id);
  if (!(element instanceof HTMLFormElement)) throw new Error(`#${id} is not a form.`);
  return element;
}

function text(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

function show(message: string, failed = false): void {
  status.textContent = message;
  status.classList.toggle("error", failed);
}

async function loadBoard(): Promise<void> {
  const result = await client.board.list({});
  if ("error" in result) {
    show(`Could not load board: ${result.error}`, true);
    return;
  }
  posts.replaceChildren(
    ...result.board.posts.map((post) => {
      const article = document.createElement("article");
      const heading = document.createElement("h2");
      heading.textContent = post.author;
      const body = document.createElement("p");
      body.textContent = post.content;
      const comments = document.createElement("ul");
      for (const comment of post.comments) {
        const item = document.createElement("li");
        item.textContent = `${comment.author}: ${comment.content}`;
        comments.append(item);
      }
      const commentForm = document.createElement("form");
      commentForm.innerHTML =
        '<label>Comment content reference <input name="content" maxlength="500" required></label>' +
        '<button type="submit">Attach comment</button>';
      commentForm.addEventListener("submit", (event) => {
        event.preventDefault();
        void (async () => {
          const content = text(new FormData(commentForm), "content");
          const added = await client.board.comment({ target: post.post, content });
          if ("error" in added) show(`Could not comment: ${added.error}`, true);
          else {
            commentForm.reset();
            show("Comment attached. Its content reference is displayed verbatim.");
            await loadBoard();
          }
        })();
      });
      article.append(heading, body, comments, commentForm);
      return article;
    }),
  );
}

function signedIn(as: string): void {
  authPanel.hidden = true;
  boardPanel.hidden = false;
  required("who").textContent = as;
  void loadBoard();
}

function signedOut(): void {
  authPanel.hidden = false;
  boardPanel.hidden = true;
  posts.replaceChildren();
}

form("register").addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    const data = new FormData(form("register"));
    const result = await client.auth.register({
      username: text(data, "username"),
      password: text(data, "password"),
    });
    show(
      "error" in result ? `Could not register: ${result.error}` : "Registered. Sign in now.",
      "error" in result,
    );
  })();
});

form("sign-in").addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    const data = new FormData(form("sign-in"));
    const result = await client.auth["sign-in"]({
      username: text(data, "username"),
      password: text(data, "password"),
    });
    if ("error" in result) show(`Could not sign in: ${result.error}`, true);
    else {
      show(`Signed in as ${result.username}.`);
      signedIn(result.username);
    }
  })();
});

form("new-post").addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    const content = text(new FormData(form("new-post")), "content");
    const result = await client.board.post({ content });
    if ("error" in result) show(`Could not post: ${result.error}`, true);
    else {
      form("new-post").reset();
      show("Post published.");
      await loadBoard();
    }
  })();
});

required("sign-out").addEventListener("click", () => {
  void (async () => {
    const result = await client.auth["sign-out"]({});
    show(
      "error" in result ? `Could not sign out: ${result.error}` : "Signed out.",
      "error" in result,
    );
    if (!("error" in result)) signedOut();
  })();
});

void (async () => {
  const current = await client.auth.current({});
  if ("error" in current) signedOut();
  else signedIn(current.username);
})();
