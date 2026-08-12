## Compositions

### Room

The room boundary lets a host create an incident room, responders join it, and
the room choose a current mitigation. Its read endpoint returns the shared room
dashboard rather than rebuilding that read model at the boundary.

## Formers

The room read models own the roster, summary, current mitigation, response
statistics, and dashboard shapes. They are shared independently of the endpoint
group, so scenarios and other composition groups can ask the same questions
without registering another copy.
