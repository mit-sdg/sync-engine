# Discussing

## Purpose

Open a discussion about a subject and collect authored responses, so people can
carry an exchange forward and close it deliberately.

## Principle

Mina opens a discussion about a proposal. Sol responds, and the response is
shown in the order it arrived. Mina closes the discussion. A later response is
refused because the discussion is closed, as is an attempt to open a second
discussion about the same subject while the first one is open.

## State

```state
a set of Discussions with
  a subject Subject

an Open set of Discussions

a seq of Responses with
  a discussion Discussion
  an author Person
  a text String
```

At most one open discussion exists for a subject. Responses keep their arrival
order.

## Actions

```actions
open (subject: Subject) : return (discussion: Discussion), refuse (message: String)
  where no open discussion has subject
  then
    add a new discussion with subject
    add discussion to open
    return discussion
  where some open discussion has subject
  then
    refuse "This subject already has an open discussion."

respond (discussion: Discussion, author: Person, text: String) : return (response: Response), refuse (message: String)
  where discussion in open
  then
    add a new response with discussion, author, and text
    return response
  where discussion not in open
  then
    refuse "This discussion is not open."

close (discussion: Discussion) : return (), refuse (message: String)
  where discussion in open
  then
    remove discussion from open
    return
  where discussion not in open
  then
    refuse "This discussion is not open."
```

`_openFor` answers zero or one open discussion for a subject. `_responses`
answers every response for a discussion in arrival order. Subjects are opaque
identities; Discussing neither creates nor interprets them.
