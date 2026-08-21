# Frontend implementation guidance

A frontend is a client of the application's generated endpoint contract. Browser code
uses the typed HTTP client; command-line or in-process code may use the local client over
the same contract. Do not call application endpoints with raw `fetch`, import backend
concepts or composition, or bypass endpoint validation, authorization, and refusal
handling.

Treat every endpoint response as its declared success-or-error union. Present expected
refusals as deliberate user-visible outcomes rather than swallowing or silently retrying
them. Cancellation, timeouts, and transport faults are distinct from declared domain
refusals.

Keep the frontend thin: adapt user interaction to endpoint calls and render the resulting
state. Local state may own transient presentation concerns, but authoritative product
facts, persistence, authorization, and policy remain behind the endpoints. Do not infer
or recreate backend rules from UI state.

Test the user-visible success and refusal paths introduced by the frontend, including
loading, empty, and transport-failure states when they are material to the requested
experience.
