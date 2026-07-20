export const applicationExamples = {
  readingCircle: {
    directory: "reading-circle",
    generated: ["generated/reading-circle.md", "generated/wire.ts"],
  },
  operationsRoom: {
    directory: "operations-room",
    generated: ["generated/operations-room.md", "generated/wire.ts"],
  },
} as const;

export type ApplicationExampleName = keyof typeof applicationExamples;
