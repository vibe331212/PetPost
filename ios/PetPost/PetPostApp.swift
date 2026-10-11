import SwiftUI
import UserNotifications

@main
struct PetPostApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var appearance = Appearance.shared

    var body: some Scene {
        WindowGroup {
            WebContainer()
                .ignoresSafeArea()
                .background(Color("LaunchBackground"))
                // Light modes get dark status bar text and dark modes (Ocean, Space...) get light text.
                .preferredColorScheme(appearance.darkMode ? .dark : .light)
        }
    }
}

/// Whether the current PetPost mode is a dark one. The web app reports it whenever the mode changes.
final class Appearance: ObservableObject {
    static let shared = Appearance()
    @Published var darkMode = false
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    // While PetPost is open it shows its own reminder, so show only the banner list entry, not a second alert.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.list]
    }
}
