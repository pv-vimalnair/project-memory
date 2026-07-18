export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FixedClock implements Clock {
  readonly #timestamp: number;

  constructor(value: Date) {
    this.#timestamp = value.getTime();
  }

  now(): Date {
    return new Date(this.#timestamp);
  }
}
