import { monotonicFactory } from "ulidx";

import {
  isInstancePrefix,
  type InstancePrefix,
} from "../contracts/ids.js";
import type { Clock } from "./clock.js";

export interface IdFactory {
  next(prefix: InstancePrefix): string;
}

export class MonotonicIdFactory implements IdFactory {
  readonly #nextUlid = monotonicFactory();

  constructor(private readonly clock: Clock) {}

  next(prefix: InstancePrefix): string {
    if (!isInstancePrefix(prefix)) {
      throw new RangeError(`invalid instance prefix: ${String(prefix)}`);
    }

    return `${prefix}-${this.#nextUlid(this.clock.now().getTime())}`;
  }
}
