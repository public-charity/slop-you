// Photo slots shared by the browser checks and the API.
// Yaw ranges are absolute degrees: direction (left vs right) is not enforced
// because phone front cameras mirror inconsistently.

export type SlotId = "front" | "left" | "right" | "profile" | "extra";

export type Slot = {
  id: SlotId;
  label: string;
  hint: string;
  required: boolean;
  /** Expected |yaw| in degrees, or null to skip the pose check. */
  yaw: [number, number] | null;
};

export const SLOTS: Slot[] = [
  {
    id: "front",
    label: "Front",
    hint: "Look straight into the lens. Neutral face, mouth closed, no glasses.",
    required: true,
    yaw: [0, 12],
  },
  {
    id: "left",
    label: "Three-quarter left",
    hint: "Turn your head about 45° to your left. Keep your eyes open.",
    required: true,
    yaw: [20, 60],
  },
  {
    id: "right",
    label: "Three-quarter right",
    hint: "Turn your head about 45° to your right.",
    required: true,
    yaw: [20, 60],
  },
  {
    id: "profile",
    label: "Profile",
    hint: "Side-on, ear toward the camera. Optional, but it sharpens the nose and jaw.",
    required: false,
    yaw: null,
  },
  {
    id: "extra",
    label: "Extra",
    hint: "Any other clear, well-lit shot. More photos make the next build better.",
    required: false,
    yaw: null,
  },
];

export const SLOT_IDS = SLOTS.map((s) => s.id);

export function isSlotId(value: unknown): value is SlotId {
  return typeof value === "string" && (SLOT_IDS as string[]).includes(value);
}
