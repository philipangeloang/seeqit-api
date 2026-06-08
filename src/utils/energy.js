/**
 * Energy system helpers
 * Mitchell sqrt anti-whale vote weight + ranking utilities
 */

const WEIGHT_TOKEN_DIVISOR = 50;
const WEIGHT_SCALE_FACTOR = 1.27;

const AUTO_HIDE_ENERGY = -10;
const AUTO_HIDE_MIN_VOTES = 5;
const AUTO_DELETE_ENERGY = -25;
const AUTO_DELETE_MIN_VOTES = 10;

/**
 * Vote weight from SEEQ wallet balance (Mitchell sqrt anti-whale)
 * voter_weight = 1 + sqrt(balance / 50) * 1.27
 * @param {number} balance
 * @returns {number}
 */
function computeWeight(balance = 0) {
  const bal = Math.max(0, Number(balance) || 0);
  return 1 + Math.sqrt(bal / WEIGHT_TOKEN_DIVISOR) * WEIGHT_SCALE_FACTOR;
}

/**
 * Author bonus — disabled until Mitchell confirms author curve
 * @param {number} _balance
 * @returns {number}
 */
function computeAuthorBonus(_balance = 0) {
  return 0;
}

/**
 * Energy applied by a single vote direction
 * @param {number} voteValue - 1 or -1
 * @param {number} voterWeight
 * @param {number} authorBonus
 * @returns {number}
 */
function computeAppliedEnergy(voteValue, voterWeight = 1, authorBonus = 0) {
  if (!voteValue) return 0;
  return Math.round(voteValue * (voterWeight + authorBonus));
}

/**
 * Energy change for a vote action (legacy helper — prefer computeAppliedEnergy deltas)
 * @param {Object} params
 * @param {number} params.value
 * @param {number} [params.voterWeight=1]
 * @param {number} [params.authorBonus=0]
 * @returns {number}
 */
function computeEnergyDelta({ value, voterWeight = 1, authorBonus = 0 }) {
  return computeAppliedEnergy(value, voterWeight, authorBonus);
}

/**
 * Compute energy delta from old and new applied amounts (flip/remove safe)
 * @param {number} oldApplied
 * @param {number|null} newValue
 * @param {number} voterWeight
 * @param {number} authorBonus
 * @returns {{ energyDelta: number, newApplied: number }}
 */
function computeEnergyChange(oldApplied, newValue, voterWeight, authorBonus) {
  const newApplied = newValue ? computeAppliedEnergy(newValue, voterWeight, authorBonus) : 0;
  return {
    energyDelta: newApplied - (oldApplied || 0),
    newApplied
  };
}

function mapVoteDirection(value) {
  if (value === 1) return 'up';
  if (value === -1) return 'down';
  return null;
}

function computeCounterDeltas(previousValue, newValue) {
  let upDelta = 0;
  let downDelta = 0;

  if (previousValue === 1) upDelta -= 1;
  if (previousValue === -1) downDelta -= 1;
  if (newValue === 1) upDelta += 1;
  if (newValue === -1) downDelta += 1;

  return { upDelta, downDelta };
}

function checkAutoModeration(energy, upvotes, downvotes) {
  const totalVotes = upvotes + downvotes;
  return {
    hide: energy <= AUTO_HIDE_ENERGY && totalVotes >= AUTO_HIDE_MIN_VOTES,
    softDelete: energy <= AUTO_DELETE_ENERGY && totalVotes >= AUTO_DELETE_MIN_VOTES
  };
}

function getTimeRangeFilter(timeRange) {
  switch (timeRange) {
    case 'hour':
      return "p.created_at > NOW() - INTERVAL '1 hour'";
    case 'day':
      return "p.created_at > NOW() - INTERVAL '1 day'";
    case 'week':
      return "p.created_at > NOW() - INTERVAL '7 days'";
    case 'month':
      return "p.created_at > NOW() - INTERVAL '30 days'";
    case 'year':
      return "p.created_at > NOW() - INTERVAL '365 days'";
    default:
      return null;
  }
}

module.exports = {
  WEIGHT_TOKEN_DIVISOR,
  WEIGHT_SCALE_FACTOR,
  AUTO_HIDE_ENERGY,
  AUTO_HIDE_MIN_VOTES,
  AUTO_DELETE_ENERGY,
  AUTO_DELETE_MIN_VOTES,
  computeWeight,
  computeAuthorBonus,
  computeAppliedEnergy,
  computeEnergyDelta,
  computeEnergyChange,
  mapVoteDirection,
  computeCounterDeltas,
  checkAutoModeration,
  getTimeRangeFilter
};
