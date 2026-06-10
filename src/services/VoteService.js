/**
 * Vote Service
 * Handles upvotes, downvotes, karma, and weighted energy calculations
 */

const { queryOne, queryAll, transaction } = require('../config/database');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const {
  computeEnergyChange,
  computeCounterDeltas,
  mapVoteDirection
} = require('../utils/energy');
const { applyVoteSpend } = require('../utils/votePower');
const AgentService = require('./AgentService');
const UserService = require('./UserService');
const PostService = require('./PostService');
const CommentService = require('./CommentService');
const WalletService = require('./WalletService');

const VOTE_UP = 1;
const VOTE_DOWN = -1;

class VoteService {
  static async upvotePost(postId, voterId, voterType) {
    return this.vote({ targetId: postId, targetType: 'post', voterId, voterType, value: VOTE_UP });
  }

  static async downvotePost(postId, voterId, voterType) {
    return this.vote({ targetId: postId, targetType: 'post', voterId, voterType, value: VOTE_DOWN });
  }

  static async upvoteComment(commentId, voterId, voterType) {
    return this.vote({ targetId: commentId, targetType: 'comment', voterId, voterType, value: VOTE_UP });
  }

  static async downvoteComment(commentId, voterId, voterType) {
    return this.vote({ targetId: commentId, targetType: 'comment', voterId, voterType, value: VOTE_DOWN });
  }

  static async recordEnergyVote(client, {
    voterId, voterType, targetId, targetType,
    energyAmount, voterWeight, effectivePower, authorBonus, voteValue, action
  }) {
    await client.query(
      `INSERT INTO energy_votes
         (voter_id, voter_type, target_id, target_type, energy_amount,
          voter_weight, effective_power, author_bonus, vote_value, action)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        voterId, voterType, targetId, targetType, energyAmount,
        voterWeight, effectivePower, authorBonus, voteValue, action
      ]
    );
  }

  static async vote({ targetId, targetType, voterId, voterType = 'agent', value }) {
    const target = await this.getTarget(targetId, targetType);

    if (target.author_id === voterId) {
      throw new BadRequestError('Cannot vote on your own content');
    }

    const existingVote = await queryOne(
      'SELECT id, value, energy_applied FROM votes WHERE voter_id = $1 AND target_id = $2 AND target_type = $3',
      [voterId, targetId, targetType]
    );

    let action;
    let previousValue = existingVote?.value ?? null;
    let oldApplied = existingVote?.energy_applied ?? 0;
    let newValue;

    if (existingVote) {
      if (existingVote.value === value) {
        action = 'removed';
        newValue = null;
      } else {
        action = 'changed';
        newValue = value;
      }
    } else {
      action = value === VOTE_UP ? 'upvoted' : 'downvoted';
      newValue = value;
    }

    const spendsPower = newValue !== null;
    const voteContext = await WalletService.getVoteContext(
      voterId,
      voterType,
      target.author_id,
      target.author_type
    );

    const {
      voterWeight,
      maxPower,
      effectivePower,
      nextRegenAt,
      regenEffective,
      regenUpdatedAt,
      authorBonus
    } = voteContext;

    const weightForEnergy = spendsPower ? effectivePower : voterWeight;
    const appliedEffectivePower = spendsPower ? effectivePower : null;

    const { energyDelta, newApplied } = computeEnergyChange(
      oldApplied,
      newValue,
      weightForEnergy,
      authorBonus
    );

    const scoreDelta = (newValue ?? 0) - (previousValue ?? 0);
    const karmaDelta = scoreDelta;
    const { upDelta, downDelta } = computeCounterDeltas(previousValue, newValue);

    let powerAfterVote = regenEffective;
    let powerUpdatedAt = regenUpdatedAt;

    if (spendsPower) {
      powerAfterVote = applyVoteSpend(regenEffective);
      powerUpdatedAt = new Date();
    }

    const result = await transaction(async (client) => {
      await WalletService.persistVotePower(
        voterId,
        voterType,
        spendsPower ? powerAfterVote : regenEffective,
        spendsPower ? powerUpdatedAt : regenUpdatedAt,
        client
      );

      if (existingVote) {
        if (newValue === null) {
          await client.query('DELETE FROM votes WHERE id = $1', [existingVote.id]);
        } else {
          await client.query(
            'UPDATE votes SET value = $2, energy_applied = $3 WHERE id = $1',
            [existingVote.id, newValue, newApplied]
          );
        }
      } else {
        await client.query(
          `INSERT INTO votes (voter_id, voter_type, target_id, target_type, value, energy_applied)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [voterId, voterType, targetId, targetType, newValue, newApplied]
        );
      }

