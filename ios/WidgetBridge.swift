import Foundation
import WidgetKit

@objc(WidgetBridge)
class WidgetBridge: NSObject {
  private let suiteName = "group.com.gogo22.gotogoprayer"

  private func persistAndReload(_ apply: @escaping (UserDefaults?) -> Void) {
    let work = {
      let shared = UserDefaults(suiteName: self.suiteName)
      apply(shared)
      shared?.set(Date().timeIntervalSince1970, forKey: "widget_updated_at")
      WidgetCenter.shared.reloadAllTimelines()
    }

    if Thread.isMainThread {
      work()
    } else {
      DispatchQueue.main.async(execute: work)
    }
  }

  private func applyWidgetPayload(_ payload: [String: Any]) {
    persistAndReload { shared in
      shared?.set((payload["currentPrayer"] as? String) ?? "Fajr", forKey: "widget_current_prayer")
      shared?.set((payload["nextPrayer"] as? String) ?? "Dhuhr", forKey: "widget_next_prayer")
      shared?.set((payload["nextTime"] as? String) ?? "--:--", forKey: "widget_next_time")
      shared?.set((payload["location"] as? String) ?? "Location", forKey: "widget_location")
      shared?.set((payload["localeTag"] as? String) ?? "", forKey: "widget_locale_tag")
      shared?.set((payload["fajr"] as? String) ?? "--:--", forKey: "widget_time_fajr")
      shared?.set((payload["sunrise"] as? String) ?? "--:--", forKey: "widget_time_sunrise")
      shared?.set((payload["dhuhr"] as? String) ?? "--:--", forKey: "widget_time_dhuhr")
      shared?.set((payload["asr"] as? String) ?? "--:--", forKey: "widget_time_asr")
      shared?.set((payload["maghrib"] as? String) ?? "--:--", forKey: "widget_time_maghrib")
      shared?.set((payload["isha"] as? String) ?? "--:--", forKey: "widget_time_isha")
      shared?.set((payload["tomorrowFajr"] as? String) ?? "--:--", forKey: "widget_time_tomorrow_fajr")
    }
  }

  @objc
  func saveWidgetState(_ payload: NSDictionary) {
    applyWidgetPayload(payload as? [String: Any] ?? [:])
  }

  @objc
  func saveWidgetStateJSON(_ payloadJSON: String) {
    guard let data = payloadJSON.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: data),
          let payload = object as? [String: Any] else {
      return
    }
    applyWidgetPayload(payload)
  }

  @objc
  func saveWidgetData(_ nextPrayer: String, time: String, location: String) {
    persistAndReload { shared in
      shared?.set(nextPrayer, forKey: "widget_next_prayer")
      shared?.set(time, forKey: "widget_next_time")
      shared?.set(location, forKey: "widget_location")
    }
  }

  @objc
  static func requiresMainQueueSetup() -> Bool {
    false
  }
}
