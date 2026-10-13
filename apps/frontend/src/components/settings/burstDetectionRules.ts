import type { SavedBurstDetectionRule } from "@librephotos/api-client";

// Whether the list shows a rule as enabled: only with enabled set to true
export function isRuleEnabled(rule: SavedBurstDetectionRule): boolean {
  return rule.enabled === true;
}

// Helper to check if a rule is a hard criterion
export function isHardRule(rule: SavedBurstDetectionRule): boolean {
  return rule.category === "hard";
}
