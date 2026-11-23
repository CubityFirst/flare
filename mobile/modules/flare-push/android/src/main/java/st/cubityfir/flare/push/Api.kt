package st.cubityfir.flare.push

import android.content.Context
import android.os.Build
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** The few Flare API calls the native side makes on its own (no JS runtime needed). */
object Api {
  private const val TAG = "FlareApi"

  private fun open(store: FlareStore, path: String, method: String): HttpURLConnection? {
    val base = store.baseUrl ?: return null
    val token = store.sessionToken ?: return null
    val url = if (path.startsWith("http")) URL(path) else URL(base.trimEnd('/') + path)
    // Only ever send the session token to Flare itself.
    if (url.host != URL(base).host) return null
    return (url.openConnection() as HttpURLConnection).apply {
      requestMethod = method
      connectTimeout = 10_000
      readTimeout = 10_000
      setRequestProperty("authorization", "Bearer $token")
      setRequestProperty("x-flare", "1")
      setRequestProperty("user-agent", "FlareAndroid/1 (Android ${Build.VERSION.RELEASE}; ${Build.MODEL})")
    }
  }

  /** POSTs JSON and returns the HTTP status, or -1 if it couldn't be sent. */
  fun post(context: Context, path: String, body: JSONObject? = null): Int {
    val conn = try {
      open(FlareStore(context), path, "POST")
    } catch (e: Exception) {
      null
    } ?: return -1
    return try {
      if (body != null) {
        conn.doOutput = true
        conn.setRequestProperty("content-type", "application/json")
        conn.outputStream.use { it.write(body.toString().toByteArray()) }
      }
      conn.responseCode
    } catch (e: Exception) {
      Log.w(TAG, "POST $path failed", e)
      -1
    } finally {
      conn.disconnect()
    }
  }

  /** Registers (or re-registers) this phone's FCM token with the signed-in account. */
  fun registerDevice(context: Context, token: String): Int {
    val store = FlareStore(context)
    if (!store.signedIn) return -1
    val name = store.deviceName ?: "${Build.MANUFACTURER} ${Build.MODEL}".trim()
    val body = JSONObject().put("name", name.take(80)).put("fcm", JSONObject().put("token", token))
    return post(context, "/api/devices", body)
  }

  /** Downloads a file from Flare (a custom sound) to `dest`. */
  fun download(context: Context, path: String, dest: File): Boolean {
    val conn = try {
      open(FlareStore(context), path, "GET")
    } catch (e: Exception) {
      null
    } ?: return false
    return try {
      if (conn.responseCode != 200) return false
      val tmp = File(dest.parentFile, dest.name + ".part")
      conn.inputStream.use { input -> tmp.outputStream().use { input.copyTo(it) } }
      tmp.renameTo(dest)
    } catch (e: Exception) {
      Log.w(TAG, "Download $path failed", e)
      false
    } finally {
      conn.disconnect()
    }
  }
}
