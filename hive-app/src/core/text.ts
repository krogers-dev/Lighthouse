/** Text rules shared by every free-text field a person types into a
 * protected row (an answer, a verdict note): the server refuses control
 * characters other than newline and tab, and counts characters as code
 * points. */

/** Removes what the server would refuse as a control character:
 * everything below space except newline and tab, and DEL. None of it is
 * visible, so nothing a person wrote is lost. */
export function stripControlCharacters(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 && code !== 0x0a && code !== 0x09) continue;
    if (code === 0x7f) continue;
    out += char;
  }
  return out;
}

/** Characters as the server counts them (code points, not UTF-16 units). */
export function codePointLength(text: string): number {
  return Array.from(text).length;
}

/** A count with thousands separators, without relying on the runtime's
 * locale tables ("4,000"). */
export function formatCount(value: number): string {
  const whole = Math.max(0, Math.floor(value));
  if (whole < 1000) return String(whole);
  return `${formatCount(Math.floor(whole / 1000))},${String(whole % 1000).padStart(3, '0')}`;
}
