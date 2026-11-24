import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rulesContent = fs.readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');

test('firestore.rules enforces rules_version 2 and global default-deny safety net', () => {
  assert.match(rulesContent, /rules_version\s*=\s*'2';/);
  assert.match(rulesContent, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);
});

test('firestore.rules covers all 3 collections from firebase-blueprint.json', () => {
  assert.match(rulesContent, /match \/exams\/\{examId\}/);
  assert.match(rulesContent, /match \/knowledge_bases\/\{subjectId\}/);
  assert.match(rulesContent, /match \/admins\/\{uid\}/);
});

test('firestore.rules blocks unverified email spoofing and enforces verified teacher admin', () => {
  assert.match(rulesContent, /request\.auth\.token\.email_verified == true/);
  assert.match(rulesContent, /request\.auth\.token\.email == 'dchayan232@gmail\.com'/);
});

test('firestore.rules enforces strict key allowlists, ID regex, immutable audit fields, and server timestamps', () => {
  assert.match(rulesContent, /id\.matches\('\^\[a-zA-Z0-9_\\\\-\]\+\$'\)/);
  assert.match(rulesContent, /data\.keys\(\)\.hasAll\(/);
  assert.match(rulesContent, /data\.keys\(\)\.hasOnly\(/);
  assert.match(rulesContent, /affectedKeys\(\)\.hasOnly\(/);
  assert.match(rulesContent, /incoming\(\)\.createdAt == request\.time/);
  assert.match(rulesContent, /incoming\(\)\.updatedAt == request\.time/);
  assert.match(rulesContent, /incoming\(\)\.createdBy == existing\(\)\.createdBy/);
  assert.match(rulesContent, /incoming\(\)\.createdAt == existing\(\)\.createdAt/);
});

test('firestore.rules enforces student read restriction to active exams and denies admin list PII scraping', () => {
  assert.match(rulesContent, /allow list: if existing\(\)\.isActive == true \|\| isBootstrappedAdmin\(\);/);
  assert.match(rulesContent, /match \/admins\/\{uid\}[\s\S]*allow list: if false;/);
});
