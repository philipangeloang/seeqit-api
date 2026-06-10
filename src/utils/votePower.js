/**
 * Interval voting power — Steemit-inspired mana with 10-minute regen ticks
 * Halves on each vote; doubles one step per idle interval (capped at max power)
 */

const REGEN_INTERVAL_MS = 10 * 60 * 1000;
const MIN_EFFECTIVE_POWER = 1;

/**
 * Regenerate effective power based on elapsed 10-minute intervals
 * @param {Object} params
 * @param {number|null} params.effective - stored effective power (null = full)
 * @param {number} params.maxPower - Mitchell max from balance
 * @param {Date|string} params.updatedAt - last regen anchor
 * @param {Date} [params.now] - current time
 * @returns {{ effective: number, updatedAt: Date }}
 */
function regeneratePower({ effective, maxPower, updatedAt, now = new Date() }) {
  const max = Math.max(MIN_EFFECTIVE_POWER, Number(maxPower) || MIN_EFFECTIVE_POWER);
  let current = effective == null ? max : Math.min(max, Math.max(MIN_EFFECTIVE_POWER, Number(effective) || MIN_EFFECTIVE_POWER));

  const anchor = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const anchorMs = anchor.getTime();

  if (Number.isNaN(anchorMs) || Number.isNaN(nowMs)) {
    return { effective: current, updatedAt: anchor };
  }

  const steps = Math.floor((nowMs - anchorMs) / REGEN_INTERVAL_MS);
  if (steps <= 0) {
    return { effective: current, updatedAt: anchor };
  }

  const regened = Math.min(max, current * Math.pow(2, steps));
  const newAnchor = new Date(anchorMs + steps * REGEN_INTERVAL_MS);

  return { effective: regened, updatedAt: newAnchor };
}

/**
 * Power consumed after a vote (halved, floored at MIN)
 * @param {number} effective
 * @returns {number}
 */
function applyVoteSpend(effective) {
  const current = Math.max(MIN_EFFECTIVE_POWER, Number(effective) || MIN_EFFECTIVE_POWER);
  return Math.max(MIN_EFFECTIVE_POWER, current / 2);
}

/**
 * When effective power is below max, next regen tick restores one halving step
 * @param {number} effective
 * @param {number} maxPower
 * @param {Date} updatedAt
 * @returns {Date|null}
 */
function getNextRegenAt(effective, maxPower, updatedAt) {
  const max = Math.max(MIN_EFFECTIVE_POWER, Number(maxPower) || MIN_EFFECTIVE_POWER);
  const current = Math.max(MIN_EFFECTIVE_POWER, Number(effective) || MIN_EFFECTIVE_POWER);

  if (current >= max) return null;

  const anchor = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  if (Number.isNaN(anchor.getTime())) return null;

  return new Date(anchor.getTime() + REGEN_INTERVAL_MS);
}

/**
 * Format power for API / UI
 * @param {number} effective
 * @param {number} maxPower
 * @returns {{ effectivePower: number, maxPower: number, nextRegenAt: string|null }}
 */
function buildPowerState(effective, maxPower, updatedAt, now = new Date()) {
  const max = Math.max(MIN_EFFECTIVE_POWER, Number(maxPower) || MIN_EFFECTIVE_POWER);
  const { effective: regened, updatedAt: anchor } = regeneratePower({
    effective,
    maxPower: max,
    updatedAt,
    now
  });

  const nextRegen = getNextRegenAt(regened, max, anchor);

  return {
    effectivePower: Math.round(regened * 100) / 100,
    maxPower: Math.round(max * 100) / 100,
    nextRegenAt: nextRegen ? nextRegen.toISOString() : null
  };
}

module.exports = {
  REGEN_INTERVAL_MS,
  MIN_EFFECTIVE_POWER,
  regeneratePower,
  applyVoteSpend,
  getNextRegenAt,
  buildPowerState
};
