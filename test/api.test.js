/**
 * Seeqit API Test Suite
 * 
 * Run: npm test
 */

const { 
  generateApiKey, 
  generateClaimToken, 
  generateVerificationCode,
  validateApiKey,
  extractToken,
  hashToken
} = require('../src/utils/auth');

const {
  ApiError,
  BadRequestError,
  NotFoundError,
  UnauthorizedError
} = require('../src/utils/errors');

// Test framework
let passed = 0;
let failed = 0;
const tests = [];

function describe(name, fn) {
  tests.push({ type: 'describe', name });
  fn();
}

function test(name, fn) {
  tests.push({ type: 'test', name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function assertApprox(actual, expected, epsilon = 0.01, message) {
  if (Math.abs(actual - expected) > epsilon) {
    throw new Error(message || `Expected ~${expected}, got ${actual}`);
  }
}

async function runTests() {
  console.log('\nSeeqit API Test Suite\n');
  console.log('='.repeat(50));

  for (const item of tests) {
    if (item.type === 'describe') {
      console.log(`\n[${item.name}]\n`);
    } else {
      try {
        await item.fn();
        console.log(`  + ${item.name}`);
        passed++;
      } catch (error) {
        console.log(`  - ${item.name}`);
        console.log(`    Error: ${error.message}`);
        failed++;
      }
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

// Tests

describe('Auth Utils', () => {
  test('generateApiKey creates valid key', () => {
    const key = generateApiKey();
    assert(key.startsWith('seeqit_'), 'Should have correct prefix');
    assertEqual(key.length, 71, 'Should have correct length');
  });

  test('generateClaimToken creates valid token', () => {
    const token = generateClaimToken();
    assert(token.startsWith('seeqit_claim_'), 'Should have correct prefix');
  });

  test('generateVerificationCode has correct format', () => {
    const code = generateVerificationCode();
    assert(/^[a-z]+-[A-F0-9]{4}$/.test(code), 'Should match pattern');
  });

  test('validateApiKey accepts valid key', () => {
    const key = generateApiKey();
    assert(validateApiKey(key), 'Should validate generated key');
  });

  test('validateApiKey rejects invalid key', () => {
    assert(!validateApiKey('invalid'), 'Should reject invalid');
    assert(!validateApiKey(null), 'Should reject null');
    assert(!validateApiKey('seeqit_short'), 'Should reject short key');
  });

  test('extractToken extracts from Bearer header', () => {
    const token = extractToken('Bearer seeqit_test123');
    assertEqual(token, 'seeqit_test123');
  });

  test('extractToken returns null for invalid header', () => {
    assertEqual(extractToken('Basic abc'), null);
    assertEqual(extractToken('Bearer'), null);
    assertEqual(extractToken(null), null);
  });

  test('hashToken creates consistent hash', () => {
    const hash1 = hashToken('test');
    const hash2 = hashToken('test');
    assertEqual(hash1, hash2, 'Same input should produce same hash');
  });
});

describe('Error Classes', () => {
  test('ApiError creates with status code', () => {
    const error = new ApiError('Test', 400);
    assertEqual(error.statusCode, 400);
    assertEqual(error.message, 'Test');
  });

  test('BadRequestError has status 400', () => {
    const error = new BadRequestError('Bad input');
    assertEqual(error.statusCode, 400);
  });

  test('NotFoundError has status 404', () => {
    const error = new NotFoundError('User');
    assertEqual(error.statusCode, 404);
    assert(error.message.includes('not found'));
  });

  test('UnauthorizedError has status 401', () => {
    const error = new UnauthorizedError();
    assertEqual(error.statusCode, 401);
  });

  test('ApiError toJSON returns correct format', () => {
    const error = new ApiError('Test', 400, 'TEST_CODE', 'Fix it');
    const json = error.toJSON();
    assertEqual(json.success, false);
    assertEqual(json.error, 'Test');
    assertEqual(json.code, 'TEST_CODE');
    assertEqual(json.hint, 'Fix it');
  });
});

describe('Config', () => {
  test('config loads without error', () => {
    const config = require('../src/config');
    assert(config.port, 'Should have port');
    assert(config.seeqit.tokenPrefix, 'Should have token prefix');
    assert(config.moltbook, 'Should have moltbook config');
    assert(config.seeqit.frontendUrl, 'Should have frontend URL');
  });
});

describe('Name Utils', () => {
  const names = require('../src/utils/names');

  test('normalizeAgentName lowercases and trims', () => {
    assertEqual(names.normalizeAgentName('  WhiteKnight  '), 'whiteknight');
  });

  test('isClaimPrefixedName detects c- prefix', () => {
    assert(names.isClaimPrefixedName('c-whiteknight'));
    assert(!names.isClaimPrefixedName('whiteknight'));
  });

  test('toClaimedUsername keeps Moltbook username without prefix', () => {
    assertEqual(names.toClaimedUsername('whiteknight'), 'whiteknight');
  });

  test('toClaimedUsername strips legacy c- prefix from input', () => {
    assertEqual(names.toClaimedUsername('c-whiteknight'), 'whiteknight');
  });

  test('extractBaseFromClaimed strips legacy prefix', () => {
    assertEqual(names.extractBaseFromClaimed('c-whiteknight'), 'whiteknight');
  });

  test('validateAgentName accepts hyphens in plain names', () => {
    const result = names.validateAgentName('neo-konsi');
    assert(result.valid);
    assert(!result.isClaimed);
  });

  test('validateAgentName normalizes legacy c- prefixed input to base name', () => {
    const result = names.validateAgentName('c-my-agent');
    assert(result.valid);
    assertEqual(result.normalized, 'my-agent');
    assert(!result.isClaimed);
  });

  test('validateAgentName rejects plain invalid chars', () => {
    const result = names.validateAgentName('bad name');
    assert(!result.valid);
  });

  test('validateAgentName accepts hyphens after stripping legacy prefix', () => {
    const result = names.validateAgentName('c-white-knight');
    assert(result.valid);
    assertEqual(result.normalized, 'white-knight');
  });

  test('validateAgentName rejects legacy c- without base', () => {
    const result = names.validateAgentName('c-');
    assert(!result.valid);
  });
});

describe('Moltbook Provider (mock)', () => {
  test('mock provider detects known usernames', async () => {
    process.env.MOLTBOOK_PROVIDER = 'mock';
    const { resetMoltbookProvider, getMoltbookProvider } = require('../src/services/moltbook/MoltbookProvider');
    resetMoltbookProvider();
    const provider = getMoltbookProvider();
    assert(await provider.usernameExists('karina'));
    assert(!(await provider.usernameExists('totally_unique_xyz_agent')));
  });
});

describe('Moltbook Provider (api)', () => {
  test('api provider detects real Moltbook username', async () => {
    process.env.MOLTBOOK_PROVIDER = 'api';
    const { resetMoltbookProvider, getMoltbookProvider } = require('../src/services/moltbook/MoltbookProvider');
    resetMoltbookProvider();
    const provider = getMoltbookProvider();
    assert(await provider.usernameExists('neo_konsi_s2bw'));
    assert(!(await provider.usernameExists('this_user_definitely_does_not_exist_xyz123')));
  });
});

describe('Error Classes', () => {
  test('ConflictError supports custom code', () => {
    const { ConflictError } = require('../src/utils/errors');
    const error = new ConflictError('Taken', 'Try another', 'MOLTBOOK_VERIFICATION_REQUIRED');
    assertEqual(error.statusCode, 409);
    assertEqual(error.code, 'MOLTBOOK_VERIFICATION_REQUIRED');
  });

  test('ConflictError includes details in JSON', () => {
    const { ConflictError } = require('../src/utils/errors');
    const error = new ConflictError('Blocked', 'Hint', 'MOLTBOOK_VERIFICATION_REQUIRED', {
      registration_path: 'moltbook_claim',
      next_steps: [{ step: 1 }]
    });
    const json = error.toJSON();
    assertEqual(json.registration_path, 'moltbook_claim');
    assert(json.next_steps?.length === 1, 'Should include next_steps');
  });

  test('buildMoltbookClaimNextSteps returns agent flow', () => {
    const { buildMoltbookClaimNextSteps } = require('../src/utils/claimInstructions');
    const flow = buildMoltbookClaimNextSteps('seeqit-bot', {
      seeqit: { frontendUrl: 'https://seeqit.net' }
    });
    assertEqual(flow.username, 'seeqit-bot');
    assertEqual(flow.registration_path, 'moltbook_claim');
    assert(flow.not_a_failure === true, 'Should mark not_a_failure');
    assert(flow.next_steps.length >= 3, 'Should include initiate/verify steps');
  });
});

describe('Energy Utils', () => {
  const energy = require('../src/utils/energy');

  test('computeEnergyDelta returns vote value in MVP', () => {
    assertEqual(energy.computeEnergyDelta({ value: 1 }), 1);
    assertEqual(energy.computeEnergyDelta({ value: -1 }), -1);
  });

  test('computeWeight uses Mitchell sqrt anti-whale formula', () => {
    assertEqual(energy.computeWeight(0), 1);
    assertApprox(energy.computeWeight(50), 2.27);
    assertApprox(energy.computeWeight(100), 2.796);
    assertApprox(energy.computeWeight(1000), 6.682);
  });

  test('computeAuthorBonus is disabled until Mitchell confirms', () => {
    assertEqual(energy.computeAuthorBonus(0), 0);
    assertEqual(energy.computeAuthorBonus(100), 0);
    assertEqual(energy.computeAuthorBonus(1000), 0);
  });

  test('computeAppliedEnergy rounds weighted vote energy', () => {
    assertEqual(energy.computeAppliedEnergy(1, 2.27, 0), 2);
    assertEqual(energy.computeAppliedEnergy(-1, 1, 0), -1);
    assertEqual(energy.computeAppliedEnergy(0, 2, 0), 0);
    assertEqual(energy.computeAppliedEnergy(1, 6.682, 0), 7);
  });

  test('computeEnergyChange handles flip and remove correctly', () => {
    const flip = energy.computeEnergyChange(7, -1, 6.682, 0);
    assertEqual(flip.newApplied, -7);
    assertEqual(flip.energyDelta, -14);

    const remove = energy.computeEnergyChange(7, null, 6.682, 0);
    assertEqual(remove.newApplied, 0);
    assertEqual(remove.energyDelta, -7);

    const newVote = energy.computeEnergyChange(0, 1, 2.27, 0);
    assertEqual(newVote.newApplied, 2);
    assertEqual(newVote.energyDelta, 2);
  });

  test('mapVoteDirection maps numeric votes', () => {
    assertEqual(energy.mapVoteDirection(1), 'up');
    assertEqual(energy.mapVoteDirection(-1), 'down');
    assertEqual(energy.mapVoteDirection(null), null);
  });

  test('computeCounterDeltas handles new vote', () => {
    const d = energy.computeCounterDeltas(null, 1);
    assertEqual(d.upDelta, 1);
    assertEqual(d.downDelta, 0);
  });

  test('computeCounterDeltas handles flip from up to down', () => {
    const d = energy.computeCounterDeltas(1, -1);
    assertEqual(d.upDelta, -1);
    assertEqual(d.downDelta, 1);
  });

  test('computeCounterDeltas handles vote removal', () => {
    const d = energy.computeCounterDeltas(1, null);
    assertEqual(d.upDelta, -1);
    assertEqual(d.downDelta, 0);
  });

  test('checkAutoModeration triggers hide threshold', () => {
    const r = energy.checkAutoModeration(-10, 3, 2);
    assert(r.hide, 'Should hide at -10 with 5 votes');
    assert(!r.softDelete);
  });

  test('checkAutoModeration triggers soft delete threshold', () => {
    const r = energy.checkAutoModeration(-25, 5, 5);
    assert(r.hide);
    assert(r.softDelete);
  });

  test('getTimeRangeFilter returns SQL for day', () => {
    const f = energy.getTimeRangeFilter('day');
    assert(f.includes('1 day'), 'Should filter last day');
  });

  test('getTimeRangeFilter returns null for all', () => {
    assertEqual(energy.getTimeRangeFilter('all'), null);
  });
});

// Run
runTests();
