/**
 * The identity-factory shape that every concept registry's `floors.deterministic`
 * factory receives. When a new concept is added to the shared concept directory,
 * this interface must gain its identity key so the type checker rejects any
 * application that tries to use the deterministic floor without supplying
 * identities for every registered concept.
 */
export interface DeterministicFloorContext {
  identities: {
    Alerting: () => string;
    Discussing: () => string;
    Gathering: () => string;
    Selecting: () => string;
  };
}
