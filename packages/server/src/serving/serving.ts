export class ServiceAlreadyExists extends Error {}
export class ServiceNotOpen extends Error {}
export class AdmissionAlreadyFinished extends Error {}
export class WithdrawalAlreadyBegan extends Error {}

type ServiceState = "open" | "withdrawing" | "closed";

interface ServiceRecord {
  readonly interface: string;
  readonly address: string;
  state: ServiceState;
  readonly active: Set<string>;
}

interface AdmissionRecord {
  readonly service: string;
  finished: boolean;
}

export class ServingMemoryConcept {
  private readonly services = new Map<string, ServiceRecord>();
  private readonly admissions = new Map<string, AdmissionRecord>();

  open({
    service,
    interface: selected,
    address,
  }: {
    service: string;
    interface: string;
    address: string;
  }) {
    if (this.services.has(service)) {
      throw new ServiceAlreadyExists("This service already exists.");
    }
    this.services.set(service, { interface: selected, address, state: "open", active: new Set() });
    return { service, interface: selected, address };
  }

  admit({ service, admission }: { service: string; admission: string }) {
    const selected = this.services.get(service);
    if (selected?.state !== "open") {
      throw new ServiceNotOpen("This service is not open for admission.");
    }
    selected.active.add(admission);
    this.admissions.set(admission, { service, finished: false });
    return { service, admission };
  }

  finish({ admission }: { admission: string }) {
    const selected = this.admissions.get(admission);
    if (selected === undefined || selected.finished) {
      throw new AdmissionAlreadyFinished("This admission has already finished.");
    }
    selected.finished = true;
    const service = this.services.get(selected.service)!;
    service.active.delete(admission);
    if (service.state === "withdrawing" && service.active.size === 0) service.state = "closed";
    return { admission };
  }

  withdraw({ service }: { service: string }) {
    const selected = this.services.get(service);
    if (selected === undefined || selected.state !== "open") {
      throw new WithdrawalAlreadyBegan("Withdrawal has already begun for this service.");
    }
    selected.state = selected.active.size === 0 ? "closed" : "withdrawing";
    return { service };
  }

  _get({ service }: { service: string }): Array<{
    interface: string;
    address: string;
    state: ServiceState;
    active: number;
  }> {
    const selected = this.services.get(service);
    return selected === undefined
      ? []
      : [
          {
            interface: selected.interface,
            address: selected.address,
            state: selected.state,
            active: selected.active.size,
          },
        ];
  }
}

export const servingSpec = `# Serving

## Purpose

Make an assembled interface available and later withdraw it without admitting
new interactions during withdrawal or abandoning interactions still owned by
the service.

## Principle

Maya opens a service and admits an interaction. Withdrawal prevents another
admission. Finishing the earlier interaction closes the withdrawing service.

## Types

\`\`\`types
external Service
external Interface
external Address
external Admission
\`\`\`

## State

\`\`\`state
a set of Services with
  an interface Interface
  an address Address
  a state String

a set of Admissions with
  a service Service
  a finished Flag
\`\`\`

## Actions

\`\`\`actions
open (service: Service, interface: Interface, address: Address) : return (service: Service, interface: Interface, address: Address)
  where there is a Service service
  then
    refuse SERVICE_ALREADY_EXISTS "This service already exists."
  where there is no Service service
  then
    add an open Service service with interface and address
    return service, interface, address

admit (service: Service, admission: Admission) : return (service: Service, admission: Admission)
  where Service service is not open
  then
    refuse SERVICE_NOT_OPEN "This service is not open for admission."
  where Service service is open
  then
    add Admission admission for service
    return service, admission

finish (admission: Admission) : return (admission: Admission)
  where Admission admission is absent or finished
  then
    refuse ADMISSION_ALREADY_FINISHED "This admission has already finished."
  where Admission admission is active
  then
    finish admission
    close its withdrawing service when no active admissions remain
    return admission

withdraw (service: Service) : return (service: Service)
  where Service service is absent, withdrawing, or closed
  then
    refuse WITHDRAWAL_ALREADY_BEGAN "Withdrawal has already begun for this service."
  where Service service is open
  then
    withdraw service
    close it when no active admissions remain
    return service
\`\`\`

## Queries

\`\`\`queries
_get (service: Service) : optional (interface: Interface, address: Address, state: String, active: Integer)
  answers the service and its number of active admissions when it exists
\`\`\`
`;
