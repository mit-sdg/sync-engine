# Incident Room recipe

## Purpose

Coordinate responders around one current mitigation, its discussion, and addressed
alerts.

## Concepts

Gathering owns the room and responders. Selecting owns its current mitigation.
Discussing owns the exchange about each Selection identity. Alerting owns one alert per
recipient and selection Cause. Timing supplies one timestamp for the discussion and
all alerts caused by a selection.

## Decisions

Choosing a mitigation records the Selection, opens a Discussion whose Subject is that
Selection, and raises one Alert for each current member. Alert replay is idempotent by
recipient and Selection cause. Contributions require a current member by default.

## Endpoints

- `CreateIncidentRoom` — `/incident-rooms/create`
- `JoinIncidentRoom` — `/incident-rooms/join`
- `ChooseMitigation` — `/incident-rooms/choose`
- `ContributeUpdate` — `/incident-rooms/contribute`
- `CloseMitigationDiscussion` — `/incident-rooms/close-discussion`
- `AcknowledgeMitigationAlert` — `/incident-rooms/acknowledge`
- `RepairMitigationEffects` — `/incident-rooms/repair`
- `GetIncidentDashboard` — `/incident-rooms/dashboard`

## Failure and repair

Selecting may commit before opening the Discussion or raising every Alert. Repair uses
the Selection identity as the Discussion Subject and Alert Cause, so retries converge
without duplicate open discussions or alerts. A member who joins after selection does
not receive the old alert. A member who leaves retains an already raised alert.

## Variants

Version 1 is endpoint-led. Optional standalone reaction packs and replaceable policy
packs require catalog support for non-endpoint composition roots and are not hidden in
this recipe.
