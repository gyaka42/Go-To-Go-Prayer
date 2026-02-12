import SwiftUI
import WidgetKit

private let appGroupSuite = "group.com.gogo22.gotogoprayer"

struct PrayerWidgetEntry: TimelineEntry {
  let date: Date
  let localeTag: String
  let location: String
  let currentPrayer: String
  let nextPrayer: String
  let nextTime: String
  let times: [(key: String, value: String)]
}

struct PrayerProvider: TimelineProvider {
  func placeholder(in context: Context) -> PrayerWidgetEntry {
    PrayerWidgetEntry(
      date: Date(),
      localeTag: "en",
      location: "Amsterdam, NL",
      currentPrayer: "Dhuhr",
      nextPrayer: "Asr",
      nextTime: "15:21",
      times: sampleTimes()
    )
  }

  func getSnapshot(in context: Context, completion: @escaping (PrayerWidgetEntry) -> Void) {
    completion(loadEntry(for: Date()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<PrayerWidgetEntry>) -> Void) {
    let now = Date()
    let entry = loadEntry(for: now)
    let nextRefresh = Calendar.current.date(byAdding: .minute, value: 15, to: now) ?? now.addingTimeInterval(900)
    completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
  }

  private func loadEntry(for date: Date) -> PrayerWidgetEntry {
    let shared = UserDefaults(suiteName: appGroupSuite)
    let localeTag = shared?.string(forKey: "widget_locale_tag") ?? ""
    return PrayerWidgetEntry(
      date: date,
      localeTag: localeTag,
      location: shared?.string(forKey: "widget_location") ?? "Location",
      currentPrayer: shared?.string(forKey: "widget_current_prayer") ?? "Fajr",
      nextPrayer: shared?.string(forKey: "widget_next_prayer") ?? "Dhuhr",
      nextTime: shared?.string(forKey: "widget_next_time") ?? "--:--",
      times: [
        ("Fajr", shared?.string(forKey: "widget_time_fajr") ?? "--:--"),
        ("Sunrise", shared?.string(forKey: "widget_time_sunrise") ?? "--:--"),
        ("Dhuhr", shared?.string(forKey: "widget_time_dhuhr") ?? "--:--"),
        ("Asr", shared?.string(forKey: "widget_time_asr") ?? "--:--"),
        ("Maghrib", shared?.string(forKey: "widget_time_maghrib") ?? "--:--"),
        ("Isha", shared?.string(forKey: "widget_time_isha") ?? "--:--")
      ]
    )
  }

  private func sampleTimes() -> [(key: String, value: String)] {
    [("Fajr", "06:06"), ("Sunrise", "07:45"), ("Dhuhr", "13:00"), ("Asr", "15:21"), ("Maghrib", "17:53"), ("Isha", "19:29")]
  }
}

struct PrayerWidgetEntryView: View {
  @Environment(\.widgetFamily) private var family
  var entry: PrayerProvider.Entry

  var body: some View {
    switch family {
    case .systemSmall:
      smallLayout
    case .systemMedium, .systemLarge:
      fullLayout
    default:
      smallLayout
    }
  }

