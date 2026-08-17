import { html, renderer, type RendererInvocation } from "@mit-sdg/sync-engine-rendering/language";

const Hello = renderer("Hello", html`<main>Hello, world.</main>`);
const invocation: RendererInvocation = Hello({});
void invocation;
