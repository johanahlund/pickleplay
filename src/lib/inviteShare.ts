/**
 * Shared invite-share helpers. Used by club invites, player invites,
 * and the global "invite a friend to the app" button.
 *
 * Every outbound invite message ends with a short "Add to Home Screen"
 * tip so recipients install the app as a PWA after signing in — one-tap
 * access from then on.
 */

/** Plain-text "Add to Home Screen" instructions appended to invites. */
export const ADD_TO_HOME_SCREEN_TIP = [
  "Tip: After signing in, add the app to your home screen for one-tap access.",
  "• iPhone: open the link in Safari → tap Share → Add to Home Screen.",
  "• Android: open in Chrome → tap the menu (⋮) → Add to Home Screen (or Install app).",
].join("\n");

/**
 * Wrap an invite message with the share boundary and the install tip.
 * Keep the boundary short so it pastes cleanly into WhatsApp etc.
 */
export function withInstallTip(message: string): string {
  return `${message}\n\n${ADD_TO_HOME_SCREEN_TIP}`;
}

/**
 * Build the app-level "invite a friend" message. No club/team context —
 * just a general invite to sign up.
 */
export function buildAppInviteMessage(opts: { inviterName: string; signupUrl: string }): string {
  const { inviterName, signupUrl } = opts;
  return withInstallTip(
    `${inviterName} invites you to join FriendlyBall — the app for organising pickleball play.\n\nSign up here: ${signupUrl}`,
  );
}
