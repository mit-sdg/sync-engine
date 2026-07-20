// Generated from the operations-room assembly. Do not edit.

import type { vocabulary as ApplicationVocabulary } from "../src/concept-set.ts";

type AtPath<T, P extends readonly string[]> = P extends readonly [infer H extends string, ...infer R extends string[]] ? H extends keyof T ? AtPath<T[H], R> : never : T;
type QueryRow<T> = T extends readonly (infer Row)[] ? Row : T;
type AllOf<T extends readonly unknown[]> = T extends readonly [infer Head, ...infer Rest] ? Head & AllOf<Rest> : unknown;
type OneOf<T extends readonly unknown[]> = T[number];
type Jsonify<T> = T extends Date ? string : T extends null | boolean | number | string ? T : T extends (...args: never[]) => unknown ? never : T extends readonly (infer Item)[] ? Jsonify<Item>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : never;

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type AppWideError = never;

export type OperationsRoomWire = {
  "/rooms/choose-mitigation": {
    input: {
      "mitigation": Jsonify<AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Selecting"]["choose"]>[0], ["item"]>>;
      "room": Jsonify<AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Selecting"]["choose"]>[0], ["scope"]>>;
    };
    output: {
      "mitigation": Jsonify<AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Selecting"]["choose"]>[0], ["item"]>>;
    };
    error: { error: AppWideError | "INVALID_INPUT" };
  };
  "/rooms/contribute": {
    input: {
      "responder": Jsonify<OneOf<[AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Discussing"]["respond"]>[0], ["author"]>, AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Gathering"]["_membership"]>[0], ["member"]>]>>;
      "room": Jsonify<AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Gathering"]["_membership"]>[0], ["gathering"]>>;
      "text": Jsonify<AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Discussing"]["respond"]>[0], ["text"]>>;
    };
    output: {
      "response": Jsonify<AtPath<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)["Discussing"]["respond"]>>, ["response"]>>;
    };
    error: { error: AppWideError | "DISCUSSION_NOT_OPEN" | "INVALID_INPUT" | "RESPONDERS_ONLY" };
  };
  "/rooms/create": {
    input: {
      "host": Jsonify<AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Gathering"]["create"]>[0], ["host"]>>;
      "name": Jsonify<AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Gathering"]["create"]>[0], ["name"]>>;
    };
    output: {
      "room": Jsonify<AtPath<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)["Gathering"]["create"]>>, ["gathering"]>>;
    };
    error: { error: AppWideError | "INVALID_INPUT" };
  };
  "/rooms/get": {
    input: {
      "room": Jsonify<AllOf<[AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Gathering"]["_get"]>[0], ["gathering"]>, AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Gathering"]["_members"]>[0], ["gathering"]>, AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Selecting"]["_current"]>[0], ["scope"]>]>>;
    };
    output: {
      "dashboard": {
        "current": {
          "discussion": Jsonify<AtPath<QueryRow<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)["Discussing"]["_openFor"]>>>, ["discussion"]>> | null;
          "mitigation": Jsonify<AtPath<QueryRow<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)["Selecting"]["_current"]>>>, ["item"]>> | null;
          "responseCount": number;
          "responses": {
            "responder": Jsonify<AtPath<QueryRow<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)["Discussing"]["_responses"]>>>, ["author"]>>;
            "response": Jsonify<AtPath<QueryRow<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)["Discussing"]["_responses"]>>>, ["response"]>>;
            "text": Jsonify<AtPath<QueryRow<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)["Discussing"]["_responses"]>>>, ["text"]>>;
          }[];
        };
        "host": Jsonify<AtPath<QueryRow<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)["Gathering"]["_get"]>>>, ["host"]>>;
        "name": Jsonify<AtPath<QueryRow<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)["Gathering"]["_get"]>>>, ["name"]>>;
        "responders": {
          "alerts": {
            "alert": Jsonify<AtPath<QueryRow<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)["Alerting"]["_openFor"]>>>, ["alert"]>>;
            "mitigation": Jsonify<AtPath<QueryRow<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)["Selecting"]["_get"]>>>, ["item"]>>;
          }[];
          "responder": Jsonify<AtPath<QueryRow<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)["Gathering"]["_members"]>>>, ["member"]>>;
        }[];
        "room": Jsonify<AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Gathering"]["_get"]>[0], ["gathering"]>>;
      };
    };
    error: { error: AppWideError | "INVALID_INPUT" };
  };
  "/rooms/join": {
    input: {
      "responder": Jsonify<AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Gathering"]["join"]>[0], ["member"]>>;
      "room": Jsonify<AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Gathering"]["join"]>[0], ["gathering"]>>;
    };
    output: {
      "responder": Jsonify<AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Gathering"]["join"]>[0], ["member"]>>;
    };
    error: { error: AppWideError | "ALREADY_JOINED" | "GATHERING_NOT_FOUND" | "INVALID_INPUT" };
  };
};
