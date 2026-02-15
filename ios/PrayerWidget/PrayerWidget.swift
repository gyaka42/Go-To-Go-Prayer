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

  private let accent = Color(red: 43 / 255, green: 140 / 255, blue: 238 / 255)

  var body: some View {
    switch family {
    case .systemSmall:
      smallLayout
    case .systemMedium, .systemLarge:
      fullLayout
    case .accessoryInline:
      lockInlineLayout
    case .accessoryCircular:
      lockCircularLayout
    case .accessoryRectangular:
      lockRectangularLayout
    default:
      smallLayout
    }
  }

  private var smallLayout: some View {
    GeometryReader { geo in
      ZStack {
        cardBackground
        VStack(alignment: .leading, spacing: 6) {
          Spacer(minLength: 0)

          Text(localized("Upcoming", localeTag: entry.localeTag).uppercased())
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(accent.opacity(0.9))
            .lineLimit(1)

          Text(localizedPrayer(entry.nextPrayer, localeTag: entry.localeTag))
            .font(.system(size: 22, weight: .bold))
            .foregroundStyle(.white)
            .lineLimit(1)
            .minimumScaleFactor(0.72)

          Text(entry.nextTime)
            .font(.system(size: 18, weight: .bold, design: .rounded))
            .foregroundStyle(accent)
            .lineLimit(1)

          Spacer(minLength: 0)

          HStack(spacing: 4) {
            Image(systemName: "location.fill")
              .font(.system(size: 10))
              .foregroundStyle(.white.opacity(0.5))
            Text(entry.location)
              .font(.system(size: 11, weight: .medium))
              .lineLimit(1)
              .truncationMode(.tail)
              .foregroundStyle(.white.opacity(0.65))
          }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 14)
        .frame(width: geo.size.width, height: geo.size.height, alignment: .center)
      }
      .frame(width: geo.size.width, height: geo.size.height)
    }
  }

  private var fullLayout: some View {
    GeometryReader { geo in
      let isLarge = family == .systemLarge
      let leftWidth = geo.size.width * (isLarge ? 0.44 : 0.42)
      let leftTitleSize: CGFloat = isLarge ? 11 : 10
      let leftPrayerSize: CGFloat = isLarge ? 50 : 42
      let leftTimeSize: CGFloat = isLarge ? 34 : 28
      let rowFontSize: CGFloat = isLarge ? 15 : 13
      let rowIconSize: CGFloat = isLarge ? 13 : 11
      let rowHorizontalPadding: CGFloat = isLarge ? 10 : 6
      let rowVerticalPadding: CGFloat = isLarge ? 5 : 2
      let rowSpacing: CGFloat = isLarge ? 6 : 2
      let listVerticalPadding: CGFloat = isLarge ? 12 : 8
      let timeColumnWidth: CGFloat = isLarge ? 62 : 52

      ZStack {
        cardBackground

        HStack(spacing: 0) {
          VStack(alignment: .leading, spacing: isLarge ? 8 : 6) {
            Text(localized("Upcoming", localeTag: entry.localeTag).uppercased())
              .font(.system(size: leftTitleSize, weight: .bold))
              .tracking(1.0)
              .foregroundStyle(accent.opacity(0.9))
              .lineLimit(1)

            Text(localizedPrayer(entry.nextPrayer, localeTag: entry.localeTag))
              .font(.system(size: leftPrayerSize, weight: .bold))
              .foregroundStyle(.white)
              .lineLimit(1)
              .minimumScaleFactor(0.6)

            Text(entry.nextTime)
              .font(.system(size: leftTimeSize, weight: .bold, design: .rounded))
              .foregroundStyle(accent)
              .lineLimit(1)

            Spacer(minLength: 0)

            HStack(spacing: 5) {
              Image(systemName: "location.fill")
                .font(.system(size: isLarge ? 12 : 10))
                .foregroundStyle(.white.opacity(0.5))
              Text(entry.location)
                .font(.system(size: isLarge ? 14 : 12, weight: .medium))
                .lineLimit(1)
                .truncationMode(.tail)
                .foregroundStyle(.white.opacity(0.66))
            }
          }
          .padding(.vertical, isLarge ? 16 : 12)
          .padding(.horizontal, isLarge ? 16 : 12)
          .frame(width: leftWidth, height: geo.size.height, alignment: .topLeading)

          Rectangle()
            .fill(.white.opacity(0.08))
            .frame(width: 1, height: geo.size.height - (isLarge ? 20 : 16))

          VStack(spacing: rowSpacing) {
            ForEach(entry.times, id: \.key) { item in
              prayerRow(
                item: item,
                isCurrent: item.key == entry.currentPrayer,
                rowFontSize: rowFontSize,
                rowIconSize: rowIconSize,
                isLarge: isLarge,
                timeColumnWidth: timeColumnWidth,
                rowHorizontalPadding: rowHorizontalPadding,
                rowVerticalPadding: rowVerticalPadding
              )
            }
            Spacer(minLength: 0)
          }
          .padding(.vertical, listVerticalPadding)
          .padding(.horizontal, isLarge ? 12 : 10)
          .frame(width: geo.size.width - leftWidth - 1, height: geo.size.height, alignment: .top)
        }
      }
      .frame(width: geo.size.width, height: geo.size.height)
    }
  }

  private var cardBackground: some View {
    ZStack {
      LinearGradient(
        colors: [Color(red: 7 / 255, green: 33 / 255, blue: 67 / 255), Color(red: 6 / 255, green: 58 / 255, blue: 104 / 255)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )
      DotPattern().opacity(0.12)
      Circle()
        .fill(accent.opacity(0.22))
        .frame(width: 190, height: 190)
        .blur(radius: 46)
        .offset(x: -130, y: -70)
    }
  }

  private func prayerRow(
    item: (key: String, value: String),
    isCurrent: Bool,
    rowFontSize: CGFloat,
    rowIconSize: CGFloat,
    isLarge: Bool,
    timeColumnWidth: CGFloat,
    rowHorizontalPadding: CGFloat,
    rowVerticalPadding: CGFloat
  ) -> some View {
    HStack(spacing: 8) {
      Image(systemName: iconName(for: item.key))
        .font(.system(size: rowIconSize, weight: .semibold))
        .foregroundStyle(isCurrent ? accent : .white.opacity(0.42))

      Text(localizedPrayer(item.key, localeTag: entry.localeTag))
        .font(.system(size: rowFontSize, weight: isCurrent ? .bold : .medium))
        .lineLimit(1)
        .minimumScaleFactor(0.72)
        .foregroundStyle(isCurrent ? .white : .white.opacity(0.72))
        .layoutPriority(1)

      Spacer(minLength: 8)

      Text(item.value)
        .font(.system(size: rowFontSize, weight: isCurrent ? .bold : .medium, design: .rounded).monospacedDigit())
        .lineLimit(1)
        .foregroundStyle(isCurrent ? accent : .white.opacity(0.72))
        .frame(width: timeColumnWidth, alignment: .trailing)
    }
    .padding(.horizontal, rowHorizontalPadding)
    .padding(.vertical, rowVerticalPadding)
    .background(rowBackground(isCurrent: isCurrent))
    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
  }

  private var lockInlineLayout: some View {
    HStack(spacing: 4) {
      Text(localizedPrayer(entry.nextPrayer, localeTag: entry.localeTag))
      Text(entry.nextTime)
    }
    .font(.system(size: 12, weight: .semibold, design: .rounded))
  }

  private var lockCircularLayout: some View {
    ZStack {
      Circle()
        .fill(accent.opacity(0.22))
      VStack(spacing: 1) {
        Text(shortPrayer(entry.nextPrayer, localeTag: entry.localeTag))
          .font(.system(size: 10, weight: .bold))
          .lineLimit(1)
          .minimumScaleFactor(0.7)
        Text(entry.nextTime)
          .font(.system(size: 11, weight: .bold, design: .rounded).monospacedDigit())
          .lineLimit(1)
          .minimumScaleFactor(0.7)
      }
      .foregroundStyle(.white)
    }
  }

  private var lockRectangularLayout: some View {
    HStack(spacing: 8) {
      Image(systemName: iconName(for: entry.nextPrayer))
        .foregroundStyle(accent)
      VStack(alignment: .leading, spacing: 1) {
        Text(localized("Next", localeTag: entry.localeTag))
          .font(.system(size: 10, weight: .semibold))
          .foregroundStyle(.secondary)
        Text(localizedPrayer(entry.nextPrayer, localeTag: entry.localeTag))
          .font(.system(size: 14, weight: .bold))
          .lineLimit(1)
      }
      Spacer(minLength: 6)
      Text(entry.nextTime)
        .font(.system(size: 14, weight: .bold, design: .rounded).monospacedDigit())
    }
  }

  private func rowBackground(isCurrent: Bool) -> some View {
    if isCurrent {
      return AnyView(
        RoundedRectangle(cornerRadius: 10, style: .continuous)
          .fill(accent.opacity(0.2))
          .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
              .stroke(accent.opacity(0.45), lineWidth: 1)
          )
      )
    }
    return AnyView(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.clear))
  }

  private func iconName(for prayer: String) -> String {
    switch prayer {
    case "Fajr": return "moon.stars.fill"
    case "Sunrise": return "sunrise.fill"
    case "Dhuhr": return "sun.max.fill"
    case "Asr": return "sun.haze.fill"
    case "Maghrib": return "sunset.fill"
    case "Isha": return "moon.fill"
    default: return "circle.fill"
    }
  }
}

