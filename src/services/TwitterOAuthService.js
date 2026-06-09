/**
 * Twitter/X OAuth 2.0 (PKCE) for automation callbacks
 */

const crypto = require('crypto');
const { queryOne, queryAll } = require('../config/database');
const { BadRequestError } = require('../utils/errors');
const config = require('../config');

const TWITTER_AUTH_URL = 'https://twitter.com/i/oauth2/authorize';
const TWITTER_TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
const TWITTER_USER_URL = 'https://api.twitter.com/2/users/me';

function base64UrlEncode(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generateCodeVerifier() {
  return base64UrlEncode(crypto.randomBytes(32));
}

function generateCodeChallenge(codeVerifier) {
  return base64UrlEncode(crypto.createHash('sha256').update(codeVerifier).digest());
}

function generateState() {
  return base64UrlEncode(crypto.randomBytes(24));
}

function getTwitterConfig() {
  const { clientId, clientSecret, callbackUrl, scopes } = config.twitter;
  if (!clientId || !clientSecret) {
    throw new BadRequestError(
      'Twitter OAuth is not configured',
      'Set TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET on the server'
    );
  }
  return { clientId, clientSecret, callbackUrl, scopes };
}

class TwitterOAuthService {
  static async createAuthorizationSession() {
    const { clientId, callbackUrl, scopes } = getTwitterConfig();
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await queryOne(
      `INSERT INTO oauth_states (state, code_verifier, purpose, expires_at)
       VALUES ($1, $2, 'twitter_automation', $3)`,
      [state, codeVerifier, expiresAt.toISOString()]
    );

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: callbackUrl,
      scope: scopes,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });

    return {
      state,
      authorizationUrl: `${TWITTER_AUTH_URL}?${params.toString()}`
    };
  }

  static async consumeState(state) {
    if (!state) {
      throw new BadRequestError('Missing OAuth state');
    }

    const row = await queryOne(
      `DELETE FROM oauth_states
       WHERE state = $1 AND expires_at > NOW()
       RETURNING code_verifier`,
      [state]
    );

    if (!row) {
      throw new BadRequestError('Invalid or expired OAuth state', 'Start authorization again');
    }

    return row.code_verifier;
  }

  static async exchangeCodeForTokens(code, codeVerifier) {
    const { clientId, clientSecret, callbackUrl } = getTwitterConfig();

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl,
      code_verifier: codeVerifier,
      client_id: clientId
    });

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await fetch(TWITTER_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`
      },
      body: body.toString()
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new BadRequestError(
        data.error_description || data.error || 'Twitter token exchange failed',
        'Check callback URL matches your X app settings'
      );
    }

    return data;
  }

  static async fetchTwitterUser(accessToken) {
    const response = await fetch(`${TWITTER_USER_URL}?user.fields=username`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.data) {
      throw new BadRequestError('Failed to fetch Twitter user profile');
    }

    return data.data;
  }

  static async saveTokens({ twitterUserId, twitterHandle, accessToken, refreshToken, expiresIn, scope }) {
    const expiresAt = expiresIn
      ? new Date(Date.now() + Number(expiresIn) * 1000).toISOString()
      : null;

    return queryOne(
      `INSERT INTO twitter_oauth_tokens (
         twitter_user_id, twitter_handle, access_token, refresh_token, expires_at, scope, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (twitter_user_id) DO UPDATE SET
         twitter_handle = EXCLUDED.twitter_handle,
         access_token = EXCLUDED.access_token,
         refresh_token = COALESCE(EXCLUDED.refresh_token, twitter_oauth_tokens.refresh_token),
         expires_at = EXCLUDED.expires_at,
         scope = EXCLUDED.scope,
         updated_at = NOW()
       RETURNING id, twitter_user_id, twitter_handle, expires_at, scope, updated_at`,
      [twitterUserId, twitterHandle, accessToken, refreshToken || null, expiresAt, scope || null]
    );
  }

  static async handleCallback({ code, state, error, errorDescription }) {
    if (error) {
      throw new BadRequestError(errorDescription || error || 'Twitter authorization denied');
    }

    if (!code) {
      throw new BadRequestError('Missing authorization code');
    }

    const codeVerifier = await TwitterOAuthService.consumeState(state);
    const tokens = await TwitterOAuthService.exchangeCodeForTokens(code, codeVerifier);
    const profile = await TwitterOAuthService.fetchTwitterUser(tokens.access_token);

    const saved = await TwitterOAuthService.saveTokens({
      twitterUserId: profile.id,
      twitterHandle: profile.username,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      scope: tokens.scope
    });

    return {
      connected: true,
      twitterUserId: saved.twitter_user_id,
      twitterHandle: saved.twitter_handle,
      expiresAt: saved.expires_at,
      scope: saved.scope
    };
  }

  static async listConnections() {
    return queryAll(
      `SELECT id, twitter_user_id, twitter_handle, expires_at, scope, created_at, updated_at
       FROM twitter_oauth_tokens
       ORDER BY updated_at DESC`
    );
  }

  static async cleanupExpiredStates() {
    await queryOne('DELETE FROM oauth_states WHERE expires_at <= NOW()');
  }
}

module.exports = TwitterOAuthService;
