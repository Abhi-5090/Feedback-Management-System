/**
 * A deliberately LIGHTWEIGHT, non-identifying device hint for anti-duplicate
 * Layer 2. It is coarse on purpose — combined server-side with the httpOnly
 * cookie token + secret salt and then SHA-256 hashed, so it never identifies a
 * student. We don't use a tracking-grade fingerprint.
 */
export function lightweightFingerprint() {
  const parts = [
    navigator.userAgent,
    `${window.screen?.width}x${window.screen?.height}`,
    window.screen?.colorDepth,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.language,
  ];
  return parts.filter(Boolean).join('|').slice(0, 200);
}
