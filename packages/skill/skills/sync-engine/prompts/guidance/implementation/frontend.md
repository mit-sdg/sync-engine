# Frontend implementation

Use the generated typed endpoint client. Do not call raw `fetch`, import backend concepts or composition, or bypass validation and authorization. Treat endpoint results as success-or-error unions; distinguish declared refusals from transport faults, timeout, and cancellation.

Keep authoritative facts and policy behind endpoints. Test the requested success and refusal paths plus material loading, empty, and transport-failure states.