private struct DotPattern: View {
  var body: some View {
    GeometryReader { proxy in
      Canvas { context, size in
        let step: CGFloat = 20
        for x in stride(from: CGFloat(8), through: size.width, by: step) {
          for y in stride(from: CGFloat(8), through: size.height, by: step) {
            let rect = CGRect(x: x, y: y, width: 2, height: 2)
            context.fill(Path(ellipseIn: rect), with: .color(.white))
          }
        }
      }
      .frame(width: proxy.size.width, height: proxy.size.height)
    }
    .allowsHitTesting(false)
  }
}

struct PrayerWidget: Widget {
  let kind: String = "PrayerWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: PrayerProvider()) { entry in
      if #available(iOS 17.0, *) {
        PrayerWidgetEntryView(entry: entry)
          .containerBackground(for: .widget) {
            Color.clear
          }
      } else {
        PrayerWidgetEntryView(entry: entry)
      }
    }
    .contentMarginsDisabled()
    .configurationDisplayName("Prayer Times")
    .description("Current and next prayer, plus daily times.")
    .supportedFamilies(supportedFamilies)
  }

  private var supportedFamilies: [WidgetFamily] {
    if #available(iOS 16.0, *) {
      return [
        .systemSmall,
        .systemMedium,
        .systemLarge,
        .accessoryInline,
        .accessoryCircular,
        .accessoryRectangular
      ]
    }
    return [.systemSmall, .systemMedium, .systemLarge]
  }
}

private func localized(_ key: String, localeTag: String) -> String {
  let lang = normalizedLanguage(localeTag: localeTag)
  switch lang {
  case "nl":
    if key == "Current" { return "Huidig" }
    if key == "Next" { return "Volgende" }
    if key == "Upcoming" { return "Volgend" }
    return key
  case "tr":
    if key == "Current" { return "Şu An" }
    if key == "Next" { return "Sonraki" }
    if key == "Upcoming" { return "Sıradaki" }
    return key
  default:
    if key == "Upcoming" { return "Upcoming" }
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

private func shortPrayer(_ prayer: String, localeTag: String) -> String {
  let localized = localizedPrayer(prayer, localeTag: localeTag)
  let trimmed = localized.trimmingCharacters(in: .whitespacesAndNewlines)
  if trimmed.count <= 4 {
    return trimmed.uppercased()
  }
  return String(trimmed.prefix(3)).uppercased()
}

private func normalizedLanguage(localeTag: String) -> String {
  if !localeTag.isEmpty {
    return String(localeTag.prefix(2)).lowercased()
  }
  return String(Locale.current.identifier.prefix(2)).lowercased()
}
