// DRAFT consent copy. Face geometry is biometric data (Illinois BIPA, Texas CUBI,
// GDPR Art. 9). Have a lawyer review this text and the retention policy before launch.
// Bump CONSENT_VERSION whenever the wording changes; avatars record the version they agreed to.

export const CONSENT_VERSION = "2026-09-25-draft";

export const CONSENT_ITEMS = [
  {
    id: "ownFace",
    text: "Every photo I upload is of me. I won't upload anyone else's face.",
  },
  {
    id: "adult",
    text: "I'm 18 or older.",
  },
  {
    id: "biometric",
    text: "I agree that slop.you may process my face geometry (biometric data) only to build and improve my avatar.",
  },
  {
    id: "deletion",
    text: "I understand I can delete my photos and avatars at any time, and that deleting removes them from slop.you's storage.",
  },
] as const;

export type ConsentId = (typeof CONSENT_ITEMS)[number]["id"];

export function isCompleteConsent(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return CONSENT_ITEMS.every((item) => record[item.id] === true);
}