  private var smallLayout: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(localized("Current", localeTag: entry.localeTag))
        .font(.caption2)
        .foregroundStyle(.secondary)
      Text(localizedPrayer(entry.currentPrayer, localeTag: entry.localeTag))
        .font(.headline)
      Divider()
      Text(localized("Next", localeTag: entry.localeTag))
        .font(.caption2)
        .foregroundStyle(.secondary)
      Text("\(localizedPrayer(entry.nextPrayer, localeTag: entry.localeTag)) \(entry.nextTime)")
        .font(.headline)
      Spacer(minLength: 4)
      Text(entry.location)
        .font(.caption2)
        .lineLimit(1)
        .foregroundStyle(.secondary)
    }
    .padding(12)
  }

  private var fullLayout: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline) {
        VStack(alignment: .leading, spacing: 2) {
          Text(localized("Current", localeTag: entry.localeTag))
            .font(.caption2)
            .foregroundStyle(.secondary)
          Text(localizedPrayer(entry.currentPrayer, localeTag: entry.localeTag))
            .font(.headline)
        }
        Spacer()
        VStack(alignment: .trailing, spacing: 2) {
          Text(localized("Next", localeTag: entry.localeTag))
            .font(.caption2)
            .foregroundStyle(.secondary)
          Text("\(localizedPrayer(entry.nextPrayer, localeTag: entry.localeTag)) \(entry.nextTime)")
            .font(.headline)
        }
      }

      LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 6) {
        ForEach(entry.times, id: \.key) { item in
          let isCurrent = item.key == entry.currentPrayer
          let isNext = item.key == entry.nextPrayer
          HStack {
            Text(localizedPrayer(item.key, localeTag: entry.localeTag))
              .font(.caption)
              .fontWeight(isCurrent || isNext ? .semibold : .regular)
            Spacer(minLength: 6)
            Text(item.value)
              .font(.caption)
              .fontWeight(isCurrent || isNext ? .semibold : .regular)
          }
          .padding(.horizontal, 8)
          .padding(.vertical, 6)
          .background(backgroundStyle(isCurrent: isCurrent, isNext: isNext))
          .clipShape(RoundedRectangle(cornerRadius: 8))
        }
      }

      Text(entry.location)
        .font(.caption2)
        .lineLimit(1)
        .foregroundStyle(.secondary)
    }
    .padding(12)
  }

  private func backgroundStyle(isCurrent: Bool, isNext: Bool) -> Color {
    if isCurrent {
      return Color.blue.opacity(0.25)
    }
    if isNext {
      return Color.blue.opacity(0.15)
    }
    return Color.gray.opacity(0.12)
  }
}

struct PrayerWidget: Widget {
  let kind: String = "PrayerWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: PrayerProvider()) { entry in
      if #available(iOS 17.0, *) {
        PrayerWidgetEntryView(entry: entry)
          .containerBackground(.fill.tertiary, for: .widget)
      } else {
        PrayerWidgetEntryView(entry: entry)
          .padding(2)
      }
    }
    .configurationDisplayName("Prayer Times")
    .description("Current and next prayer, plus daily times.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

private func localized(_ key: String, localeTag: String) -> String {
  let lang = normalizedLanguage(localeTag: localeTag)
  switch lang {
  case "nl":
    if key == "Current" { return "Huidig" }
    if key == "Next" { return "Volgende" }
    return key
  case "tr":
    if key == "Current" { return "Şu An" }
    if key == "Next" { return "Sonraki" }
    return key
  default:
    return key
  }
}

private func localizedPrayer(_ prayer: String, localeTag: String) -> String {
  let lang = normalizedLanguage(localeTag: localeTag)
  if lang == "nl" {
    switch prayer {
    case "Fajr": return "Fajr"
    case "Sunrise": return "Zonsopgang"
    case "Dhuhr": return "Dhuhr"
    case "Asr": return "Asr"
    case "Maghrib": return "Maghrib"
    case "Isha": return "Isha"
    default: return prayer
    }
  }
  if lang == "tr" {
    switch prayer {
    case "Fajr": return "İmsak"
    case "Sunrise": return "Güneş"
    case "Dhuhr": return "Öğle"
    case "Asr": return "İkindi"
    case "Maghrib": return "Akşam"
    case "Isha": return "Yatsı"
    default: return prayer
    }
  }
  return prayer
}

private func normalizedLanguage(localeTag: String) -> String {
  if !localeTag.isEmpty {
    return String(localeTag.prefix(2)).lowercased()
  }
  return String(Locale.current.identifier.prefix(2)).lowercased()
}

#Preview(as: .systemSmall) {
  PrayerWidget()
} timeline: {
  PrayerWidgetEntry(
    date: .now,
    localeTag: "en",
    location: "Amsterdam, NL",
    currentPrayer: "Dhuhr",
    nextPrayer: "Asr",
    nextTime: "15:21",
    times: [("Fajr", "06:06"), ("Sunrise", "07:45"), ("Dhuhr", "13:00"), ("Asr", "15:21"), ("Maghrib", "17:53"), ("Isha", "19:29")]
  )
}
