/**
 * Reward Service
 * SEEQ reward simulation — 7-day accumulation, top 40% cohort payouts
 */

const { queryOne, queryAll, transaction } = require('../config/database');
const { NotFoundError, BadRequestError } = require('../utils/errors');
const WalletService = require('./WalletService');
const config = require('../config');

const ACCUMULATION_DAYS = 7;
const QUALIFIER_PERCENT = 0.40;
const MIN_PAYOUT_SEEQ = 1;

class RewardService {
  static getDailyPoolAmount() {
    return config.rewards?.dailyPoolSeeq ?? 1000;
  }

  static getCohortDate(createdAt) {
    const d = new Date(createdAt);
    return d.toISOString().slice(0, 10);
  }

  static getCohortBounds(cohortDate) {
    const start = new Date(`${cohortDate}T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start, end };
  }

  static isCohortMature(cohortDate, now = new Date()) {
    const { start } = this.getCohortBounds(cohortDate);
    const matureAt = new Date(start);
    matureAt.setUTCDate(matureAt.getUTCDate() + ACCUMULATION_DAYS);
    return now >= matureAt;
  }

  static getDaysUntilPayout(createdAt, now = new Date()) {
    const matureAt = new Date(createdAt);
    matureAt.setUTCDate(matureAt.getUTCDate() + ACCUMULATION_DAYS);
    const ms = matureAt.getTime() - now.getTime();
    return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
  }

  static async fetchCohortContent(cohortDate) {
    const { start, end } = this.getCohortBounds(cohortDate);

    return queryAll(
      `SELECT id, 'post' AS content_type, energy, author_id, author_type, created_at
       FROM posts
       WHERE is_deleted = false AND created_at >= $1 AND created_at < $2
       UNION ALL
       SELECT id, 'comment' AS content_type, energy, author_id, author_type, created_at
       FROM comments
       WHERE is_deleted = false AND created_at >= $1 AND created_at < $2
       ORDER BY energy DESC, created_at ASC`,
      [start, end]
    );
  }

  static rankCohort(items) {
    const total = items.length;
    const qualifierCount = total === 0 ? 0 : Math.ceil(total * QUALIFIER_PERCENT);

    return items.map((item, index) => {
      const rank = index + 1;
      const qualifies = rank <= qualifierCount;
      const percentile = total === 0 ? 0 : Math.round((rank / total) * 10000) / 100;

      return {
        ...item,
        rank,
        qualifies,
        rankPercentile: percentile,
        qualifierCount,
        totalCount: total
      };
    });
  }

  static computePayouts(rankedItems, poolAmount) {
    const qualifiers = rankedItems.filter(i => i.qualifies && i.energy > 0);
    const totalEnergy = qualifiers.reduce((sum, i) => sum + Number(i.energy), 0);

    if (totalEnergy <= 0 || poolAmount <= 0) {
      return rankedItems.map(item => ({ ...item, payoutAmount: 0 }));
    }

    return rankedItems.map(item => {
      if (!item.qualifies || item.energy <= 0) {
        return { ...item, payoutAmount: 0 };
      }

      const share = Number(item.energy) / totalEnergy;
      const payoutAmount = Math.round(share * poolAmount);
      return { ...item, payoutAmount: payoutAmount >= MIN_PAYOUT_SEEQ ? payoutAmount : 0 };
    });
  }

  static async getContentRecord(contentId, contentType) {
    if (contentType === 'post') {
      return queryOne(
        `SELECT id, energy, author_id, author_type, created_at, is_deleted
         FROM posts WHERE id = $1`,
        [contentId]
      );
    }

    if (contentType === 'comment') {
      return queryOne(
        `SELECT id, energy, author_id, author_type, created_at, is_deleted
         FROM comments WHERE id = $1`,
        [contentId]
      );
    }

    throw new BadRequestError('Invalid content type');
  }

  static formatEstimate({
    contentId,
    contentType,
    energy,
    createdAt,
    match,
    cohortDate,
    totalInCohort,
    qualifierCount,
    existingRun,
    existingPayout,
    poolAmount
  }) {
    const daysUntilPayout = this.getDaysUntilPayout(createdAt);

    return {
      contentId,
      contentType,
      energy: Number(energy) || 0,
      cohortDate,
      rank: match?.rank ?? null,
      totalInCohort: match?.totalCount ?? totalInCohort ?? 0,
      qualifierCount: match?.qualifierCount ?? qualifierCount ?? 0,
      qualifies: match?.qualifies ?? false,
      rankPercentile: match?.rankPercentile ?? null,
      estimatedPayoutSeeq: existingPayout
        ? Number(existingPayout.payout_amount)
        : (match?.payoutAmount ?? 0),
      dailyPoolSeeq: poolAmount,
      daysUntilPayout: existingRun ? 0 : daysUntilPayout,
      accumulationDays: ACCUMULATION_DAYS,
      isPayoutComplete: !!existingRun,
      payoutRanAt: existingRun?.ran_at ?? null
    };
  }

  static async estimateMapForContents(contentList) {
    const result = new Map();
    if (!contentList?.length) return result;

    const byCohort = new Map();
    for (const content of contentList) {
      const cohortDate = this.getCohortDate(content.created_at);
      if (!byCohort.has(cohortDate)) byCohort.set(cohortDate, []);
      byCohort.get(cohortDate).push(content);
    }

    const poolAmount = this.getDailyPoolAmount();

    for (const [cohortDate, cohortContents] of byCohort) {
      const items = await this.fetchCohortContent(cohortDate);
      const ranked = this.rankCohort(items);
      const withPayouts = this.computePayouts(ranked, poolAmount);

      const existingRun = await queryOne(
        'SELECT id, total_paid, ran_at FROM reward_payout_runs WHERE cohort_date = $1',
        [cohortDate]
      );

      for (const content of cohortContents) {
        const match = withPayouts.find(
          i => i.id === content.id && i.content_type === content.content_type
        );

        let existingPayout = null;
        if (existingRun) {
          existingPayout = await queryOne(
            `SELECT payout_amount FROM reward_payouts
             WHERE run_id = $1 AND content_id = $2 AND content_type = $3`,
            [existingRun.id, content.id, content.content_type]
          );
        }

        const key = `${content.content_type}:${content.id}`;
        result.set(key, this.formatEstimate({
          contentId: content.id,
          contentType: content.content_type,
          energy: content.energy,
          createdAt: content.created_at,
          match,
          cohortDate,
          totalInCohort: items.length,
          qualifierCount: Math.ceil(items.length * QUALIFIER_PERCENT),
          existingRun,
          existingPayout,
          poolAmount
        }));
      }
    }

    return result;
  }

  static attachEstimatesToTree(comments, estimateMap) {
    const attach = (nodes) =>
      nodes.map(c => ({
        ...c,
        rewardEstimate: estimateMap.get(`comment:${c.id}`) ?? null,
        replies: c.replies?.length ? attach(c.replies) : []
      }));
    return attach(comments);
  }

  static async estimateForContent(contentId, contentType) {
    const content = await this.getContentRecord(contentId, contentType);
    if (!content || content.is_deleted) {
      throw new NotFoundError(contentType === 'post' ? 'Post' : 'Comment');
    }

    const map = await this.estimateMapForContents([{
      id: content.id,
      content_type: contentType,
      created_at: content.created_at,
      energy: content.energy
    }]);

    return map.get(`${contentType}:${contentId}`);
  }

  static async runDailySimulation(cohortDate, { force = false, poolAmount = null } = {}) {
    if (!cohortDate || !/^\d{4}-\d{2}-\d{2}$/.test(cohortDate)) {
      throw new BadRequestError('cohortDate must be YYYY-MM-DD');
    }

    if (!force && !this.isCohortMature(cohortDate)) {
      throw new BadRequestError(
        `Cohort ${cohortDate} is not mature yet (${ACCUMULATION_DAYS}-day window)`
      );
    }

    const existing = await queryOne(
      'SELECT id FROM reward_payout_runs WHERE cohort_date = $1',
      [cohortDate]
    );

    if (existing) {
      throw new BadRequestError(`Payout already ran for cohort ${cohortDate}`);
    }

    const pool = poolAmount ?? this.getDailyPoolAmount();
    const items = await this.fetchCohortContent(cohortDate);
    const ranked = this.rankCohort(items);
    const withPayouts = this.computePayouts(ranked, pool);
    const qualifiers = withPayouts.filter(i => i.payoutAmount > 0);
    const totalPaid = qualifiers.reduce((sum, i) => sum + i.payoutAmount, 0);

    const result = await transaction(async (client) => {
      const runRow = await client.query(
        `INSERT INTO reward_payout_runs
           (cohort_date, pool_amount, status, content_count, qualifier_count, total_paid)
         VALUES ($1, $2, 'completed', $3, $4, $5)
         RETURNING id, cohort_date, pool_amount, content_count, qualifier_count, total_paid, ran_at`,
        [cohortDate, pool, items.length, qualifiers.length, totalPaid]
      );

      const run = runRow.rows[0];

      for (const item of withPayouts) {
        await client.query(
          `INSERT INTO reward_payouts
             (run_id, content_id, content_type, author_id, author_type,
              energy_at_close, rank_position, rank_percentile, payout_amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            run.id,
            item.id,
            item.content_type,
            item.author_id,
            item.author_type,
            item.energy,
            item.rank,
            item.rankPercentile,
            item.payoutAmount
          ]
        );

        if (item.payoutAmount > 0) {
          await WalletService.creditBalance({
            actorId: item.author_id,
            actorType: item.author_type,
            amount: item.payoutAmount,
            reason: `reward_simulation:cohort:${cohortDate}:${item.content_type}:${item.id}`
          }, client);
        }
      }

