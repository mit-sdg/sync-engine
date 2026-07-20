export interface DeterministicFloorContext {
  identities: {
    Alerting: () => string;
    Discussing: () => string;
    Gathering: () => string;
    Selecting: () => string;
  };
}
