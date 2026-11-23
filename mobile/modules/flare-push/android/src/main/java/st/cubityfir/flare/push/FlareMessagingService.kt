package st.cubityfir.flare.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Receives Flare's data-only FCM messages, even when the app is closed, and shows them.
 * onMessageReceived runs on a background thread, so it can wait for the alert sound to finish
 * (keeping the process alive while it plays).
 */
class FlareMessagingService : FirebaseMessagingService() {
  override fun onMessageReceived(message: RemoteMessage) {
    val raw = message.data["flare"] ?: return
    FlareNotifier.handle(applicationContext, raw, waitForSound = true)
  }

  /** Google rotated this phone's token: tell Flare straight away, app open or not. */
  override fun onNewToken(token: String) {
    FlareStore(this).fcmToken = token
    FlarePushModule.emitToken(token)
    Api.registerDevice(applicationContext, token)
  }
}