      return run;
    });

    return {
      run: result,
      totalPaid,
      qualifierCount: qualifiers.length,
      contentCount: items.length
    };
  }

  static async listPayoutRuns({ limit = 20, offset = 0 } = {}) {
    const lim = Math.min(parseInt(limit, 10) || 20, 100);
    const off = parseInt(offset, 10) || 0;

    const runs = await queryAll(
      `SELECT id, cohort_date, pool_amount, status, content_count, qualifier_count,
              total_paid, ran_at
       FROM reward_payout_runs
       ORDER BY cohort_date DESC
       LIMIT $1 OFFSET $2`,
      [lim, off]
    );

    const total = await queryOne('SELECT COUNT(*)::int AS count FROM reward_payout_runs');

    return { runs, total: total?.count ?? 0, limit: lim, offset: off };
  }

  static async getAuthorEarnings(actorId, actorType) {
    const table = WalletService._table(actorType);
    const row = await queryOne(
      `SELECT wallet_balance, COALESCE(total_earned, 0) AS total_earned FROM ${table} WHERE id = $1`,
      [actorId]
    );

    const paid = await queryOne(
      `SELECT COALESCE(SUM(payout_amount), 0)::bigint AS total_paid,
              COUNT(*)::int AS payout_count
       FROM reward_payouts
       WHERE author_id = $1 AND author_type = $2`,
      [actorId, actorType]
    );

    const pendingItems = await queryAll(
      `SELECT id, 'post' AS content_type, energy, created_at
       FROM posts
       WHERE author_id = $1 AND author_type = $2 AND is_deleted = false
       UNION ALL
       SELECT id, 'comment', energy, created_at
       FROM comments
       WHERE author_id = $1 AND author_type = $2 AND is_deleted = false`,
      [actorId, actorType]
    );

    let pendingEstimate = 0;
    for (const item of pendingItems) {
      try {
        const est = await this.estimateForContent(item.id, item.content_type);
        if (!est.isPayoutComplete && est.qualifies) {
          pendingEstimate += est.estimatedPayoutSeeq;
        }
      } catch {
        // skip deleted or missing
      }
    }

    return {
      walletBalance: row ? Number(row.wallet_balance) || 0 : 0,
      totalEarned: row ? Number(row.total_earned) || 0 : Number(paid?.total_paid) || 0,
      totalPaidOut: Number(paid?.total_paid) || 0,
      payoutCount: paid?.payout_count ?? 0,
      pendingEstimateSeeq: pendingEstimate,
      dailyPoolSeeq: this.getDailyPoolAmount()
    };
  }
}

module.exports = RewardService;
