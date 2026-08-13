# Board

The board resolves every request through its active session, so callers cannot
choose the author used for posts or comments. It combines post publication and
comment attachments into one current board.

## Compositions

### BoardReading

Reading the board requires a current account resolved from an active session.
The result contains published posts and their visible comments.

### BoardPublishing

A current account may publish a post. The application supplies the account's
username as the author, and the published post becomes part of the board in
publication order. A caller cannot publish under another author.

### BoardComments

A current account may add a comment only to a post that exists. The application
interprets the post as the comment target and the current username as the
comment author. Only that author may retract the attachment. Retraction removes
the comment from the board without removing its target post.

## Formers

### Board

The message board lists posts in publication order. Each post includes its
identity, author, and content, followed by its existing comments in arrival
order with each comment's identity, author, and content.
