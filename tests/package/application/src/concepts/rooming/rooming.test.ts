import { RoomAlreadyOpen, RoomNotOpen } from "./errors.ts";
import { RoomingConcept } from "./rooming.ts";

const rooming = new RoomingConcept(() => "checkout-latency");
const opened = rooming.open({ name: "Checkout latency" });
const found = rooming._get({ room: opened.room });

if (found[0]?.name !== "Checkout latency") throw new Error("The opened room was not found.");
try {
  rooming.open({ name: "Checkout latency" });
  throw new Error("The duplicate room was accepted.");
} catch (error) {
  if (!(error instanceof RoomAlreadyOpen)) throw error;
}
rooming.close({ room: opened.room });
if (rooming._get({ room: opened.room }).length !== 0) throw new Error("The room stayed open.");
try {
  rooming.close({ room: opened.room });
  throw new Error("The closed room was closed twice.");
} catch (error) {
  if (!(error instanceof RoomNotOpen)) throw error;
}
