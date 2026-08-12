# Contributions

The contribution boundary applies one selected permission policy to updates for
a room's current mitigation.

## Compositions

### Contributions

The permitted endpoint adds an update to the open discussion. The complementary
denial endpoint returns the selected policy's response. Assembly installs only
the responder-based or host-only endpoint pair, keeping the shared route
disjoint without relying on declaration order.

## Views

### ResponderMayContribute

The responders policy permits a room member; the host policy permits the room
host. Assembly installs exactly one variant of this view.

### ResponderMayNotContribute

Each policy has a complementary denial relation. The responders variant derives
it from nonmembership, while the host variant derives it from not owning the
room. Assembly installs this view from the same selected variant as the
permission view.
