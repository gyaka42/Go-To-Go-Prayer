import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { AppBackground } from "@/components/AppBackground";
import { StatusChip } from "@/components/StatusChip";
import { useI18n } from "@/i18n/I18nProvider";
import { askFaithAssistant, FaithAssistantError, getFaithHealth } from "@/services/faithAssistant";
import {
  clearFaithHistory,
  getFaithHistory,
  removeFaithHistoryItem,
  saveFaithHistoryItem
} from "@/services/storage";
import { useAppTheme } from "@/theme/ThemeProvider";
import { FaithAnswer, FaithHealth, FaithHistoryItem, FaithOutcome, FaithPerspective } from "@/types/faith";

type Availability = "checking" | "ready" | "unavailable" | "error";
type FaithUiError = { key: string; params?: Record<string, string | number> };

const MAX_QUESTION_LENGTH = 800;

export default function FaithAssistantScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, resolvedTheme } = useAppTheme();
  const { t, language, localeTag } = useI18n();
  const isLight = resolvedTheme === "light";
  const [availability, setAvailability] = useState<Availability>("checking");
  const [health, setHealth] = useState<FaithHealth | null>(null);
  const [question, setQuestion] = useState("");
  const [perspective, setPerspective] = useState<FaithPerspective>("general_sunni");
  const [answer, setAnswer] = useState<FaithAnswer | null>(null);
  const [history, setHistory] = useState<FaithHistoryItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<FaithUiError | null>(null);

  const checkAvailability = useCallback(async () => {
    setAvailability("checking");
    try {
      const status = await getFaithHealth();
      setHealth(status);
      setAvailability(status.ready ? "ready" : "unavailable");
    } catch {
      setHealth(null);
      setAvailability("error");
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([getFaithHistory(), getFaithHealth()])
      .then(([savedHistory, status]) => {
        if (!active) return;
        setHistory(savedHistory);
        setHealth(status);
        setAvailability(status.ready ? "ready" : "unavailable");
      })
      .catch(async () => {
        if (!active) return;
        setHistory(await getFaithHistory());
        setAvailability("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const latestRateLimit = answer?.rateLimit ?? history[0]?.answer.rateLimit ?? null;
  const canSubmit =
    availability === "ready" && question.trim().length >= 3 && !isSubmitting;

  const quotaLabel = useMemo(() => {
    if (latestRateLimit) {
      const remaining = t("faith.quota_remaining", {
        remaining: latestRateLimit.remaining,
        limit: latestRateLimit.limit
      });
      return `${remaining} • ${t("faith.quota_reset", {
        time: formatFaithDateTime(latestRateLimit.resetAt, localeTag)
      })}`;
    }
    if (health?.dailyLimit) {
      return t("faith.quota_daily", { limit: health.dailyLimit });
    }
    return null;
  }, [health?.dailyLimit, latestRateLimit, localeTag, t]);

  const submit = useCallback(async () => {
    const normalizedQuestion = question.trim();
    if (normalizedQuestion.length < 3 || isSubmitting || availability !== "ready") return;

    setIsSubmitting(true);
    setRequestError(null);
    setAnswer(null);
    try {
      const response = await askFaithAssistant({
        question: normalizedQuestion,
        language,
        perspective
      });
      const item: FaithHistoryItem = {
        id: `faith-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
        question: normalizedQuestion,
        language,
        perspective,
        answer: response,
        createdAt: Date.now()
      };
      setAnswer(response);
      setHistory((current) => [item, ...current.filter((row) => row.id !== item.id)].slice(0, 20));
      await saveFaithHistoryItem(item);
    } catch (error) {
      const presentation = errorPresentation(error, localeTag);
      setRequestError(presentation);
      if (presentation.key === "faith.error_unavailable") {
        setAvailability("unavailable");
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [availability, isSubmitting, language, localeTag, perspective, question]);

  const openHistoryItem = useCallback((item: FaithHistoryItem) => {
    setQuestion(item.question);
    setPerspective(item.perspective);
    setAnswer(item.answer);
    setRequestError(null);
  }, []);

  const deleteHistoryItem = useCallback(async (id: string) => {
    setHistory((current) => current.filter((item) => item.id !== id));
    await removeFaithHistoryItem(id);
  }, []);

  const confirmClearHistory = useCallback(() => {
    Alert.alert(t("faith.history_clear_title"), t("faith.history_clear_body"), [
      { text: t("faith.cancel"), style: "cancel" },
      {
        text: t("faith.history_clear"),
        style: "destructive",
        onPress: () => {
          setHistory([]);
          void clearFaithHistory();
        }
      }
    ]);
  }, [t]);

  const useFollowUp = useCallback(() => {
    if (!answer?.followUpQuestion) return;
    setQuestion(answer.followUpQuestion);
    setAnswer(null);
    setRequestError(null);
  }, [answer?.followUpQuestion]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <AppBackground />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={8}
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <Pressable
              onPress={() => router.back()}
              style={[styles.iconButton, { borderColor: colors.cardBorder, backgroundColor: colors.card }]}
              accessibilityRole="button"
              accessibilityLabel={t("faith.back")}
            >
              <Ionicons name="chevron-back" size={23} color={colors.textPrimary} />
            </Pressable>
            <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1} adjustsFontSizeToFit>
              {t("faith.title")}
            </Text>
            <View style={styles.headerBalance} />
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 38 }]}
          >
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t("faith.subtitle")}</Text>

            <AvailabilityBanner
              availability={availability}
              quotaLabel={quotaLabel}
              onRetry={() => void checkAvailability()}
            />

            <View style={[styles.privacyBand, { backgroundColor: colors.accentSoft }]}>
              <Ionicons name="lock-closed-outline" size={17} color={colors.accent} />
              <View style={styles.flex}>
                <Text style={[styles.privacyTitle, { color: colors.textPrimary }]}>{t("faith.privacy_title")}</Text>
                <Text style={[styles.privacyBody, { color: colors.textSecondary }]}>{t("faith.privacy_body")}</Text>
              </View>
            </View>

            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t("faith.perspective_title")}</Text>
            <View style={[styles.segmented, { backgroundColor: isLight ? "#E6EEF7" : "#102235" }]}>
              {(["general_sunni", "hanafi"] as FaithPerspective[]).map((value) => {
                const selected = perspective === value;
                return (
                  <Pressable
                    key={value}
                    style={[styles.segment, selected && { backgroundColor: colors.accent }]}
                    onPress={() => setPerspective(value)}
                    disabled={isSubmitting}
                  >
                    <Text style={[styles.segmentText, { color: selected ? "#FFFFFF" : colors.textPrimary }]}>
                      {t(value === "hanafi" ? "faith.perspective_hanafi" : "faith.perspective_general")}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={[styles.composer, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <View style={styles.composerHeader}>
                <Text style={[styles.composerLabel, { color: colors.textPrimary }]}>{t("faith.question_label")}</Text>
                <Text style={[styles.characterCount, { color: colors.textSecondary }]}>
                  {question.length}/{MAX_QUESTION_LENGTH}
                </Text>
              </View>
              <TextInput
                value={question}
                onChangeText={setQuestion}
                placeholder={t("faith.question_placeholder")}
                placeholderTextColor={isLight ? "#76899E" : "#7087A0"}
                multiline
                maxLength={MAX_QUESTION_LENGTH}
                editable={!isSubmitting}
                textAlignVertical="top"
                returnKeyType="default"
                style={[
                  styles.input,
                  {
                    color: colors.textPrimary,
                    borderColor: colors.cardBorder,
                    backgroundColor: isLight ? "#F8FBFF" : "#0D1D2E"
                  }
                ]}
              />
              <Pressable
                style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
                onPress={() => void submit()}
                disabled={!canSubmit}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Ionicons name="send" size={18} color="#FFFFFF" />
                )}
                <Text style={styles.submitText}>
                  {t(isSubmitting ? "faith.sending" : "faith.send")}
                </Text>
              </Pressable>
            </View>

            {requestError ? (
              <View style={[styles.errorBand, { borderColor: isLight ? "#F4B6B9" : "#71363B" }]}>
                <Ionicons name="alert-circle-outline" size={20} color="#D94A51" />
                <Text style={[styles.errorText, { color: colors.textPrimary }]}>
                  {t(requestError.key, requestError.params)}
                </Text>
              </View>
            ) : null}

            {answer ? (
              <AnswerSection
                answer={answer}
                onUseFollowUp={useFollowUp}
                onNewQuestion={() => {
                  setQuestion("");
                  setAnswer(null);
                  setRequestError(null);
                }}
              />
            ) : null}

            <View style={styles.historyHeader}>
              <View style={styles.flex}>
                <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{t("faith.history_title")}</Text>
                <Text style={[styles.historySubtitle, { color: colors.textSecondary }]}>
                  {t("faith.history_device_only")}
                </Text>
              </View>
              {history.length > 0 ? (
                <Pressable onPress={confirmClearHistory} style={styles.textButton}>
                  <Ionicons name="trash-outline" size={16} color="#D94A51" />
                  <Text style={styles.clearText}>{t("faith.history_clear")}</Text>
                </Pressable>
              ) : null}
            </View>

            {history.length === 0 ? (
              <View style={[styles.emptyHistory, { borderColor: colors.cardBorder }]}>
                <Ionicons name="chatbubbles-outline" size={24} color={colors.textSecondary} />
                <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>{t("faith.history_empty_title")}</Text>
                <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>{t("faith.history_empty_body")}</Text>
              </View>
            ) : (
              history.map((item) => (
                <HistoryRow
                  key={item.id}
                  item={item}
                  localeTag={localeTag}
                  onOpen={() => openHistoryItem(item)}
                  onDelete={() => void deleteHistoryItem(item.id)}
                />
              ))
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function AvailabilityBanner({
  availability,
  quotaLabel,
  onRetry
}: {
  availability: Availability;
  quotaLabel: string | null;
  onRetry: () => void;
}) {
  const { colors } = useAppTheme();
  const { t } = useI18n();
  const content = {
    checking: { label: t("faith.status_checking"), tone: "loading" as const, body: t("faith.status_checking_body") },
    ready: { label: t("faith.status_ready"), tone: "success" as const, body: quotaLabel || t("faith.status_ready_body") },
    unavailable: { label: t("faith.status_unavailable"), tone: "warning" as const, body: t("faith.status_unavailable_body") },
    error: { label: t("faith.status_error"), tone: "error" as const, body: t("faith.status_error_body") }
  }[availability];

  return (
    <View style={styles.availabilityRow}>
      <StatusChip label={content.label} tone={content.tone} />
      <Text style={[styles.availabilityBody, { color: colors.textSecondary }]}>{content.body}</Text>
      {availability === "error" || availability === "unavailable" ? (
        <Pressable onPress={onRetry} style={styles.retryButton}>
          <Ionicons name="refresh" size={16} color={colors.accent} />
          <Text style={[styles.retryText, { color: colors.accent }]}>{t("faith.retry")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function AnswerSection({
  answer,
  onUseFollowUp,
  onNewQuestion
}: {
  answer: FaithAnswer;
  onUseFollowUp: () => void;
  onNewQuestion: () => void;
}) {
  const { colors } = useAppTheme();
  const { t } = useI18n();
  const outcome = outcomePresentation(answer.outcome, answer.topicId, t);
  const openSource = useCallback(
    async (url: string) => {
      try {
        await Linking.openURL(url);
      } catch {
        Alert.alert(t("faith.source_open_error_title"), t("faith.source_open_error_body"));
      }
    },
    [t]
  );

  return (
    <View style={styles.answerSection}>
      <View style={styles.answerHeadingRow}>
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{t("faith.answer_title")}</Text>
        <StatusChip label={outcome.label} tone={outcome.tone} />
      </View>
      <View style={[styles.answerCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
        <Text style={[styles.perspectiveCaption, { color: colors.accent }]}>
          {t(answer.perspective === "hanafi" ? "faith.perspective_hanafi" : "faith.perspective_general")}
        </Text>
        <Text style={[styles.answerText, { color: colors.textPrimary }]} selectable>
          {answer.answer}
        </Text>
      </View>

      {answer.caveat ? (
        <View style={[styles.noteBand, { backgroundColor: colors.accentSoft }]}>
          <Ionicons name="information-circle-outline" size={19} color={colors.accent} />
          <View style={styles.flex}>
            <Text style={[styles.noteTitle, { color: colors.textPrimary }]}>{t("faith.caveat_title")}</Text>
            <Text style={[styles.noteBody, { color: colors.textSecondary }]}>{answer.caveat}</Text>
          </View>
        </View>
      ) : null}

      {answer.followUpQuestion ? (
        <View style={[styles.followUp, { borderColor: colors.cardBorder }]}>
          <Text style={[styles.noteTitle, { color: colors.textPrimary }]}>{t("faith.follow_up_title")}</Text>
          <Text style={[styles.noteBody, { color: colors.textSecondary }]}>{answer.followUpQuestion}</Text>
          <Pressable style={styles.inlineCommand} onPress={onUseFollowUp}>
            <Ionicons name="arrow-up-circle-outline" size={17} color={colors.accent} />
            <Text style={[styles.inlineCommandText, { color: colors.accent }]}>{t("faith.use_follow_up")}</Text>
          </Pressable>
        </View>
      ) : null}

      {answer.citations.length > 0 ? (
        <View style={styles.sourcesSection}>
          <Text style={[styles.sectionTitleSmall, { color: colors.textPrimary }]}>{t("faith.sources_title")}</Text>
          {answer.citations.map((citation) => (
            <Pressable
              key={citation.id}
              style={[styles.sourceRow, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
              onPress={() => void openSource(citation.url)}
              accessibilityRole="link"
            >
              <View style={[styles.sourceIcon, { backgroundColor: colors.accentSoft }]}>
                <Ionicons name="document-text-outline" size={18} color={colors.accent} />
              </View>
              <View style={styles.flex}>
                <Text style={[styles.sourceTitle, { color: colors.textPrimary }]}>{citation.title}</Text>
                {citation.locator ? (
                  <Text style={[styles.sourceLocator, { color: colors.textSecondary }]}>{citation.locator}</Text>
                ) : null}
              </View>
              <Ionicons name="open-outline" size={17} color={colors.accent} />
            </Pressable>
          ))}
        </View>
      ) : null}

      <Pressable style={[styles.secondaryButton, { borderColor: colors.cardBorder }]} onPress={onNewQuestion}>
        <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
        <Text style={[styles.secondaryButtonText, { color: colors.accent }]}>{t("faith.new_question")}</Text>
      </Pressable>
    </View>
  );
}

function HistoryRow({
  item,
  localeTag,
  onOpen,
  onDelete
}: {
  item: FaithHistoryItem;
  localeTag: string;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { colors } = useAppTheme();
  const { t } = useI18n();
  const date = new Intl.DateTimeFormat(localeTag, { dateStyle: "medium", timeStyle: "short" }).format(item.createdAt);
  return (
    <View style={[styles.historyRow, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      <Pressable style={styles.historyOpen} onPress={onOpen}>
        <View style={styles.historyTopRow}>
          <Text style={[styles.historyPerspective, { color: colors.accent }]}>
            {t(item.perspective === "hanafi" ? "faith.perspective_hanafi" : "faith.perspective_general")}
          </Text>
          <Text style={[styles.historyDate, { color: colors.textSecondary }]}>{date}</Text>
        </View>
        <Text style={[styles.historyQuestion, { color: colors.textPrimary }]} numberOfLines={2}>
          {item.question}
        </Text>
        <Text style={[styles.historyAnswer, { color: colors.textSecondary }]} numberOfLines={2}>
          {item.answer.answer}
        </Text>
      </Pressable>
      <Pressable onPress={onDelete} style={styles.deleteButton} accessibilityLabel={t("faith.history_delete")}>
        <Ionicons name="trash-outline" size={18} color="#D94A51" />
      </Pressable>
    </View>
  );
}

function outcomePresentation(
  outcome: FaithOutcome,
  topicId: string | null,
  t: (key: string) => string
): { label: string; tone: "success" | "info" | "warning" | "error" } {
  if (outcome === "answer") return { label: t("faith.outcome_answer"), tone: "success" };
  if (outcome === "clarification_needed") return { label: t("faith.outcome_clarification"), tone: "info" };
  if (outcome === "qualified_referral") {
    if (topicId === "self_harm_abuse_emergency") {
      return { label: t("faith.outcome_emergency"), tone: "error" };
    }
    if (
      topicId === "criminal_violence_extremism" ||
      topicId === "political_mobilisation" ||
      topicId === "takfir_or_judging_people"
    ) {
      return { label: t("faith.outcome_safety"), tone: "warning" };
    }
    return { label: t("faith.outcome_referral"), tone: "warning" };
  }
  if (outcome === "out_of_scope") return { label: t("faith.outcome_scope"), tone: "warning" };
  return { label: t("faith.outcome_sources"), tone: "warning" };
}

function errorPresentation(error: unknown, localeTag: string): FaithUiError {
  if (!(error instanceof FaithAssistantError)) return { key: "faith.error_generic" };

  if (error.code === "faith_install_daily_limit") {
    return error.resetAt
      ? { key: "faith.error_daily_limit", params: { time: formatFaithDateTime(error.resetAt, localeTag) } }
      : { key: "faith.error_daily_limit_no_time" };
  }
  if (error.code === "faith_ip_daily_limit" || error.code === "faith_global_daily_limit") {
    return error.resetAt
      ? { key: "faith.error_service_daily_limit", params: { time: formatFaithDateTime(error.resetAt, localeTag) } }
      : { key: "faith.error_service_daily_limit_no_time" };
  }
  if (
    error.code === "faith_install_minute_limit" ||
    error.code === "faith_ip_minute_limit" ||
    error.code === "faith_global_minute_limit" ||
    error.code === "groq_rate_limited" ||
    error.status === 429
  ) {
    return { key: "faith.error_busy", params: { seconds: error.retryAfterSeconds ?? 60 } };
  }
  if (
    error.code === "faith_assistant_disabled" ||
    error.code === "faith_provider_not_configured" ||
    error.code === "faith_abuse_protection_not_configured" ||
    error.code === "faith_sources_not_ready" ||
    error.code === "groq_not_configured"
  ) {
    return { key: "faith.error_unavailable" };
  }
  if (error.code === "groq_timeout" || error.status === 504) return { key: "faith.error_timeout" };
  if (
    error.code === "groq_unavailable" ||
    error.code === "groq_network_error" ||
    error.code === "groq_auth_failed" ||
    error.code === "groq_request_rejected"
  ) {
    return { key: "faith.error_provider" };
  }
  if (error.status === 0) return { key: "faith.error_network" };
  if (
    error.code === "faith_invalid_response" ||
    error.code === "groq_empty_response" ||
    error.code === "groq_invalid_json"
  ) {
    return { key: "faith.error_invalid_response" };
  }
  if (error.status === 400 || error.status === 413 || error.status === 415) {
    return { key: "faith.error_invalid_request" };
  }
  if (error.status === 502 || error.status === 503) return { key: "faith.error_provider" };
  return { key: "faith.error_generic" };
}

function formatFaithDateTime(value: string, localeTag: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat(localeTag, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1 },
  container: { flex: 1, width: "100%", maxWidth: 860, alignSelf: "center", paddingHorizontal: 20 },
  header: { height: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  iconButton: { width: 42, height: 42, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  headerBalance: { width: 42 },
  title: { flex: 1, textAlign: "center", fontSize: 24, fontWeight: "800", paddingHorizontal: 10 },
  scrollContent: { paddingTop: 8 },
  subtitle: { fontSize: 14, lineHeight: 20, marginBottom: 12 },
  availabilityRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  availabilityBody: { flexShrink: 1, fontSize: 12, lineHeight: 17 },
  retryButton: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4 },
  retryText: { fontSize: 13, fontWeight: "700" },
  privacyBand: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderRadius: 12, marginBottom: 18 },
  privacyTitle: { fontSize: 14, fontWeight: "800" },
  privacyBody: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  sectionLabel: { fontSize: 12, fontWeight: "800", textTransform: "uppercase", marginBottom: 7 },
  segmented: { flexDirection: "row", borderRadius: 10, padding: 3, marginBottom: 12 },
  segment: { flex: 1, minHeight: 40, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  segmentText: { fontSize: 13, fontWeight: "800", textAlign: "center" },
  composer: { borderWidth: 1, borderRadius: 16, padding: 13 },
  composerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  composerLabel: { fontSize: 17, fontWeight: "800" },
  characterCount: { fontSize: 11, fontVariant: ["tabular-nums"] },
  input: { minHeight: 112, maxHeight: 210, borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16, lineHeight: 22 },
  submitButton: { minHeight: 48, marginTop: 10, borderRadius: 10, backgroundColor: "#2B8CEE", flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" },
  submitButtonDisabled: { opacity: 0.45 },
  submitText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  errorBand: { marginTop: 12, borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "flex-start", gap: 9, backgroundColor: "rgba(217,74,81,0.08)" },
  errorText: { flex: 1, fontSize: 13, lineHeight: 19 },
  answerSection: { marginTop: 22 },
  answerHeadingRow: { alignItems: "flex-start", gap: 7, marginBottom: 9 },
  sectionTitle: { fontSize: 20, fontWeight: "800" },
  sectionTitleSmall: { fontSize: 16, fontWeight: "800", marginBottom: 8 },
  answerCard: { borderWidth: 1, borderRadius: 16, padding: 15 },
  perspectiveCaption: { fontSize: 12, fontWeight: "900", textTransform: "uppercase", marginBottom: 8 },
  answerText: { fontSize: 16, lineHeight: 24 },
  noteBand: { flexDirection: "row", alignItems: "flex-start", gap: 9, padding: 12, borderRadius: 12, marginTop: 10 },
  noteTitle: { fontSize: 14, fontWeight: "800" },
  noteBody: { fontSize: 13, lineHeight: 19, marginTop: 3 },
  followUp: { borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 12, marginTop: 12 },
  inlineCommand: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", marginTop: 8, paddingVertical: 3 },
  inlineCommandText: { fontSize: 13, fontWeight: "800" },
  sourcesSection: { marginTop: 15 },
  sourceRow: { minHeight: 62, borderWidth: 1, borderRadius: 12, padding: 10, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  sourceIcon: { width: 36, height: 36, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  sourceTitle: { fontSize: 14, fontWeight: "800" },
  sourceLocator: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  secondaryButton: { minHeight: 44, borderWidth: 1, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 10 },
  secondaryButtonText: { fontSize: 14, fontWeight: "800" },
  historyHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 26, marginBottom: 10 },
  historySubtitle: { fontSize: 12, marginTop: 2 },
  textButton: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 8 },
  clearText: { color: "#D94A51", fontSize: 13, fontWeight: "700" },
  emptyHistory: { borderWidth: 1, borderStyle: "dashed", borderRadius: 14, padding: 20, alignItems: "center" },
  emptyTitle: { fontSize: 15, fontWeight: "800", marginTop: 7 },
  emptyBody: { fontSize: 12, lineHeight: 17, textAlign: "center", marginTop: 3 },
  historyRow: { minHeight: 100, borderWidth: 1, borderRadius: 14, flexDirection: "row", alignItems: "stretch", marginBottom: 9 },
  historyOpen: { flex: 1, padding: 12 },
  historyTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6 },
  historyPerspective: { fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  historyDate: { fontSize: 10 },
  historyQuestion: { fontSize: 14, fontWeight: "800", lineHeight: 19, marginTop: 5 },
  historyAnswer: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  deleteButton: { width: 42, alignItems: "center", justifyContent: "center" }
});
