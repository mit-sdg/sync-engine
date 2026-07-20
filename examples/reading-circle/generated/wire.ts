// Generated from the reading-circle assembly. Do not edit.

import type { vocabulary as ApplicationVocabulary } from "../src/concept-set.ts";

type AtPath<T, P extends readonly string[]> = P extends readonly [infer H extends string, ...infer R extends string[]] ? H extends keyof T ? AtPath<T[H], R> : never : T;
type QueryRow<T> = T extends readonly (infer Row)[] ? Row : T;
type AllOf<T extends readonly unknown[]> = T extends readonly [infer Head, ...infer Rest] ? Head & AllOf<Rest> : unknown;
type OneOf<T extends readonly unknown[]> = T[number];
type Jsonify<T> = T extends Date ? string : T extends null | boolean | number | string ? T : T extends (...args: never[]) => unknown ? never : T extends readonly (infer Item)[] ? Jsonify<Item>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : never;

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type AppWideError = never;

export type ReadingCircleWire = {
  "/circles/choose": {
    input: {
      "circle": Jsonify<AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Selecting"]["choose"]>[0], ["scope"]>>;
      "reading": Jsonify<AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Selecting"]["choose"]>[0], ["item"]>>;
    };
    output: {
      "reading": Jsonify<AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Selecting"]["choose"]>[0], ["item"]>>;
    };
    error: { error: AppWideError | "INVALID_INPUT" };
  };
  "/circles/create": {
    input: {
      "host": Jsonify<AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Gathering"]["create"]>[0], ["host"]>>;
      "name": Jsonify<AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Gathering"]["create"]>[0], ["name"]>>;
    };
    output: {
      "circle": Jsonify<AtPath<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)["Gathering"]["create"]>>, ["gathering"]>>;
    };
    error: { error: AppWideError | "INVALID_INPUT" };
  };
  "/circles/join": {
    input: {
      "circle": Jsonify<AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Gathering"]["join"]>[0], ["gathering"]>>;
      "member": Jsonify<AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Gathering"]["join"]>[0], ["member"]>>;
    };
    output: {
      "member": Jsonify<AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Gathering"]["join"]>[0], ["member"]>>;
    };
    error: { error: AppWideError | "ALREADY_JOINED" | "GATHERING_NOT_FOUND" | "INVALID_INPUT" };
  };
  "/circles/page": {
    input: {
      "circle": Jsonify<AllOf<[AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Gathering"]["_get"]>[0], ["gathering"]>, AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Gathering"]["_members"]>[0], ["gathering"]>, AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Selecting"]["_current"]>[0], ["scope"]>]>>;
    };
    output: {
      "page": {
        "circle": Jsonify<AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Gathering"]["_get"]>[0], ["gathering"]>>;
        "host": Jsonify<AtPath<QueryRow<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)["Gathering"]["_get"]>>>, ["host"]>>;
        "members": {
          "member": Jsonify<AtPath<QueryRow<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)["Gathering"]["_members"]>>>, ["member"]>>;
        }[];
        "name": Jsonify<AtPath<QueryRow<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)["Gathering"]["_get"]>>>, ["name"]>>;
        "reading": {
          "reading": Jsonify<AtPath<QueryRow<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)["Selecting"]["_current"]>>>, ["item"]>>;
          "responses": {
            "member": Jsonify<AtPath<QueryRow<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)["Discussing"]["_responses"]>>>, ["author"]>>;
            "response": Jsonify<AtPath<QueryRow<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)["Discussing"]["_responses"]>>>, ["response"]>>;
            "text": Jsonify<AtPath<QueryRow<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)["Discussing"]["_responses"]>>>, ["text"]>>;
          }[];
        };
      };
    };
    error: { error: AppWideError | "INVALID_INPUT" };
  };
  "/circles/respond": {
    input: {
      "circle": Jsonify<AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Gathering"]["_membership"]>[0], ["gathering"]>>;
      "member": Jsonify<OneOf<[AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Discussing"]["respond"]>[0], ["author"]>, AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Gathering"]["_membership"]>[0], ["member"]>]>>;
      "reading": Jsonify<AtPath<QueryRow<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)["Selecting"]["_current"]>>>, ["item"]>>;
      "text": Jsonify<AtPath<Parameters<(typeof ApplicationVocabulary.concepts)["Discussing"]["respond"]>[0], ["text"]>>;
    };
    output: {
      "response": Jsonify<AtPath<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)["Discussing"]["respond"]>>, ["response"]>>;
    };
    error: { error: AppWideError | "DISCUSSION_NOT_OPEN" | "INVALID_INPUT" | "NOT_A_MEMBER" };
  };
};
