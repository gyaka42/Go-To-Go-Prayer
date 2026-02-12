import Foundation
import WidgetKit

@objc(WidgetBridge)
class WidgetBridge: NSObject {
  private let suiteName = "group.com.gogo22.gotogoprayer"

  @objc
  func saveWidgetData(_ nextPrayer: String, time: String, location: String) {
    let shared = UserDefaults(suiteName: suiteName)
    shared?.set(nextPrayer, forKey: "widget_next_prayer")
    shared?.set(time, forKey: "widget_next_time")
    shared?.set(location, forKey: "widget_location")
    shared?.set(Date().timeIntervalSince1970, forKey: "widget_updated_at")
    WidgetCenter.shared.reloadAllTimelines()
  }

  @objc
  static func requiresMainQueueSetup() -> Bool {
    false
  }
}