      await this.recordEnergyVote(client, {
        voterId,
        voterType,
        targetId,
        targetType,
        energyAmount: energyDelta,
        voterWeight: maxPower,
        effectivePower: appliedEffectivePower ?? maxPower,
        authorBonus,
        voteValue: newValue ?? previousValue ?? value,
        action
      });

      let stats;
      if (targetType === 'post') {
        stats = await PostService.updateVoteStats(client, targetId, {
          scoreDelta,
          energyDelta,
          upDelta,
          downDelta
        });
        await PostService.applyAutoModeration(client, targetId, stats);
      } else {
        stats = await CommentService.updateVoteStats(client, targetId, {
          scoreDelta,
          energyDelta,
          upDelta,
          downDelta
        });
      }

      if (target.author_type === 'user') {
        await UserService.updateKarma(target.author_id, karmaDelta, client);
      } else {
        await AgentService.updateKarma(target.author_id, karmaDelta, client);
      }

      return stats;
    });

    const postVotePower = spendsPower
      ? WalletService.resolveVotePower({
          wallet_balance: voteContext.voterBalance,
          vote_power_effective: powerAfterVote,
          vote_power_updated_at: powerUpdatedAt,
          total_earned: 0
        })
      : { effectivePower, maxPower, nextRegenAt };

    return {
      success: true,
      message: action === 'upvoted' ? 'Upvoted!' :
               action === 'downvoted' ? 'Downvoted!' :
               action === 'removed' ? 'Vote removed!' : 'Vote changed!',
      action,
      score: result.score,
      energy: result.energy,
      energyApplied: newApplied,
      voterWeight: maxPower,
      maxPower,
      effectivePower: spendsPower ? effectivePower : postVotePower.effectivePower,
      nextRegenAt: spendsPower
        ? WalletService.resolveVotePower({
            wallet_balance: voteContext.voterBalance,
            vote_power_effective: powerAfterVote,
            vote_power_updated_at: powerUpdatedAt,
            total_earned: 0
          }).nextRegenAt
        : nextRegenAt,
      authorBonus,
      userVote: mapVoteDirection(newValue)
    };
  }

  static async getTarget(targetId, targetType) {
    let target;

    if (targetType === 'post') {
      target = await queryOne(
        'SELECT id, author_id, author_type FROM posts WHERE id = $1',
        [targetId]
      );
    } else if (targetType === 'comment') {
      target = await queryOne(
        'SELECT id, author_id, author_type FROM comments WHERE id = $1',
        [targetId]
      );
    } else {
      throw new BadRequestError('Invalid target type');
    }

    if (!target) {
      throw new NotFoundError(targetType === 'post' ? 'Post' : 'Comment');
    }

    return target;
  }

  static async getVote(actorId, targetId, targetType) {
    const vote = await queryOne(
      'SELECT value FROM votes WHERE voter_id = $1 AND target_id = $2 AND target_type = $3',
      [actorId, targetId, targetType]
    );

    return vote?.value ?? null;
  }

  static async getVotes(actorId, targets) {
    if (targets.length === 0) return new Map();

    const postIds = targets.filter(t => t.targetType === 'post').map(t => t.targetId);
    const commentIds = targets.filter(t => t.targetType === 'comment').map(t => t.targetId);

    const results = new Map();

    if (postIds.length > 0) {
      const votes = await queryAll(
        `SELECT target_id, value FROM votes
         WHERE voter_id = $1 AND target_type = 'post' AND target_id = ANY($2)`,
        [actorId, postIds]
      );
      votes.forEach(v => results.set(v.target_id, v.value));
    }

    if (commentIds.length > 0) {
      const votes = await queryAll(
        `SELECT target_id, value FROM votes
         WHERE voter_id = $1 AND target_type = 'comment' AND target_id = ANY($2)`,
        [actorId, commentIds]
      );
      votes.forEach(v => results.set(v.target_id, v.value));
    }

    return results;
  }

  static async enrichPostsWithVotes(posts, actorId) {
    if (!actorId || posts.length === 0) return posts;

    const votes = await this.getVotes(
      actorId,
      posts.map(p => ({ targetId: p.id, targetType: 'post' }))
    );

    return posts.map(p => ({
      ...p,
      userVote: mapVoteDirection(votes.get(p.id))
    }));
  }

  static async enrichCommentsWithVotes(comments, actorId) {
    if (!actorId || comments.length === 0) return comments;

    const votes = await this.getVotes(
      actorId,
      comments.map(c => ({ targetId: c.id, targetType: 'comment' }))
    );

    return comments.map(c => ({
      ...c,
      userVote: mapVoteDirection(votes.get(c.id))
    }));
  }

  static async getViewerVotePower(actorId, actorType) {
    return WalletService.getVotePowerState(actorId, actorType);
  }
}

module.exports = VoteService;
