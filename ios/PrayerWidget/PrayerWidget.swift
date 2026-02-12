import WidgetKit
import SwiftUI

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> SimpleEntry {
        SimpleEntry(
            date: Date(),
            nextPrayer: "Dhuhr",
            nextTime: "13:00",
            location: "Amsterdam, NL",
            updatedAt: Date()
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (SimpleEntry) -> ()) {
        completion(loadEntry(for: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> ()) {
        let now = Date()
        let entry = loadEntry(for: now)
        let nextRefresh = Calendar.current.date(byAdding: .minute, value: 15, to: now) ?? now.addingTimeInterval(900)
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }
    
    private func loadEntry(for date: Date) -> SimpleEntry {
        let suite = UserDefaults(suiteName: "group.com.gogo22.gotogoprayer")
        let nextPrayer = suite?.string(forKey: "widget_next_prayer") ?? "Fajr"
        let nextTime = suite?.string(forKey: "widget_next_time") ?? "--:--"
        let location = suite?.string(forKey: "widget_location") ?? "Location"
        let ts = suite?.double(forKey: "widget_updated_at") ?? 0
        let updatedAt = ts > 0 ? Date(timeIntervalSince1970: ts) : nil
        
        return SimpleEntry(
            date: date,
            nextPrayer: nextPrayer,
            nextTime: nextTime,
            location: location,
            updatedAt: updatedAt
        )
    }
}

struct SimpleEntry: TimelineEntry {
    let date: Date
    let nextPrayer: String
    let nextTime: String
    let location: String
    let updatedAt: Date?
}

struct PrayerWidgetEntryView : View {
    var entry: Provider.Entry

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Next Prayer")
                .font(.caption)
                .foregroundStyle(.secondary)
            
            Text(entry.nextPrayer)
                .font(.headline)
            
            Text(entry.nextTime)
                .font(.system(size: 30, weight: .bold, design: .rounded))
            
            Text(entry.location)
                .font(.caption2)
                .lineLimit(1)
            
            if let updatedAt = entry.updatedAt {
                Text(updatedAt, style: .time)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct PrayerWidget: Widget {
    let kind: String = "PrayerWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            if #available(iOS 17.0, *) {
                PrayerWidgetEntryView(entry: entry)
                    .containerBackground(.fill.tertiary, for: .widget)
            } else {
                PrayerWidgetEntryView(entry: entry)
                    .padding()
                    .background()
            }
        }
        .configurationDisplayName("My Widget")
        .description("Shows the next prayer time.")
    }
}

#Preview(as: .systemSmall) {
    PrayerWidget()
} timeline: {
    SimpleEntry(
        date: .now,
        nextPrayer: "Asr",
        nextTime: "15:21",
        location: "Amsterdam, NL",
        updatedAt: .now
    )
}
