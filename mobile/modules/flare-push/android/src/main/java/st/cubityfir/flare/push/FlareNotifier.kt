package st.cubityfir.flare.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

/**
 * Turns a Flare push payload (the same JSON the web app's service worker gets) into a
 * notification, mirroring public/sw.js:
 *
 *   -1 quiet   no sound or vibration
 *    0 normal  sound + short vibration
 *    1 high    heads-up, stays until dismissed
 *    2 urgent  alarm-volume sound, long vibration, full screen if allowed, Acknowledge button;
 *              repeats from the server replace the same notification
 *
 * Everything that isn't an urgent alert gets a Mark read button instead.
 *
 * Each priority has its own channel, so they can be tuned separately in Android's settings.
 * The channels are silent: AlertPlayer plays the message's own sound on the right stream.
 */
object FlareNotifier {
  private const val TAG = "FlareNotifier"
  const val CHANNEL_URGENT = "flare_urgent"
  const val CHANNEL_HIGH = "flare_high"
  const val CHANNEL_NORMAL = "flare_normal"
  const val CHANNEL_QUIET = "flare_quiet"
  private const val ACCENT = 0xFFC026D3.toInt()

  data class Payload(
    val deliveryId: String?,
    val messageId: String?,
    val title: String,
    val body: String,
    val priority: Int,
    val sound: String?,
    val soundUrl: String?,
    val url: String?,
    val receipt: String?,
    val attempt: Int,
    val ts: Long,
  ) {
    val urgent get() = priority >= 2
    /** Urgent repeats share a tag so they replace one another. */
    val tag get() = if (urgent && receipt != null) "urgent-$receipt" else "msg-${messageId ?: deliveryId ?: ts}"

    companion object {
      fun parse(raw: String): Payload {
        val o = JSONObject(raw)
        fun str(k: String) = if (o.isNull(k)) null else o.optString(k).takeIf { it.isNotEmpty() }
        return Payload(
          deliveryId = str("deliveryId"),
          messageId = str("messageId"),
          title = str("title") ?: "Flare",
          body = o.optString("body", ""),
          priority = o.optInt("priority", 0),
          sound = str("sound"),
          soundUrl = str("soundUrl"),
          url = str("url"),
          receipt = str("receipt"),
          attempt = o.optInt("attempt", 1),
          ts = o.optLong("ts", System.currentTimeMillis()),
        )
      }
    }
  }

  fun ensureChannels(context: Context) {
    AlertPlayer.appContext = context.applicationContext
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = context.getSystemService(NotificationManager::class.java)
    fun channel(id: String, name: String, importance: Int, description: String, block: NotificationChannel.() -> Unit = {}) =
      NotificationChannel(id, name, importance).apply {
        this.description = description
        setSound(null, null)
        enableLights(true)
        lightColor = ACCENT
        block()
      }
    nm.createNotificationChannels(
      listOf(
        channel(CHANNEL_URGENT, "Urgent alerts", NotificationManager.IMPORTANCE_HIGH, "Repeat until acknowledged. Play at alarm volume.") {
          enableVibration(true)
          vibrationPattern = longArrayOf(0, 400, 150, 400, 150, 400)
          // Only takes effect once the user gives Flare Do Not Disturb access (or flips it here).
          setBypassDnd(true)
          lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
        },
        channel(CHANNEL_HIGH, "High priority", NotificationManager.IMPORTANCE_HIGH, "Stay on screen until dismissed.") {
          enableVibration(true)
          vibrationPattern = longArrayOf(0, 150)
        },
        channel(CHANNEL_NORMAL, "Messages", NotificationManager.IMPORTANCE_HIGH, "Normal notifications.") {
          enableVibration(true)
          vibrationPattern = longArrayOf(0, 150)
        },
        channel(CHANNEL_QUIET, "Quiet", NotificationManager.IMPORTANCE_LOW, "No sound or vibration.") {
          enableVibration(false)
        },
      ),
    )
  }

  private fun channelFor(p: Payload) = when {
    p.priority >= 2 -> CHANNEL_URGENT
    p.priority == 1 -> CHANNEL_HIGH
    p.priority <= -1 -> CHANNEL_QUIET
    else -> CHANNEL_NORMAL
  }

  private fun flags() = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

  /** Opens the message in the app (flare://item/<deliveryId>). */
  private fun openIntent(context: Context, p: Payload): PendingIntent {
    val uri = Uri.parse(if (p.deliveryId != null) "flare://item/${Uri.encode(p.deliveryId)}" else "flare://")
    val intent = Intent(Intent.ACTION_VIEW, uri).setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(context, p.tag.hashCode(), intent, flags())
  }

