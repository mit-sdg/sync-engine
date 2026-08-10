export const applicationExamples = {
  readingCircle: {
    directory: "reading-circle",
    generated: ["generated/reading-circle.md", "generated/wire.ts"],
    scenario: "src/scenario.ts",
  },
  operationsRoom: {
    directory: "operations-room",
    generated: ["generated/operations-room.md", "generated/wire.ts"],
    scenario: "src/scenario.ts",
  },
  messageBoard: {
    directory: "message-board",
    generated: ["generated/message-board.md", "generated/wire.ts"],
  },
} as const;
