# Commenting

## Purpose

Let people discuss an external subject while preserving authorship.

## Principle

People add comments to one subject. An author later retracts one of their comments.

## Types

```types
external Person
external Subject
```

## State

```state
comments: set Comment
  author: Person
  subject: Subject
  text: String
```

## Actions

```actions
add(author: Person, subject: Subject, text: String) : return (comment: Comment)
  where true
  then
    create comment with author, subject, and text
    return comment
```

## Queries

```queries
_for(subject: Subject) : many (comment: Comment, author: Person, text: String)
```
