export const APPROVAL_POSTURES = [
  "always_auto",
  "ask_once",
  "ask_every_time",
  "draft_only",
  "never",
] as const;

export type ApprovalPosture = (typeof APPROVAL_POSTURES)[number];

export function resolveApprovalPostureFromText(brief: string): ApprovalPosture | null {
  if (
    /\b(draft only|draft-first|only draft|prepare drafts only|respond with drafts only)\b/i.test(
      brief,
    )
  ) {
    return "draft_only";
  }
  if (/\b(never auto(?:matically)?|never act|never send|do not act|don't act)\b/i.test(brief)) {
    return "never";
  }
  if (
    /\b(ask every time|always ask|confirm every time|approve each time|approval each time)\b/i.test(
      brief,
    )
  ) {
    return "ask_every_time";
  }
  if (/\b(ask once|approve once|allow once|confirm once|first time only)\b/i.test(brief)) {
    return "ask_once";
  }
  if (
    /\b(always auto|approve automatically|auto(?:matically)? approve|without asking|no approval needed|auto-run)\b/i.test(
      brief,
    )
  ) {
    return "always_auto";
  }
  return null;
}

export function formatApprovalPostureLabel(posture: ApprovalPosture): string {
  switch (posture) {
    case "always_auto":
      return "Always Auto";
    case "ask_once":
      return "Ask Once";
    case "ask_every_time":
      return "Ask Every Time";
    case "draft_only":
      return "Draft Only";
    case "never":
      return "Never";
  }
}
