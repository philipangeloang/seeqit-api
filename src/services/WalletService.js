/**
 * Wallet Service
 * Read/write simulated SEEQ balances, vote power state, and ledger credits
 */

const { queryOne, transaction } = require('../config/database');
const { NotFoundError } = require('../utils/errors');
const { computeWeight, computeAuthorBonus } = require('../utils/energy');
const {
  regeneratePower,
  applyVoteSpend,
  buildPowerState
} = require('../utils/votePower');

class WalletService {
  static _table(actorType) {
    return actorType === 'user' ? 'users' : 'agents';
  }

  static async _queryRow(client, sql, params) {
    if (client) {
      const result = await client.query(sql, params);
      return result.rows[0] || null;
    }
    return queryOne(sql, params);
  }

  static async getBalance(actorId, actorType = 'agent', client = null) {
    const table = this._table(actorType);
    const row = await this._queryRow(
      client,
      `SELECT wallet_balance FROM ${table} WHERE id = $1`,
      [actorId]
    );

    if (!row) throw new NotFoundError(actorType === 'user' ? 'User' : 'Agent');
    return Number(row.wallet_balance) || 0;
  }

  static async getVotePowerRow(actorId, actorType = 'agent', client = null) {
    const table = this._table(actorType);
    const row = await this._queryRow(
      client,
      `SELECT wallet_balance, vote_power_effective, vote_power_updated_at
       FROM ${table} WHERE id = $1`,
      [actorId]
    );

    if (!row) throw new NotFoundError(actorType === 'user' ? 'User' : 'Agent');
    return row;
  }

  static resolveVotePower(row, now = new Date()) {
    const balance = Number(row.wallet_balance) || 0;
    const maxPower = computeWeight(balance);
    const { effective, updatedAt } = regeneratePower({
      effective: row.vote_power_effective,
      maxPower,
      updatedAt: row.vote_power_updated_at || now,
      now
    });

    const state = buildPowerState(effective, maxPower, updatedAt, now);

    return {
      voterBalance: balance,
      maxPower: state.maxPower,
      effectivePower: state.effectivePower,
      nextRegenAt: state.nextRegenAt,
      regenEffective: effective,
      regenUpdatedAt: updatedAt
    };
  }

  static async getVotePowerState(actorId, actorType = 'agent', client = null) {
    const row = await this.getVotePowerRow(actorId, actorType, client);
    return this.resolveVotePower(row);
  }

  static async persistVotePower(actorId, actorType, effective, updatedAt, client) {
    const table = this._table(actorType);
    await client.query(
      `UPDATE ${table}
       SET vote_power_effective = $2, vote_power_updated_at = $3, updated_at = NOW()
       WHERE id = $1`,
      [actorId, effective, updatedAt]
    );
  }

  static async getVoteContext(voterId, voterType, authorId, authorType, client = null) {
    const voterRow = await this.getVotePowerRow(voterId, voterType, client);
    const authorBalance = await this.getBalance(authorId, authorType, client);
    const power = this.resolveVotePower(voterRow);
    const authorBonus = computeAuthorBonus(authorBalance);

    return {
      voterBalance: power.voterBalance,
      authorBalance,
      voterWeight: power.maxPower,
      maxPower: power.maxPower,
      effectivePower: power.effectivePower,
      nextRegenAt: power.nextRegenAt,
      regenEffective: power.regenEffective,
      regenUpdatedAt: power.regenUpdatedAt,
      authorBonus
    };
  }

  static async creditBalance({ actorId, actorType, amount, reason, adminId = null }, client = null) {
    const credit = Math.round(Number(amount) || 0);
    if (credit <= 0) return { previousBalance: 0, newBalance: 0, delta: 0 };

    const run = async (dbClient) => {
      const table = this._table(actorType);
      const locked = await dbClient.query(
        `SELECT wallet_balance FROM ${table} WHERE id = $1 FOR UPDATE`,
        [actorId]
      );

      if (!locked.rows[0]) throw new NotFoundError(actorType === 'user' ? 'User' : 'Agent');

      const previousBalance = Number(locked.rows[0].wallet_balance) || 0;
      const newBalance = previousBalance + credit;

      await dbClient.query(
        `UPDATE ${table}
         SET wallet_balance = $2,
             total_earned = COALESCE(total_earned, 0) + $3,
             updated_at = NOW()
         WHERE id = $1`,
        [actorId, newBalance, credit]
      );

      await dbClient.query(
        `INSERT INTO wallet_ledger
           (actor_id, actor_type, previous_balance, new_balance, delta, reason, admin_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [actorId, actorType, previousBalance, newBalance, credit, reason, adminId]
      );

      return { previousBalance, newBalance, delta: credit };
    };

    if (client) return run(client);
    return transaction(run);
  }
}

module.exports = WalletService;
