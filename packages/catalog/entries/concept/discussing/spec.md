# Discussing

## Purpose

Open an exchange about a subject and collect authored responses, so people can carry
the exchange forward and close it deliberately.

## State

```state
a set of Discussions with
  a subject Subject
  an openedAt DateTime
  an open Flag
  a closedAt optional DateTime

a seq of Responses with
  a discussion Discussion
  an author Author
  a text String
  an addedAt DateTime

at most one open Discussion has each Subject
```

## Actions

```actions
open (subject: Subject, at: DateTime) : return (discussion: Discussion)
  where an open Discussion has subject
  then
    refuse DISCUSSION_ALREADY_OPEN "This subject already has an open discussion."
  where no open Discussion has subject
  then
    add a new open Discussion with subject and openedAt at
    return discussion

respond (discussion: Discussion, author: Author, text: String, at: DateTime) : return (response: Response)
  where text is blank or longer than 2000 characters
  then
    refuse INVALID_RESPONSE_TEXT "A response must not be blank and must be at most 2000 characters."
  where discussion is unknown or closed
  then
    refuse DISCUSSION_NOT_OPEN "This discussion is not open."
  where discussion is open and text is accepted
  then
    add a new Response with discussion, author, text, and addedAt at
    return response

close (discussion: Discussion, at: DateTime) : return (discussion: Discussion)
  where discussion is unknown or closed
  then
    refuse DISCUSSION_NOT_OPEN "This discussion is not open."
  where discussion is open
  then
    mark the Discussion closed with closedAt at
    return discussion
```

## Queries

```queries
_openFor (subject: Subject) : optional (discussion: Discussion, openedAt: DateTime)
  answers no row for a Subject with no open Discussion
_responses (discussion: Discussion) : many (response: Response, author: Author, text: String, addedAt: DateTime)
  answers no rows for an unknown Discussion or a Discussion with no Responses
  orders rows by addedAt and then Response identity
_response (response: Response) : optional (discussion: Discussion, author: Author, text: String, addedAt: DateTime)
  answers no row for an unknown Response
```

## Types

`Discussion` and `Response` are identities allocated by Discussing. `Subject` and
`Author` are opaque external identities. `String` is owned text. `DateTime` is an
absolute instant.
