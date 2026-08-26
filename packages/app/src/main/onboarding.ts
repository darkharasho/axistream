// The welcome banner and the setup wizard are for the brand-new user, so the
// decision to show them hangs off one thing only: whether a build has ever
// been onboarded away (`dismissWelcome` stamps the app version). It is
// deliberately NOT conditioned on capture being provisioned — a fresh install
// is unprovisioned by definition, and gating on that hid the welcome from the
// exact person it was built for until their second launch.
export const shouldShowWelcome = (onboardedVersion: string) => onboardedVersion === ''
