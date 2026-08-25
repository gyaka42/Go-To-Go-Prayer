import type { AppLanguage } from "@/i18n/translations";

export type FaithPerspective = "general_sunni" | "hanafi";
export type FaithOutcome =
  | "answer"
  | "clarification_needed"
  | "insufficient_sources"
  | "out_of_scope"
  | "qualified_referral";

export type FaithCitation = {
  id: string;
  sourceId: string;
  title: string;
  locator: string;
  url: string;
  sourceLanguage: string;
  sourceDate: string | null;
};

export type FaithRateLimit = {
  limit: number;
  remaining: number;
  resetAt: string;
};

export type FaithAnswer = {
  outcome: FaithOutcome;
  perspective: FaithPerspective;
  topicId: string | null;
  answer: string;
  citations: FaithCitation[];
  caveat: string | null;
  followUpQuestion: string | null;
  rateLimit: FaithRateLimit;
};

export type FaithHistoryItem = {
  id: string;
  question: string;
  language: AppLanguage;
  perspective: FaithPerspective;
  answer: FaithAnswer;
  createdAt: number;
};

export type FaithHealth = {
  enabled: boolean;
  ready: boolean;
  policyId: string;
  provider: string;
  dailyLimit: number | null;
};
