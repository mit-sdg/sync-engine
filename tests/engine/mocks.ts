/* Minimal mock concepts used for testing */

import type { Empty } from "@sync-engine/engine";

export class CounterConcept {
  public count = 0;
  increment(_: Empty) {
    this.count++;
    return {};
  }
  decrement(_: Empty) {
    this.count--;
    return {};
  }
  _getCount(_: Empty): { count: number }[] {
    return [{ count: this.count }];
  }
}

export class ButtonConcept {
  clicked({ kind }: { kind: string }) {
    return { kind };
  }
}

export class NotificationConcept {
  public messages: string[] = [];
  notify({ message }: { message: string }) {
    this.messages.push(message);
    return { message };
  }
  _getMessages(_: Empty): { message: string }[] {
    return this.messages.map((m) => ({ message: m }));
  }
}

// A small concept to test multi-binding fanout via queries
export class ListConcept {
  private values: number[] = [];
  add({ value }: { value: number }) {
    this.values.push(value);
    return { value };
  }
  clear(_: Empty) {
    this.values = [];
    return {};
  }
  _items(_: Empty): { value: number }[] {
    return this.values.map((v) => ({ value: v }));
  }
  async _itemsAsync(_: Empty): Promise<{ value: number }[]> {
    // simulate async read
    await Promise.resolve();
    return this.values.map((v) => ({ value: v }));
  }
}

// Concept whose action emits *mutually exclusive* output shapes: either an
// `error` field or a `question` field, never both. Used to verify that a `when`
// output pattern keyed on a field the record lacks rejects the match.
export class GateConcept {
  public seen: string[] = [];
  check({
    value,
  }: {
    value: number;
  }): { error: string } | { question: string } {
    if (value < 0) return { error: `negative:${value}` };
    return { question: `value:${value}` };
  }
  record({ msg }: { msg: string }) {
    this.seen.push(msg);
    return { msg };
  }
  _getSeen(_: Empty): { msg: string }[] {
    return this.seen.map((m) => ({ msg: m }));
  }
}

// Concept to echo or record action orders for flow validation
export class RecorderConcept {
  public order: string[] = [];
  record({ tag }: { tag: string }) {
    this.order.push(tag);
    return { tag };
  }
  _getOrder(_: Empty): { tag: string }[] {
    return this.order.map((t) => ({ tag: t }));
  }
}

/** Concept whose action always throws — used to test engine error resilience. */
export class ThrowingConcept {
  public hit = false;
  explode(_: Empty): { error: string; detail?: string } {
    this.hit = true;
    throw new Error("kaboom");
  }
  safe(_: Empty) {
    return { ok: true };
  }
}
