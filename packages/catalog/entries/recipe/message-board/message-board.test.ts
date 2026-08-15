import { describe, expect, test, vi } from "vite-plus/test";
import { applicationConceptSet } from "@catalog/concepts";
import {
  exerciseMessageBoard,
  exerciseRegistrationPartialFailure,
} from "./message-board.behavior.ts";
import { compositions } from "./message-board.ts";

const { AddMessageBoardComment, PublishMessageBoardPost, RetractMessageBoardComment } =
  compositions.BoardPublishing;
const {
  ChangeBoardPassword,
  CurrentBoardUser,
  DeleteBoardAccount,
  RegisterBoardUser,
  SignInBoardUser,
  SignOutBoardUser,
} = compositions.Accounts;
const { ListMessageBoard } = compositions.BoardPages;

function memoryInstances() {
  try {
    return applicationConceptSet.implementations("memory" as never, {} as never);
  } catch (error) {
    if (error instanceof Error && error.message.includes('floor "memory" is missing')) return;
    throw error;
  }
}

describe("Message Board recipe memory floor", () => {
  test("exports every declared endpoint", () => {
    for (const member of [
      AddMessageBoardComment,
      ChangeBoardPassword,
      CurrentBoardUser,
      DeleteBoardAccount,
      ListMessageBoard,
      PublishMessageBoardPost,
      RegisterBoardUser,
      RetractMessageBoardComment,
      SignInBoardUser,
      SignOutBoardUser,
    ])
      expect(member).toBeDefined();
  });

  test("runs the board contract against real memory concepts", async () => {
    const instances = memoryInstances();
    if (instances === undefined) return;
    await exerciseMessageBoard(instances);
  });

  test("retains registration when session creation faults", async () => {
    const instances = memoryInstances();
    if (instances === undefined) return;
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await exerciseRegistrationPartialFailure(instances);
    } finally {
      reported.mockRestore();
    }
  });
});