  private fun actionIntent(context: Context, action: String, p: Payload, requestOffset: Int): PendingIntent {
    val intent = Intent(context, ActionReceiver::class.java).setAction(action)
      .putExtra(ActionReceiver.EXTRA_TAG, p.tag)
      .putExtra(ActionReceiver.EXTRA_RECEIPT, p.receipt)
      .putExtra(ActionReceiver.EXTRA_DELIVERY_ID, p.deliveryId)
    return PendingIntent.getBroadcast(context, p.tag.hashCode() + requestOffset, intent, flags())
  }

  /** Whether urgent alerts may open full screen (Android 14+ asks the user for this). */
  fun canUseFullScreen(context: Context): Boolean =
    if (Build.VERSION.SDK_INT >= 34) context.getSystemService(NotificationManager::class.java).canUseFullScreenIntent() else true

  /**
   * Shows the notification and plays its sound. Call off the main thread: it may download a
   * custom sound and, with `waitForSound`, blocks until the sound has finished.
   */
  fun handle(context: Context, raw: String, waitForSound: Boolean) {
    val p = try {
      Payload.parse(raw)
    } catch (e: Exception) {
      Log.w(TAG, "Ignoring malformed push", e)
      return
    }
    ensureChannels(context)
    FlarePushModule.emitMessage(raw)

    val nmc = NotificationManagerCompat.from(context)
    if (!nmc.areNotificationsEnabled()) return

    val builder = NotificationCompat.Builder(context, channelFor(p))
      .setSmallIcon(R.drawable.ic_flare_notification)
      .setColor(ACCENT)
      .setContentTitle(if (p.urgent) "🚨 ${p.title}" else p.title)
      .setContentText(p.body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(p.body))
      .setWhen(p.ts)
      .setShowWhen(true)
      .setContentIntent(openIntent(context, p))
      .setDeleteIntent(actionIntent(context, ActionReceiver.ACTION_DISMISSED, p, 2))
      .setAutoCancel(!p.urgent)
      .setCategory(if (p.urgent) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_MESSAGE)
      .setPriority(
        when {
          p.priority >= 1 -> NotificationCompat.PRIORITY_HIGH
          p.priority <= -1 -> NotificationCompat.PRIORITY_LOW
          else -> NotificationCompat.PRIORITY_DEFAULT
        },
      )
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)

    if (p.urgent && p.receipt != null) {
      builder.addAction(0, "Acknowledge", actionIntent(context, ActionReceiver.ACTION_ACK, p, 1))
      if (p.attempt > 1) builder.setSubText("Repeat ${p.attempt}")
    } else if (p.deliveryId != null) {
      builder.addAction(0, "Mark read", actionIntent(context, ActionReceiver.ACTION_READ, p, 4))
    }
    val link = p.url?.takeIf { it.startsWith("https://") || it.startsWith("http://") }
    if (link != null) {
      val open = Intent(Intent.ACTION_VIEW, Uri.parse(link)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      builder.addAction(0, "Open link", PendingIntent.getActivity(context, p.tag.hashCode() + 3, open, flags()))
    }
    if (p.urgent && canUseFullScreen(context)) {
      builder.setFullScreenIntent(openIntent(context, p), true)
    }

    try {
      nmc.notify(p.tag, 0, builder.build())
    } catch (e: SecurityException) {
      Log.w(TAG, "Notification permission missing", e)
      return
    }

    // The user can silence a whole channel in Android's settings; respect that for our sound too.
    val muted = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
      (nmc.getNotificationChannel(channelFor(p))?.importance ?: NotificationManager.IMPORTANCE_DEFAULT) < NotificationManager.IMPORTANCE_DEFAULT
    if (p.priority >= 0 && !muted) {
      val absoluteUrl = p.soundUrl?.let { if (it.startsWith("/")) FlareStore(context).baseUrl?.trimEnd('/') + it else it }
      if (waitForSound) {
        AlertPlayer.playAndWait(context, p.sound, absoluteUrl, p.urgent, p.tag)
      } else {
        AlertPlayer.play(context, p.sound, absoluteUrl, p.urgent, p.tag)
      }
    }
  }

  /** Clears a notification and its sound, e.g. after the alert was acknowledged in the app. */
  fun dismiss(context: Context, tag: String) {
    AlertPlayer.stopIfTag(tag)
    NotificationManagerCompat.from(context).cancel(tag, 0)
  }
}
