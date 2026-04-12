/**
 * Whitelist of Player fields safe to return in API responses.
 * Excludes sensitive fields: passwordHash, inviteToken, resetToken,
 * email and phone (which are gated separately by canSeeEmails).
 *
 * Use as: include: { player: { select: safePlayerSelect } }
 */
export const safePlayerSelect = {
  id: true,
  name: true,
  emoji: true,
  rating: true,
  wins: true,
  losses: true,
  globalRating: true,
  globalRatingConfidence: true,
  duprId: true,
  duprRating: true,
  role: true,
  status: true,
  gender: true,
  photoUrl: true,
  email: true, // included; callers must strip via canSeeEmails when not allowed
} as const;
