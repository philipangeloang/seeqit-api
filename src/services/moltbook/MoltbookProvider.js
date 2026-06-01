/**
 * Moltbook profile provider
 * - api (default): public Moltbook REST API — no API key required
 * - mock: hardcoded usernames for local/unit tests
 * - scrape: legacy HTML fallback (unreliable for SPAs; delegates to api when possible)
 */

const config = require('../../config');

const MOCK_USERNAMES = new Set([
  'karina',
  'techbot_01',
  'artsy_crab',
  'data_nerd',
  'quantum_quill',
  'pixel_pioneer',
  'neural_ninja',
  'code_whisperer',
  'logic_lord',
  'byte_bender',
  'ai_wanderer',
  'deep_dreamer',
  'silicon_sage',
  'algo_artist',
  'cyber_monk',
  'whiteknight'
]);

/** @type {Map<string, { exists: boolean, expiresAt: number }>} */
const existenceCache = new Map();

const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;

function getProviderMode() {
  return config.moltbook?.provider || 'api';
}

function getApiBaseUrl() {
  const base = (config.moltbook?.baseUrl || 'https://www.moltbook.com').replace(/\/+$/, '');
  return base.endsWith('/api/v1') ? base : `${base}/api/v1`;
}

function profileUrlCandidates(username) {
  const base = (config.moltbook?.baseUrl || 'https://www.moltbook.com').replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  const encoded = encodeURIComponent(username);
  return [`${base}/u/${encoded}`];
}

function extractUsernameFromProfileUrl(profileUrl) {
  try {
    const url = new URL(profileUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'post') {
      return null;
    }
    if (parts[0] === 'u' && parts[1]) {
      return parts[1].replace(/^@/, '').toLowerCase();
    }
    const last = parts[parts.length - 1];
    if (!last || last === 'post') return null;
    return last.replace(/^@/, '').toLowerCase();
  } catch {
    return null;
  }
}

function extractPostIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const postIndex = parts.indexOf('post');
    if (postIndex !== -1 && parts[postIndex + 1]) {
      return parts[postIndex + 1];
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchMoltbookPost(postId) {
  const apiBase = getApiBaseUrl();
  const url = `${apiBase}/posts/${encodeURIComponent(postId)}`;
  const response = await fetchWithTimeout(url);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Moltbook post API returned ${response.status}`);
  }

  const data = await response.json();
  return data.post || data.data?.post || data.data || null;
}

function postContainsChallenge(post, challengeCode) {
  if (!post) return false;
  return (
    pageContainsChallenge(post.content, challengeCode) ||
    pageContainsChallenge(post.title, challengeCode)
  );
}

/** Moltbook list API truncates post bodies (~500 chars). Fetch full post when needed. */
const LIST_TRUNCATION_LENGTH = 500;

async function resolveFullPost(post) {
  if (!post?.id) return post;

  const likelyTruncated =
    typeof post.content === 'string' && post.content.length >= LIST_TRUNCATION_LENGTH - 1;

  if (!likelyTruncated) {
    return post;
  }

  try {
    const full = await fetchMoltbookPost(post.id);
    return full || post;
  } catch {
    return post;
  }
}

async function findChallengeInPosts(posts, challengeCode) {
  for (const listPost of posts) {
    if (postContainsChallenge(listPost, challengeCode)) {
      return true;
    }

    const fullPost = await resolveFullPost(listPost);
    if (postContainsChallenge(fullPost, challengeCode)) {
      return true;
    }
  }
  return false;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'SeeqIT-MoltbookVerifier/1.0',
        Accept: 'application/json, text/html, application/xhtml+xml',
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMoltbookProfile(username) {
  const apiBase = getApiBaseUrl();
  const url = `${apiBase}/agents/profile?name=${encodeURIComponent(username)}`;
  const response = await fetchWithTimeout(url);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Moltbook profile API returned ${response.status}`);
  }

  const data = await response.json();
  return data.agent || data.data?.agent || null;
}

async function fetchMoltbookPosts(username, limit = 25) {
  const apiBase = getApiBaseUrl();
  const url = `${apiBase}/posts?author=${encodeURIComponent(username)}&limit=${limit}`;
  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  return data.posts || data.data || [];
}

function pageContainsChallenge(text, challengeCode) {
  return typeof text === 'string' && text.includes(challengeCode);
}

class ApiMoltbookProvider {
  async usernameExists(username) {
    const normalized = username.toLowerCase().trim();
    const cached = existenceCache.get(normalized);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.exists;
    }

    let exists = false;
    try {
      const profile = await fetchMoltbookProfile(normalized);
      exists = profile !== null && profile.name?.toLowerCase() === normalized;
    } catch {
      exists = false;
    }

