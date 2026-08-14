# Board

The board resolves every request through its active session, so callers cannot
choose the author used for posts or comments. It combines post publication and
comment attachments into one current board.

[Reading the board](reaction:Board.BoardReading.ListBoard) requires a current
account resolved from an active session. The result uses the
[message-board read](former:Board.BoardReading.Board) to list published posts in
publication order. Each post includes its identity, author, and content,
followed by its existing comments in arrival order with each comment's identity,
author, and content.

A current account may [publish a post](reaction:Board.BoardPublishing.PublishPost).
The application supplies the account's username as the author, and the
published post becomes part of the board. A caller cannot publish under another
author.

A current account may [add a comment](reaction:Board.BoardComments.AddComment)
only to a post that exists. The application interprets the post as the comment
target and the current username as the comment author. Only that author may
[retract the attachment](reaction:Board.BoardComments.RetractComment).
Retraction removes the comment from the board without removing its target post.
