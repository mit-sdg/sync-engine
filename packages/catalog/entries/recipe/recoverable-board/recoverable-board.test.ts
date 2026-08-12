import { expect, test } from "vite-plus/test";
import { compositions } from "./recoverable-board.ts";

const {
  AddBoardComment,
  CreateBoardLabel,
  LabelBoardPost,
  ListRecoverableBoard,
  PublishBoardPost,
  PurgeBoardPost,
  RestoreBoardPost,
  RetractBoardComment,
  TrashBoardPost,
  UnlabelBoardPost,
} = compositions;

test("exports the Recoverable Board endpoint set", () => {
  expect({
    AddBoardComment,
    CreateBoardLabel,
    LabelBoardPost,
    ListRecoverableBoard,
    PublishBoardPost,
    PurgeBoardPost,
    RestoreBoardPost,
    RetractBoardComment,
    TrashBoardPost,
    UnlabelBoardPost,
  }).toEqual({
    AddBoardComment: expect.anything(),
    CreateBoardLabel: expect.anything(),
    LabelBoardPost: expect.anything(),
    ListRecoverableBoard: expect.anything(),
    PublishBoardPost: expect.anything(),
    PurgeBoardPost: expect.anything(),
    RestoreBoardPost: expect.anything(),
    RetractBoardComment: expect.anything(),
    TrashBoardPost: expect.anything(),
    UnlabelBoardPost: expect.anything(),
  });
});
