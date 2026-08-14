export type TimeReader = () => Date;

export class TimingConcept {
  constructor(private readonly reader: TimeReader = () => new Date()) {}

  read(_input: Record<string, never>) {
    return { time: this.reader() };
  }

  _now() {
    return { time: this.reader() };
  }
}
