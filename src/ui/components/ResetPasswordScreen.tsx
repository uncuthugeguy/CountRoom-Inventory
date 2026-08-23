// Removed: CountRoom no longer supports password sign-in, so there is no
// password to reset. Magic link is the only sign-in method (see
// AuthScreen.tsx); every session is then walked through mandatory TOTP
// enrollment/verification (see MfaEnrollScreen.tsx / MfaChallengeScreen.tsx).
// This file is kept as an empty stub because the sandbox this repo is edited
// in does not allow deleting files — App.tsx no longer imports it.
export {}
