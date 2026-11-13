/**
 * Secret & token redaction utilities for AniScroll Admin Console.
 * Guarantees API keys, auth tokens, passwords, cookies, and signed stream tokens
 * are never persisted in errorLogs/activityLogs or exposed in diagnostic previews.
 */

const SECRET_KEY_PATTERN =
  /^(password|passwd|secret|token|idtoken|access_token|refresh_token|apikey|api_key|private_key|client_secret|authorization|cookie|set-cookie|service_role|signature|sig|hmac)$/i;

/**
 * Redacts sensitive secrets, bearer tokens, Google/Firebase/Supabase keys,
 * and query-string auth parameters from arbitrary diagnostic strings.
 */
export function redactSensitiveText(input: unknown, maxLen = 1024): string {
  if (typeof input !== 'string') {
    if (input === null || input === undefined) return '';
    try {
      input = String(input);
    } catch {
      return '';
    }
  }

  let text = input as string;

  // Redact Bearer / Basic authorization tokens
  text = text.replace(
    /\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi,
    '$1 [REDACTED]'
  );

  // Redact JWT tokens (header.payload.signature)
  text = text.replace(
    /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g,
    '[REDACTED_JWT]'
  );

  // Redact Google / Firebase API keys (AIza...)
  text = text.replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED_API_KEY]');

  // Redact PEM private keys
  text = text.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    '[REDACTED_PRIVATE_KEY]'
  );

  // Redact sensitive URL query params (token, key, api_key, sig, signature, auth, password, secret)
  text = text.replace(
    /([?&](?:token|key|api_key|apikey|sig|signature|auth|password|secret|access_token|refresh_token|expires|hdntl)=)([^&\s]+)/gi,
    '$1[REDACTED]'
  );

  // Redact key=value / key:value patterns in error messages
  text = text.replace(
    /\b(password|passwd|secret|api_key|apikey|private_key|authorization)\s*[:=]\s*['"]?([^\s'",;]+)['"]?/gi,
    '$1=[REDACTED]'
  );

  return text.trim().slice(0, maxLen);
}

/**
 * Sanitizes stream or upstream URLs for admin inspection:
 * preserves protocol, host, and pathname while redacting sensitive query tokens.
 */
export function sanitizeDiagnosticUrl(rawUrl: unknown): string {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return '';
  const trimmed = rawUrl.trim();
  try {
    const u = new URL(trimmed);
    const sensitiveParams = [
      'token',
      'key',
      'api_key',
      'apikey',
      'sig',
      'signature',
      'auth',
      'access_token',
      'refresh_token',
      'hdntl',
      'expires',
      'password',
      'secret',
    ];
    for (const p of sensitiveParams) {
      if (u.searchParams.has(p)) {
        u.searchParams.set(p, 'REDACTED');
      }
    }
    return u.toString().slice(0, 512);
  } catch {
    return redactSensitiveText(trimmed, 512);
  }
}

/**
 * Recursively strips/redacts secret keys and sensitive strings from any JSON-like diagnostic object.
 */
export function sanitizeDiagnosticPayload(
  value: unknown,
  depth = 0
): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) {
      return sanitizeDiagnosticUrl(value);
    }
    return redactSensitiveText(value, 600);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 30).map((item) => sanitizeDiagnosticPayload(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = sanitizeDiagnosticPayload(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}
