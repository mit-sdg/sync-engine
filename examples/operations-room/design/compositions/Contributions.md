## Compositions

### Contributions

The contribution boundary adds an update to the discussion for the room's
current mitigation when the selected policy permits the responder. The same
request returns the selected policy's denial when it does not. The assembly
supplies one complete policy, keeping endpoint behavior stable while allowing
membership-based and host-only applications.

## Views

Contribution permission is a shared policy with complementary permitted and
denied views. The responders policy derives permission from room membership;
the host policy derives it from ownership of the room. Selecting exactly one
policy keeps the two endpoint alternatives disjoint without relying on endpoint
order.
