# Discussing

## Purpose

Open a discussion about a subject and collect authored responses, so people can
carry an exchange forward and close it deliberately.

## Principle

Mina opens a discussion about a proposal. Sol responds, and the response is
shown in the order it arrived. Mina closes the discussion. A later response is
refused because the discussion is closed, as is an attempt to open a second
discussion about the same subject while the first one is open.

## Types

```types
external Subject
  The object receiving a discussion.
external Person
  The identity that authored a response.
```

## State

```state
a set of Discussions with
  a subject Subject

an Open set of Discussions

a seq of Responses with
  a discussion Discussion
  an author Person
  a text String

alias Discussion for Discussions
alias Response for Responses
```

## Actions

```actions
open (subject: Subject) : return (discussion: Discussion)
  where no open discussion has subject
  then
    add a new discussion with subject
    add discussion to open
    return discussion
  where some open discussion has subject
  then
    refuse DISCUSSION_ALREADY_OPEN "This subject already has an open discussion."

respond (discussion: Discussion, author: Person, text: String) : return (response: Response)
  where discussion in open
  then
    add a new response with discussion, author, and text
    return response
  where discussion not in open
  then
    refuse DISCUSSION_NOT_OPEN "This discussion is not open."

close (discussion: Discussion) : return ()
  where discussion in open
  then
    remove discussion from open
    return
  where discussion not in open
  then
    refuse DISCUSSION_NOT_OPEN "This discussion is not open."
```

## Queries

```queries
_openFor (subject: Subject) : optional (discussion: Discussion)
  answers no row for a Subject with no open Discussion
_responses (discussion: Discussion) : many (response: Response, discussion: Discussion, author: Person, text: String)
  answers no rows for a Discussion with no Responses
  orders rows by when each Response was added
```
