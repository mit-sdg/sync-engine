# Tallying

## Purpose

Keep a running total of how often something has happened to a subject, so the count can
be read back without keeping a record of each separate occurrence.

## Principle

Exhibit `e1` has never been visited, so its total reads 0. A visitor arrives and Tallying
increments the total to 1; two more arrivals increment it to 3. Clearing `e1` puts its total back
to 0, and clearing it again is refused because there is nothing left to clear.

## Types

```types
external Subject
  The thing whose occurrences are being totalled.
```

## State

```state
a set of Totals with
  a subject Subject
  a count Number

Rule: at most one Total has each subject
Rule: count is a positive whole number
```

## Actions

```actions
increment (subject: Subject) : return (subject: Subject, total: Number)
  where no Total has subject
  then
    add a Total with subject and a count of 1
    read that count as total
    return subject, total
  where a Total has subject
  then
    increase that Total's count by 1
    read that count as total
    return subject, total

clear (subject: Subject) : return (subject: Subject)
  where no Total has subject
  then
    refuse NOTHING_TALLIED "That subject has no total to clear."
  where a Total has subject
  then
    delete that Total
    return subject
```

## Queries

```queries
_total (subject: Subject) : one (total: Number)
  answers the count of the Total with subject
  answers 0 when no Total has subject
```
