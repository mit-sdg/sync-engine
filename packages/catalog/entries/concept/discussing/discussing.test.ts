import { DiscussingConcept, DiscussionAlreadyOpen, DiscussionNotOpen } from "./discussing.ts";

const values = ["discussion", "response"];
const discussing = new DiscussingConcept(() => values.shift() ?? "unexpected");
const { discussion } = discussing.open({ subject: "proposal" });
try {
  discussing.open({ subject: "proposal" });
  throw new Error("A second discussion opened for one subject.");
} catch (error) {
  if (!(error instanceof DiscussionAlreadyOpen)) throw error;
}
discussing.respond({ discussion, author: "Sol", text: "Ship it" });
if (discussing._responses({ discussion })[0]?.author !== "Sol") {
  throw new Error("The response was not retained.");
}
discussing.close({ discussion });
try {
  discussing.respond({ discussion, author: "Sol", text: "Again" });
  throw new Error("A closed discussion accepted a response.");
} catch (error) {
  if (!(error instanceof DiscussionNotOpen)) throw error;
}
console.log("Discussing principle holds");
