# Firestore Security Specification

## 1. Data Invariants
1. **Active Exam Visibility**: Unauthenticated students may only `get` or `list` documents in `/exams/{examId}` where `resource.data.isActive == true`. Hidden exams (`isActive == false`) are strictly restricted to verified teacher admins.
2. **Admin-Only Mutations**: Only verified teacher admins (`request.auth.token.email_verified == true` and either the bootstrapped teacher email `dchayan232@gmail.com` or an entry in `/admins/{uid}`) can create, update, or delete `/exams/{examId}` or access `/knowledge_bases/{subjectId}`.
3. **Immutable Audit Fields**: On `/exams/{examId}`, `id`, `createdBy`, and `createdAt` are strictly immutable after creation, and `createdAt` / `updatedAt` must equal `request.time`.
4. **Strict Key & Volumetric Boundaries**: Every write enforces `hasAll` + `hasOnly` (on create) and `affectedKeys().hasOnly(...)` (on update), validates string lengths matching `firebase-blueprint.json`, validates document IDs via `^[a-zA-Z0-9_\-]+$`, and bounds `questions` list size to `1..60`.
5. **PII Isolation**: `/admins/{uid}` contains teacher emails and is strictly restricted to `request.auth.uid == uid` or `isAdmin()` on `get`, with `list` explicitly denied.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Exam Create**: Anonymous caller tries to create `/exams/fake-1` -> DENIED.
2. **Student Reading Hidden Exam**: Unauthenticated caller tries to `get` `/exams/hidden-1` where `isActive == false` -> DENIED.
3. **Student Blanket Listing All Exams**: Unauthenticated caller queries `/exams` without `where('isActive', '==', true)` -> DENIED.
4. **Email Spoofing (Unverified Email)**: Caller with `email: 'dchayan232@gmail.com'` and `email_verified: false` tries to write `/exams/spoof-1` -> DENIED.
5. **Shadow Ghost Field Injection**: Admin creates `/exams/exam-1` with extra field `isAdminBypass: true` -> DENIED (`hasOnly` check).
6. **ID Poisoning**: Admin creates `/exams/bad id with spaces and $$$` or >128-char ID -> DENIED (`isValidId`).
7. **Identity Spoofing on Create**: Admin creates `/exams/exam-2` with `createdBy: "someone-else-uid"` instead of `request.auth.uid` -> DENIED.
8. **Immutable Field Tampering**: Admin updates `/exams/exam-1` attempting to modify `createdAt` or `createdBy` -> DENIED.
9. **Client Timestamp Forgery**: Admin creates `/exams/exam-3` with backdated `createdAt` != `request.time` -> DENIED.
10. **Invalid Subject Enum / Oversized Title**: Admin creates `/exams/exam-4` with `subject: "History"` or 500-char `examTitle` -> DENIED.
11. **Array Exhaustion / Invalid Questions Payload**: Admin creates `/exams/exam-5` with `questions: []` or `questions.size() > 60` or non-map first element -> DENIED.
12. **Self-Assigned Admin Escalation & PII Scraping**: Non-admin authenticated user attempts to write `/admins/{theirUid}` or list `/admins` or read `/knowledge_bases/Physics` -> DENIED.
