/**
 * Linear step rules shared by the step bar and the lead page.
 *  - Steps are done in order.
 *  - optional steps (e.g. follow-up) never block and are never "missed".
 *  - anytime steps (e.g. payment) can be finished early and don't make earlier steps "missed";
 *    they become the "next" step only once every required step before them is done.
 */
export type StepRule = { optional?: boolean; anytime?: boolean }

const isLinear = (s?: StepRule) => !s?.optional && !s?.anytime

/** Index of the furthest completed linear (in-order) step, -1 when none. */
export function lastDoneStep(doneFlags: boolean[], steps: readonly StepRule[] = []): number {
  for (let i = doneFlags.length - 1; i >= 0; i--) if (doneFlags[i] && isLinear(steps[i])) return i
  return -1
}

/** Required steps that were skipped: not done although a later in-order step is done. */
export function missedSteps(doneFlags: boolean[], steps: readonly StepRule[] = []): number[] {
  const last = lastDoneStep(doneFlags, steps)
  return doneFlags.flatMap((d, i) => (!d && i < last && isLinear(steps[i]) ? [i] : []))
}

/** First step still to do, in order (optional steps skipped); -1 when everything is done. */
export function nextStep(doneFlags: boolean[], steps: readonly StepRule[] = []): number {
  for (let i = 0; i < doneFlags.length; i++) {
    if (doneFlags[i] || steps[i]?.optional) continue
    // An anytime step is "next" only once every required step before it is done
    if (steps[i]?.anytime && doneFlags.slice(0, i).some((d, k) => !d && isLinear(steps[k]))) continue
    if (isLinear(steps[i]) && i < lastDoneStep(doneFlags, steps)) continue // missed, reported separately
    return i
  }
  return -1
}
