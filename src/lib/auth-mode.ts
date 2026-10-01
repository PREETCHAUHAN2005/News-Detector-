/**
 * Single switch for the login feature.
 *
 * The product decision for this phase: the workbench opens DIRECTLY without
 * any sign-in screen. The interface auto-establishes a demo reviewer session
 * (client-side auto sign-in) and every API route falls back to that same demo
 * reviewer when no session cookie is present, so the full BRD workflow
 * (analyze → review → appeal → audit) stays functional.
 *
 * To RE-ENABLE the login screen later, flip AUTH_LOGIN_ENABLED to `true` —
 * the sign-in view, the session gates and all 401 responses come back
 * automatically (no other code changes needed).
 *
 * This module is deliberately client-safe (no server imports) so both the
 * React components and the API routes can import the same flag.
 */
export const AUTH_LOGIN_ENABLED = false;

/**
 * Demo account used for the automatic session. These credentials are the
 * seeded one-click demo users shown on the (now disabled) sign-in screen —
 * they are public demo values, not production secrets.
 */
export const DEMO_AUTO_ACCOUNT = {
  email: "reviewer@veritas.io",
  password: "veritas123",
} as const;
