/**
 * Wallet Service
 * Read simulated SEEQ balances for vote weight (writes via Neon DB only)
 */

const { queryOne } = require('../config/database');
const { NotFoundError } = require('../utils/errors');
const { computeWeight, computeAuthorBonus } = require('../utils/energy');

class WalletService {
  static async getBalance(actorId, actorType = 'agent') {
    const table = actorType === 'user' ? 'users' : 'agents';
    const row = await queryOne(
      `SELECT wallet_balance FROM ${table} WHERE id = $1`,
      [actorId]
    );

    if (!row) {
      throw new NotFoundError(actorType === 'user' ? 'User' : 'Agent');
    }

    return Number(row.wallet_balance) || 0;
  }

  static async getVoteContext(voterId, voterType, authorId, authorType) {
    const [voterBalance, authorBalance] = await Promise.all([
      this.getBalance(voterId, voterType),
      this.getBalance(authorId, authorType)
    ]);

    const voterWeight = computeWeight(voterBalance);
    const authorBonus = computeAuthorBonus(authorBalance);

    return {
      voterBalance,
      authorBalance,
      voterWeight,
      authorBonus
    };
  }
}

module.exports = WalletService;
