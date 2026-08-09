# Preferring

## Purpose

Keep explicit scoped preferences for each owner, so independently composed
features can share choices without owning one another's state.

## Principle

Mina first prefers a dark theme and then compact density for a workshop.
Replacing her theme with light keeps the same preference identity and first-set
position. Jo's theme and Mina's theme in another scope remain independent. An
exact value matches; a different or absent value does not. Clearing Mina's
workshop theme removes it, and trying to clear it again is refused without
changing the remaining preferences.

## State

```state
a set of Preferences with
  an owner Owner
  a scope Scope
  a key Key
  a value Value
```

At most one preference exists for an owner, scope, and key. Each preference has
an identity. Preferences retain first-set order; replacing a value preserves
the preference identity and position.

## Actions

```actions
set (owner: Owner, scope: Scope, key: Key, value: Value) : return (preference: Preference)
  where no preference has owner, scope, and key
  then
    add a new preference with owner, scope, key, and value
    return preference
  where some preference has owner, scope, and key
  then
    replace that preference's value with value
    return that preference

clear (owner: Owner, scope: Scope, key: Key) : return (preference: Preference)
  where no preference has owner, scope, and key
  then
    refuse PREFERENCE_NOT_FOUND "There is no preference for this owner, scope, and key."
  where some preference has owner, scope, and key
  then
    delete that preference
    return that preference
```

## Queries

```queries
_get (owner: Owner, scope: Scope, key: Key) : optional (preference: Preference, value: Value)
_all (owner: Owner) : many (preference: Preference, scope: Scope, key: Key, value: Value)
_matches (owner: Owner, scope: Scope, key: Key, value: Value) : one (matches: Flag)
```

`_all` answers in first-set order. `_matches` answers true only when the exact
owner, scope, key, and value exist; it answers false for a different or absent
value. Preferring treats owners, scopes, keys, and values as opaque. Composition
owns field meanings and supplies any defaults for absent preferences. An
injected identity source must return fresh preference identities between 1 and
128 characters. An invalid or colliding generated identity is an internal host
failure and leaves preference state unchanged.
