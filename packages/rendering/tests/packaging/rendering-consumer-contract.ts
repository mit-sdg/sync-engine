import { html, renderer, type RendererInvocation } from "@mit-sdg/sync-engine-rendering/language";

const Heading = renderer("Shows the greeting heading.", () => html`<h1>Hello, world.</h1>`);
const Hello = renderer("Composes the greeting.", () => html`<main>${Heading({})}</main>`);
const invocation: RendererInvocation = Hello({});
void invocation;
