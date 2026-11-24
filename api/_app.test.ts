import test from 'node:test';
import assert from 'node:assert/strict';
import {
  issueTeacherSessionToken,
  verifyTeacherSessionToken,
} from './_app.ts';

test('stateless HMAC teacher token verifies cleanly across invocations', () => {
  const now = 1_750_000_000_000;
  const token = issueTeacherSessionToken(now);
  assert.equal(verifyTeacherSessionToken(token, now + 10_000), true);
});

test('stateless HMAC teacher token rejects tampered signature or payload', () => {
  const now = 1_750_000_000_000;
  const token = issueTeacherSessionToken(now);
  const [exp, nonce, sig] = token.split('.');
  const tamperedSig = (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);
  assert.equal(verifyTeacherSessionToken(`${exp}.${nonce}.${tamperedSig}`, now + 1000), false);
  assert.equal(verifyTeacherSessionToken(`${Number(exp) + 1}.${nonce}.${sig}`, now + 1000), false);
});

test('stateless HMAC teacher token rejects expired tokens', () => {
  const now = 1_750_000_000_000;
  const token = issueTeacherSessionToken(now);
  const thirteenHoursLater = now + 13 * 60 * 60 * 1000;
  assert.equal(verifyTeacherSessionToken(token, thirteenHoursLater), false);
});
