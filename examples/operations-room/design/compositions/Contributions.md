# Contributions

The contribution boundary applies one selected permission policy to updates for
a room's current mitigation.

The [permitted endpoint](reaction:Contributions.AddContribution) adds an update to
the open discussion when the selected
[permission relation holds](view:Contributions.ResponderMayContribute). The
complementary [denial endpoint](reaction:Contributions.RejectContribution) returns
the selected policy's response when its
[denial relation holds](view:Contributions.ResponderMayNotContribute). Assembly
installs only the responder-based or host-only endpoint and view set, keeping the
shared route disjoint without relying on declaration order.

```endpoints
Contributions.AddContribution at /rooms/contribute
Contributions.RejectContribution at /rooms/contribute
```

Under the default responders policy, membership permits a contribution and
nonmembership denies it. The host-only variant instead derives permission from
room ownership and denial from not owning the room; both variants retain the
same authored composition paths because only one is selected.
