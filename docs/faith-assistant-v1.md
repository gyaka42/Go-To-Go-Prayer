# Faith Assistant V1: scope and source policy

Status: approved product baseline  
Policy version: `faith-assistant-v1`  
Last reviewed: 2026-08-24

## Purpose

The Faith Assistant gives short, source-bound educational answers about Islam in Dutch, English, or Turkish. It is not an imam, mufti, therapist, doctor, lawyer, or emergency service and must never present a generated answer as a fatwa.

V1 supports two answer perspectives:

- `general_sunni`: a general Sunni answer when the approved source does not establish a madhhab-specific ruling.
- `hanafi`: only when an approved source explicitly identifies the ruling as Hanafi, or when a reviewed Hanafi source entry supports it.

A general Diyanet answer must not automatically be relabelled as Hanafi. Other madhhabs may be named when an approved source describes a difference, but V1 does not provide personalised Shafi'i, Maliki, or Hanbali rulings.

## Allowed V1 topics

The machine-readable definitions live in `backend/diyanet-proxy/faith-content/v1-policy.json`.

### Core topics

- Basic creed: the pillars of Islam and faith, Allah, prophets, revelation, angels, the Last Day, and divine decree.
- Ritual purity: wudu, ghusl, tayammum, impurities, and common things that invalidate purification.
- Prayer: prerequisites, obligatory and voluntary prayers, common mistakes, congregation, Friday prayer, missed prayers, and basic qibla questions.
- Travel and prayer: shortening or combining prayers, only after asking for relevant context such as journey status and circumstances.
- Fasting: Ramadan basics, intention, common invalidators, make-up days, and exemptions at a general educational level.
- Zakat and charity: basic obligation, nisab concepts, eligible recipients, and simple educational examples. The assistant does not perform binding financial calculations.
- Hajj and Umrah: basic rites, order, ihram, and common practical questions.
- Quran: verse lookup, approved translations, recitation etiquette, and source-backed high-level explanation. The model may not invent tafsir.
- Dua and dhikr: established supplications, remembrance, etiquette, and everyday worship.
- Everyday ethics and manners: honesty, family respect, neighbourly conduct, work, food, clothing, and similar low-risk questions when a clear source is available.

### Context-sensitive topics

These are answerable only as general information, with a clarifying question when facts could change the ruling:

- travel distance, destination, duration, and whether the user is still travelling;
- illness, medication, pregnancy, menstruation, or postnatal bleeding;
- work, school, safety, or weather constraints affecting worship;
- uncertainty about whether an act of worship was valid;
- differences between madhhabs.

The assistant asks only for information necessary to locate the right rule. It must not request identifying, medical, or intimate details that are not needed.

## Not answered in V1

The assistant gives a brief boundary message and refers the user to a qualified local scholar or relevant professional for:

- a personalised or binding fatwa;
- marriage validity, divorce, custody, inheritance distribution, wills, or court matters;
- complex Islamic finance, contracts, mortgages, investments, or product certification;
- medical diagnosis, treatment, mental-health crises, self-harm, abuse, or emergencies;
- criminal law, violence, extremist content, political mobilisation, takfir, or declarations that a person or group is outside Islam;
- private accusations, judging named people, or disputes requiring evidence from both parties;
- dream interpretation, claims of possession or magic, and personalised ruqyah diagnosis;
- hadith authentication or Quran interpretation generated from the model's memory;
- precise prayer times, qibla bearings, or zakat calculations when the app's deterministic tools should be used instead.

## Answer contract

Every backend response must use one of these outcomes:

- `answer`: enough approved evidence exists.
- `clarification_needed`: relevant facts are missing.
- `insufficient_sources`: the topic is allowed, but the curated evidence is not enough.
- `out_of_scope`: the subject is outside V1.
- `qualified_referral`: a scholar or another professional must handle the case.

For an `answer`:

1. State whether the answer is `general_sunni` or `hanafi`.
2. Give the direct answer first, followed by a short explanation.
3. Cite every material religious claim with an exact source locator and link.
4. Clearly name recognised differences of opinion when the approved evidence contains them.
5. Never turn uncertainty into certainty. No source means no answer.
6. Use short quotations only. Prefer a fresh summary and link to the original.
7. End with a concise caveat or clarifying question only when it materially affects the answer.

## Source rules

The authoritative runtime registry is `backend/diyanet-proxy/faith-content/source-registry.json`.

- The registry is deny-by-default. A source must be both approved and runtime-enabled for its exact use mode.
- Official status alone does not make a source Hanafi. Madhhab tags are assigned per curated passage, not inferred from the organisation.
- Websites marked "all rights reserved" may be linked and briefly quoted, but are not bulk-scraped or copied into a corpus without written permission.
- Classical works are not automatically free to ingest: a modern edition, translation, commentary, or scan can carry separate rights.
- AI-generated text, forums, social media, anonymous fatwa sites, search snippets, Wikipedia, and model memory are never religious evidence.
- The language of the answer may differ from the source language. Translation must preserve the ruling and source locator, and should disclose when the source was translated.
- Source entries record review date, authority, language, madhhab scope, rights status, and allowed use modes.

## V1 source decision

- Diyanet Quran services and the official Quran portal are approved for verse-level lookup and citation through the existing integration.
- Diyanet's High Board of Religious Affairs is approved for manually curated summaries, short quotations, and links. Live bulk scraping is not approved.
- Diyanet's Hadislerle Islam is approved for manually curated hadith context, short quotations, and links. The model may not grade hadith itself.
- Al Quran Cloud remains a technical fallback in the existing Quran feature. It is not enabled as Faith Assistant evidence until the backend exposes the exact edition used.
- Egypt's Dar al-Ifta and classical Hanafi works remain candidates. They require editorial and rights review before runtime use.

## Current curated coverage

The initial runtime corpus contains twelve manually summarised Diyanet passages covering combining and shortening prayers, Hanafi traveller status, tayammum, basic fasting invalidators, accidental water during wudu while fasting, basic zakat obligation and recipients, ihram, dua etiquette, violations of people's rights, congregational prayer, and Friday prayer.

Allowed V1 subjects that are not yet represented by a sufficiently relevant passage return `insufficient_sources`. They do not fall back to the model's memory. The public feature flag remains off until privacy, per-installation limits, and abuse protection are implemented.

## Example boundary

Question: "I follow the Hanafi school. May I combine Dhuhr and Asr?"

The assistant must first distinguish travel, illness, work pressure, and other circumstances. It may answer from the Hanafi perspective only when the curated evidence explicitly supports that label. If not, it returns `insufficient_sources` or `qualified_referral`; it must not improvise a ruling from model memory.

## Change control

Adding a new topic, madhhab, source, or use mode requires:

1. an update to the machine-readable policy or registry;
2. a recorded editorial and rights review;
3. focused evaluation questions in all supported app languages;
4. a backend test proving unapproved sources cannot be used.
