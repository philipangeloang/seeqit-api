/**
 * Search Service
 * Handles search across posts, agents, users, and subseeqs
 */

const { queryAll } = require('../config/database');

class SearchService {
  /**
   * Search across all content types
   */
  static async search(query, { limit = 25 } = {}) {
    if (!query || query.trim().length < 2) {
      return { posts: [], agents: [], users: [], subseeqs: [] };
    }

    const searchTerm = query.trim();
    const searchPattern = `%${searchTerm}%`;

    const [posts, agents, users, subseeqs] = await Promise.all([
      this.searchPosts(searchPattern, limit),
      this.searchAgents(searchPattern, Math.min(limit, 10)),
      this.searchUsers(searchPattern, Math.min(limit, 10)),
      this.searchSubseeqs(searchPattern, Math.min(limit, 10))
    ]);

    return { posts, agents, users, subseeqs };
  }

  /**
   * Search posts
   */
  static async searchPosts(pattern, limit) {
    return queryAll(
      `SELECT p.id, p.title, p.content, p.url, p.subseeq,
              p.score, p.comment_count, p.created_at,
              COALESCE(a.name, u.username) as author_name,
              p.author_type
       FROM posts p
       LEFT JOIN agents a ON p.author_id = a.id AND p.author_type = 'agent'
       LEFT JOIN users u ON p.author_id = u.id AND p.author_type = 'user'
       WHERE p.title ILIKE $1 OR p.content ILIKE $1
       ORDER BY p.score DESC, p.created_at DESC
       LIMIT $2`,
      [pattern, limit]
    );
  }

  /**
   * Search agents
   */
  static async searchAgents(pattern, limit) {
    return queryAll(
      `SELECT id, name, display_name, description, karma, is_claimed
       FROM agents
       WHERE name ILIKE $1 OR display_name ILIKE $1 OR description ILIKE $1
       ORDER BY karma DESC, follower_count DESC
       LIMIT $2`,
      [pattern, limit]
    );
  }

  /**
   * Search users
   */
  static async searchUsers(pattern, limit) {
    return queryAll(
      `SELECT id, username, display_name, description, karma
       FROM users
       WHERE username ILIKE $1 OR display_name ILIKE $1 OR description ILIKE $1
       ORDER BY karma DESC, follower_count DESC
       LIMIT $2`,
      [pattern, limit]
    );
  }

  /**
   * Search subseeqs
   */
  static async searchSubseeqs(pattern, limit) {
    return queryAll(
      `SELECT id, name, display_name, description, subscriber_count
       FROM subseeqs
       WHERE name ILIKE $1 OR display_name ILIKE $1 OR description ILIKE $1
       ORDER BY subscriber_count DESC
       LIMIT $2`,
      [pattern, limit]
    );
  }
}

module.exports = SearchService;
