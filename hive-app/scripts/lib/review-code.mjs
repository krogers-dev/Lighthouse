/** The review code (WO-008): twelve to twenty DIGITS, because a reviewer
 * types it where the sign-in code is typed (a number pad); sixteen when
 * generated here. It lives in a file outside the repository and is never
 * printed by any tool. */
import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const REVIEW_CODE_PATTERN = /^[0-9]{12,20}$/;

export function generateReviewCode() {
  let code = '';
  while (code.length < 16) code += String(randomInt(0, 10));
  return code;
}

/** Reads the code from the file and never creates one: for the check
 * that the code an operator is about to hand over really opens the door. */
export function loadReviewCode(file) {
  if (!file) throw new Error('HIVE_REVIEW_CODE_FILE names no file');
  if (!existsSync(file)) {
    throw new Error('no review code file there: open a review window first');
  }
  const code = readFileSync(file, 'utf8').trim();
  if (!REVIEW_CODE_PATTERN.test(code)) {
    throw new Error('the review code file must hold twelve to twenty digits');
  }
  return code;
}

/** Reads the code from the file, or generates one into it (mode 0600). */
export function loadOrCreateReviewCode(file, generate = generateReviewCode) {
  if (!file) throw new Error('HIVE_REVIEW_CODE_FILE names no file');
  if (existsSync(file)) {
    const code = readFileSync(file, 'utf8').trim();
    if (!REVIEW_CODE_PATTERN.test(code)) {
      throw new Error('the review code file must hold twelve to twenty digits');
    }
    return { code, created: false };
  }
  const code = generate();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${code}\n`, { mode: 0o600 });
  return { code, created: true };
}
