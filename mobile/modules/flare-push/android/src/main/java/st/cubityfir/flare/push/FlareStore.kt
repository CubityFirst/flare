package st.cubityfir.flare.push

import android.content.Context

/**
 * What the native side needs without the JS runtime (when a push arrives with the app
 * closed): the server, the app's session token and a few settings. Private to the app.
 */
class FlareStore(context: Context) {
  private val prefs = context.applicationContext.getSharedPreferences("flare", Context.MODE_PRIVATE)

  var baseUrl: String?
    get() = prefs.getString("baseUrl", null)
    set(v) = prefs.edit().putString("baseUrl", v).apply()

  /** The bearer token from /auth/mobile/token. Null when signed out. */
  var sessionToken: String?
    get() = prefs.getString("sessionToken", null)
    set(v) = prefs.edit().putString("sessionToken", v).apply()

  var deviceName: String?
    get() = prefs.getString("deviceName", null)
    set(v) = prefs.edit().putString("deviceName", v).apply()

  var fcmToken: String?
    get() = prefs.getString("fcmToken", null)
    set(v) = prefs.edit().putString("fcmToken", v).apply()

  /** Raise the alarm volume to full while an urgent alert plays, then put it back. */
  var overrideVolume: Boolean
    get() = prefs.getBoolean("overrideVolume", true)
    set(v) = prefs.edit().putBoolean("overrideVolume", v).apply()

  val signedIn: Boolean
    get() = !baseUrl.isNullOrEmpty() && !sessionToken.isNullOrEmpty()
}
