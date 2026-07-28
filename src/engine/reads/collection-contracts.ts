/** A named dependency plus its optional definition-site live reference. */
export interface FormerChannel<T> {
  name: string;
  live?: T;
}
