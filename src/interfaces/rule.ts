export interface ServerRule {
  name: string;
  /** HTML body explaining the rule (trusted: served from the SARP backend). */
  description: string;
  /** "|"-separated keywords; dashes stand in for spaces (SEO use). May be empty. */
  keywords: string;
  /** Truthy when the rule is hidden and must not be shown. */
  isdisabled?: boolean | number;
  /** "YYYY-MM-DD HH:mm:ss", UTC. */
  created_at: string;
  /** "YYYY-MM-DD HH:mm:ss", UTC. */
  updated_at: string;
}

export interface RulesResponse {
  generatedAt: string;
  data: ServerRule[];
}

/** A ServerRule enriched at build time with derived display fields. */
export interface DisplayRule extends ServerRule {
  /** Stable 1-based position, used for anchors (#regla-N) and numbering. */
  index: number;
  /** keywords normalized to a human/SEO string ("a-b|c" -> "a b, c"). */
  keywordList: string[];
}
