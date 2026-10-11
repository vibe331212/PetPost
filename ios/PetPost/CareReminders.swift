import Foundation
import UserNotifications

/// Turns PetPost's pet care needs into repeating iPhone notifications, so they go off even when the app is closed.
enum CareReminders {
    private static let center = UNUserNotificationCenter.current()
    private static let prefix = "care:"

    /// Checks permission. Only asks the person when `ask` is true, which is when they tap "Turn on reminders"
    /// or add a need. Returns whether reminders are allowed.
    private static func allowed(ask: Bool) async -> Bool {
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .notDetermined:
            guard ask else { return false }
            return (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        case .authorized, .provisional, .ephemeral:
            return true
        default:
            return false
        }
    }

    /// Replaces every care reminder with this list.
    /// Each item is {id, name, note, time: "HH:MM", repeat: daily|weekly|monthly|once, days: [0-6], date: "YYYY-MM-DD"}.
    @discardableResult
    static func schedule(_ items: [[String: Any]], petName: String, ask: Bool) async -> Bool {
        let pending = await center.pendingNotificationRequests()
        center.removePendingNotificationRequests(withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix(prefix) })
        guard await allowed(ask: ask) else { return false }

        var count = 0
        for item in items {
            guard let id = item["id"] as? String, let name = item["name"] as? String,
                  let time = item["time"] as? String else { continue }
            let hm = time.split(separator: ":").compactMap { Int($0) }
            guard hm.count == 2 else { continue }

            let content = UNMutableNotificationContent()
            // "Breakfast" becomes "Time for breakfast", but "Play time" stays "Play time"
            content.title = name.lowercased().hasSuffix("time") ? name : "Time for \(name.lowercased())"
            let note = (item["note"] as? String ?? "").trimmingCharacters(in: .whitespaces)
            content.body = note.isEmpty ? "\(petName) is counting on you" : "\(petName) is counting on you · \(note)"
            content.sound = .default
            content.threadIdentifier = "care"

            for (index, parts) in triggers(for: item, hour: hm[0], minute: hm[1]).enumerated() {
                guard count < 60 else { return true }   // iOS keeps at most 64 waiting notifications
                let trigger = UNCalendarNotificationTrigger(dateMatching: parts.components, repeats: parts.repeats)
                guard trigger.nextTriggerDate() != nil else { continue }
                try? await center.add(UNNotificationRequest(identifier: "\(prefix)\(id):\(index)", content: content, trigger: trigger))
                count += 1
            }
        }
        return true
    }

    private static func triggers(for item: [String: Any], hour: Int, minute: Int) -> [(components: DateComponents, repeats: Bool)] {
        let repeatKind = item["repeat"] as? String ?? "daily"
        let date = (item["date"] as? String ?? "").split(separator: "-").compactMap { Int($0) }
        switch repeatKind {
        case "weekly":
            // JavaScript counts Sunday as 0; iPhone calendars count Sunday as 1.
            return (item["days"] as? [Int] ?? []).map { day in
                (DateComponents(hour: hour, minute: minute, weekday: day + 1), true)
            }
        case "monthly":
            guard date.count == 3 else { return [] }
            return [(DateComponents(day: date[2], hour: hour, minute: minute), true)]
        case "once":
            guard date.count == 3 else { return [] }
            return [(DateComponents(year: date[0], month: date[1], day: date[2], hour: hour, minute: minute), false)]
        default:
            return [(DateComponents(hour: hour, minute: minute), true)]
        }
    }
}
