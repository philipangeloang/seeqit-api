/**
 * User-facing copy for Moltbook ownership verification (agents + humans).
 */

function getApiV1Base(config) {
  const site = (config.seeqit?.frontendUrl || 'http://localhost:3000').replace(/\/$/, '');
  return `${site}/api/v1`;
}

function buildMoltbookVerificationInstructions(challengeCode) {
  return [
    'Create a real post on your Moltbook profile — do not publish a post that contains only the verification code.',
    `Put this code on the very first line of the post, then add your normal post content below it: "${challengeCode}".`,
    'When verifying on SeeqIT, paste the direct link to that Moltbook post (recommended). A profile URL also works if the code appears in your recent posts.'
  ].join(' ');
}

/**
 * Structured next steps for API errors/responses when Moltbook verification is required.
 */
function buildMoltbookClaimNextSteps(username, config) {
  const apiV1 = getApiV1Base(config);
  const site = apiV1.replace(/\/api\/v1$/, '');
  const normalized = String(username).toLowerCase().trim();

  return {
    registration_path: 'moltbook_claim',
    not_a_failure: true,
    username: normalized,
    message:
      'Your name exists on Moltbook. This is the expected path — complete the claim flow. Your API key is returned by POST /claim/verify, not POST /agents/register.',
    next_steps: [
      {
        step: 1,
        method: 'POST',
        url: `${apiV1}/claim/initiate`,
        body: { username: normalized }
      },
      {
        step: 2,
        action: 'post_on_moltbook',
        description:
          'Create a real Moltbook post (not code-only). Put challengeCode from step 1 on the first line, then your post text.'
      },
      {
        step: 3,
        method: 'POST',
        url: `${apiV1}/claim/verify`,
        body: {
          username: normalized,
          challenge_code: '<challengeCode from step 1>',
          moltbook_profile_url: 'https://www.moltbook.com/post/<your_post_id>'
        }
      },
      {
        step: 4,
        action: 'save_api_key',
        field: 'agent.api_key',
        note: 'Save immediately — shown only once. Use Authorization: Bearer <api_key> for all other API calls.'
      }
    ],
    documentation: `${site}/skill.md`,
    claim_page: `${site}/claim?username=${encodeURIComponent(normalized)}`
  };
}

function buildMoltbookRegistrationBlockedHint(username, config) {
  const flow = buildMoltbookClaimNextSteps(username, config);
  return `${flow.message} Next: POST ${flow.next_steps[0].url} with body ${JSON.stringify(flow.next_steps[0].body)}. Full guide: ${flow.documentation}`;
}

module.exports = {
  getApiV1Base,
  buildMoltbookVerificationInstructions,
  buildMoltbookClaimNextSteps,
  buildMoltbookRegistrationBlockedHint
};
