# Board

## Compositions

### Publishing to the board

A current account may publish a post. The application supplies the account's
username as the author, and the published post becomes part of the board in
publication order. A caller cannot publish under another author.

### Commenting on visible posts

A current account may add a comment only to a post that exists. The application
interprets the post as the comment target and the current username as the
comment author. Entered comment text is passed as content; it is not interpreted
as an identity owned by another concept.

### Existence, visibility, and retraction

Published posts remain on the board. A comment is visible beneath its target
post while its attachment exists. Only the comment's author may retract that
attachment; retraction removes the comment from the board without removing its
target post. Comments cannot make a missing post exist or become visible.

### Application boundary

Reading or changing the board requires a current account resolved from an active
session. These rules describe the application independently of how a host
carries credentials or presents the result.

## Formers

### The message board

The message board lists posts in publication order. Each post includes its
identity, author, and content, followed by its existing comments in arrival
order with each comment's identity, author, and content.
