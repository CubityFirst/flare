package st.cubityfir.flare.push

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

/**
 * Notification buttons: Acknowledge (urgent alerts), Mark read (everything else) and
 * swipe-away (stops the sound).
 */
class ActionReceiver : BroadcastReceiver() {
  companion object {
    const val ACTION_ACK = "st.cubityfir.flare.push.ACK"
    const val ACTION_READ = "st.cubityfir.flare.push.READ"
    const val ACTION_DISMISSED = "st.cubityfir.flare.push.DISMISSED"
    const val EXTRA_TAG = "tag"
    const val EXTRA_RECEIPT = "receipt"
    const val EXTRA_DELIVERY_ID = "deliveryId"
  }

  override fun onReceive(context: Context, intent: Intent) {
    val tag = intent.getStringExtra(EXTRA_TAG) ?: return
    when (intent.action) {
      ACTION_DISMISSED -> AlertPlayer.stopIfTag(tag)
      ACTION_READ -> {
        // Clear it straight away; if the server call fails the message just stays unread in the feed.
        AlertPlayer.stopIfTag(tag)
        NotificationManagerCompat.from(context).cancel(tag, 0)
        val deliveryId = intent.getStringExtra(EXTRA_DELIVERY_ID) ?: return
        val pending = goAsync()
        Thread {
          try {
            val status = Api.post(context, "/api/feed/${Uri.encode(deliveryId)}/read")
            if (status in 200..299) {
              FlarePushModule.emitMessage(JSONObject().put("type", "read").put("deliveryId", deliveryId).toString())
            } else {
              Log.w("FlareActions", "Mark read answered $status")
            }
          } catch (e: Exception) {
            Log.w("FlareActions", "Mark read failed", e)
          } finally {
            pending.finish()
          }
        }.start()
      }
      ACTION_ACK -> {
        AlertPlayer.stopIfTag(tag)
        val receipt = intent.getStringExtra(EXTRA_RECEIPT) ?: return
        val pending = goAsync()
        Thread {
          try {
            val status = Api.post(context, "/api/receipts/${Uri.encode(receipt)}/ack")
            // 409: someone else already acknowledged it, or it expired. Either way it's done.
            if (status in 200..299 || status == 409) {
              NotificationManagerCompat.from(context).cancel(tag, 0)
              FlarePushModule.emitMessage("{\"type\":\"acknowledged\",\"receipt\":\"$receipt\"}")
            } else {
              showAckFailed(context, tag, status)
            }
          } catch (e: Exception) {
            Log.w("FlareActions", "Acknowledge failed", e)
            showAckFailed(context, tag, -1)
          } finally {
            pending.finish()
          }
        }.start()
      }
    }
  }

  private fun showAckFailed(context: Context, tag: String, status: Int) {
    val reason = when (status) {
      401 -> "You're signed out of Flare on this phone."
      -1 -> "No connection to Flare."
      else -> "Flare answered $status."
    }
    val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val n = NotificationCompat.Builder(context, FlareNotifier.CHANNEL_URGENT)
      .setSmallIcon(R.drawable.ic_flare_notification)
      .setContentTitle("Couldn't acknowledge the alert")
      .setContentText("$reason Open Flare to try again.")
      .setOnlyAlertOnce(true)
      .setAutoCancel(true)
      .apply {
        if (open != null) {
          setContentIntent(
            android.app.PendingIntent.getActivity(context, tag.hashCode() + 9, open, android.app.PendingIntent.FLAG_IMMUTABLE),
          )
        }
      }
      .build()
    try {
      NotificationManagerCompat.from(context).notify("$tag-ackfail", 0, n)
    } catch (_: SecurityException) {
    }
  }
}
