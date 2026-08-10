export type TimeReader = () => Date;

export class TimingConcept {
  constructor(private readonly read: TimeReader = () => new Date()) {}

  _now() {
    return { time: this.read() };
  }
}
