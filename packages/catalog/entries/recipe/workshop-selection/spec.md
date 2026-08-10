# Workshop Selection recipe

## Purpose

Create a named workshop, manage its members, and keep one current workshop item.

## Concepts

Gathering owns workshop identity and membership. Selecting owns the current item for
the workshop identity used as its Scope.

## Decisions

A current item may be chosen only for a known Gathering. Selecting deliberately does
not enforce that rule because Scope is opaque to it. Workshop host and member values
are attribution unless the containing application binds authenticated identities.

## Endpoints

- `CreateWorkshop` — `/workshops/create`
- `JoinWorkshop` — `/workshops/join`
- `ChooseWorkshopItem` — `/workshops/choose`
- `GetWorkshop` — `/workshops/get`

## Failure

Choosing first confirms that the Gathering exists. Gathering has no deletion action,
so that observation cannot become stale through a catalog concept transition. The
unknown-Gathering branch answers `GATHERING_NOT_FOUND` without calling Selecting.
Concept refusals are returned without replacing their codes.