    existenceCache.set(normalized, { exists, expiresAt: Date.now() + CACHE_TTL_MS });
    return exists;
  }

  async verifyChallenge({ username, profileUrl, challengeCode }) {
    const normalized = username.toLowerCase().trim();

    if (profileUrl) {
      const postId = extractPostIdFromUrl(profileUrl);
      if (postId) {
        try {
          const post = await fetchMoltbookPost(postId);
          if (!post) {
            return { verified: false, reason: 'Moltbook post not found at the URL you provided' };
          }
          const authorName = (post.author_name || post.author?.name || '').toLowerCase();
          if (authorName && authorName !== normalized) {
            return {
              verified: false,
              reason: 'That post was not authored by the Moltbook username you are claiming'
            };
          }
          if (postContainsChallenge(post, challengeCode)) {
            return { verified: true, method: 'api' };
          }
        } catch (err) {
          return {
            verified: false,
            reason: `Could not fetch Moltbook post: ${err.message}`
          };
        }
      } else {
        const urlUsername = extractUsernameFromProfileUrl(profileUrl);
        if (urlUsername && urlUsername !== normalized) {
          return {
            verified: false,
            reason: 'Profile URL does not match the Moltbook username being claimed'
          };
        }
      }
    }

    let profile;
    try {
      profile = await fetchMoltbookProfile(normalized);
    } catch (err) {
      return {
        verified: false,
        reason: `Could not reach Moltbook: ${err.message}`
      };
    }

    if (!profile) {
      return { verified: false, reason: 'Moltbook profile not found' };
    }

    if (profile.name?.toLowerCase() !== normalized) {
      return { verified: false, reason: 'Moltbook profile username mismatch' };
    }

    if (pageContainsChallenge(profile.description, challengeCode)) {
      return { verified: true, method: 'api' };
    }

    try {
      const posts = await fetchMoltbookPosts(normalized);
      if (await findChallengeInPosts(posts, challengeCode)) {
        return { verified: true, method: 'api' };
      }
    } catch {
      // posts fetch failed — fall through to not found
    }

    return {
      verified: false,
      reason:
        'Verification code not found in your Moltbook profile or recent posts. ' +
        'Try a short post containing only the code, or paste the direct link to the post that contains it.'
    };
  }
}

class MockMoltbookProvider {
  async usernameExists(username) {
    const normalized = username.toLowerCase().trim();
    return MOCK_USERNAMES.has(normalized);
  }

  async verifyChallenge({ username, profileUrl, challengeCode }) {
    const normalized = username.toLowerCase().trim();
    const urlUsername = profileUrl ? extractUsernameFromProfileUrl(profileUrl) : normalized;

    if (urlUsername && urlUsername !== normalized) {
      return {
        verified: false,
        reason: 'Profile URL does not match the username being claimed'
      };
    }

    if (profileUrl && profileUrl.includes(challengeCode)) {
      return { verified: true, method: 'mock' };
    }

    if (MOCK_USERNAMES.has(normalized)) {
      return { verified: true, method: 'mock' };
    }

    return {
      verified: false,
      reason: 'Verification code not found on Moltbook profile (mock mode)'
    };
  }
}

/** Legacy scrape provider — uses public API first, then HTML text search */
class ScrapeMoltbookProvider extends ApiMoltbookProvider {
  async verifyChallenge(args) {
    const apiResult = await super.verifyChallenge(args);
    if (apiResult.verified) {
      return apiResult;
    }

    const { profileUrl, challengeCode } = args;
    if (!profileUrl) {
      return apiResult;
    }

    try {
      const response = await fetchWithTimeout(profileUrl, { method: 'GET' });
      if (response.ok) {
        const html = await response.text();
        const text = html.replace(/<[^>]+>/g, ' ');
        if (text.includes(challengeCode)) {
          return { verified: true, method: 'scrape' };
        }
      }
    } catch {
      // ignore
    }

    return apiResult;
  }
}

function createProvider() {
  const mode = getProviderMode();
  if (mode === 'mock') {
    return new MockMoltbookProvider();
  }
  if (mode === 'scrape') {
    return new ScrapeMoltbookProvider();
  }
  return new ApiMoltbookProvider();
}

let providerInstance = null;

function getMoltbookProvider() {
  if (!providerInstance) {
    providerInstance = createProvider();
  }
  return providerInstance;
}

function resetMoltbookProvider() {
  providerInstance = null;
  existenceCache.clear();
}

module.exports = {
  getMoltbookProvider,
  resetMoltbookProvider,
  ApiMoltbookProvider,
  MockMoltbookProvider,
  ScrapeMoltbookProvider,
  extractUsernameFromProfileUrl,
  extractPostIdFromUrl,
  fetchMoltbookProfile,
  fetchMoltbookPost,
  MOCK_USERNAMES
};
