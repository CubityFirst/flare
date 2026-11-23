package st.cubityfir.flare.push

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.os.bundleOf
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** The JS side of Flare's push handling. See src/FlarePushModule.ts for the TypeScript API. */
class FlarePushModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("FlarePush")
    Events("onMessage", "onToken")

    OnCreate {
      instance = this@FlarePushModule
      FlareNotifier.ensureChannels(context)
    }
    OnDestroy {
      if (instance === this@FlarePushModule) instance = null
    }

    /** Saves the server and session the native side uses when the app isn't running. */
    Function("setSession") { baseUrl: String?, token: String?, deviceName: String? ->
      val store = FlareStore(context)
      store.baseUrl = baseUrl
      store.sessionToken = token
      if (deviceName != null) store.deviceName = deviceName
    }

    Function("getSession") {
      val store = FlareStore(context)
      mapOf("baseUrl" to store.baseUrl, "token" to store.sessionToken, "deviceName" to store.deviceName)
    }

    /** False until google-services.json is in the build. */
    Function("isFirebaseAvailable") {
      FirebaseApp.getApps(context).isNotEmpty()
    }

    AsyncFunction("getFcmToken") { promise: Promise ->
      if (FirebaseApp.getApps(context).isEmpty()) {
        promise.resolve(null)
        return@AsyncFunction
      }
      FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
        if (task.isSuccessful) {
          FlareStore(context).fcmToken = task.result
          promise.resolve(task.result)
        } else {
          promise.reject("ERR_FCM_TOKEN", task.exception?.message ?: "Couldn't get an FCM token", task.exception)
        }
      }
    }

    Function("getStatus") {
      val ctx = context
      val nm = ctx.getSystemService(NotificationManager::class.java)
      val nmc = NotificationManagerCompat.from(ctx)
      fun channelEnabled(id: String) =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
          (nmc.getNotificationChannel(id)?.importance ?: NotificationManager.IMPORTANCE_DEFAULT) != NotificationManager.IMPORTANCE_NONE
      mapOf(
        "notificationsEnabled" to nmc.areNotificationsEnabled(),
        "urgentChannelEnabled" to channelEnabled(FlareNotifier.CHANNEL_URGENT),
        "dndAccess" to nm.isNotificationPolicyAccessGranted,
        "fullScreenAllowed" to FlareNotifier.canUseFullScreen(ctx),
        "overrideVolume" to FlareStore(ctx).overrideVolume,
        "firebase" to FirebaseApp.getApps(ctx).isNotEmpty(),
      )
    }

    Function("setOverrideVolume") { enabled: Boolean ->
      FlareStore(context).overrideVolume = enabled
    }

    /** Opens one of Android's settings screens for Flare. */
    Function("openSettings") { which: String ->
      val ctx = context
      val intent = when (which) {
        "notifications" -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
        "urgentChannel" -> Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
          .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
          .putExtra(Settings.EXTRA_CHANNEL_ID, FlareNotifier.CHANNEL_URGENT)
        "dnd" -> Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)
        "fullScreen" ->
          if (Build.VERSION.SDK_INT >= 34) {
            Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${ctx.packageName}"))
          } else {
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}"))
          }
        else -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}"))
      }
      ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** Clears an urgent alert's notification and sound after it was acknowledged in the app. */
    Function("dismissAlert") { receipt: String ->
      FlareNotifier.dismiss(context, "urgent-$receipt")
    }

    /** Shows a notification from a payload, exactly as if it had arrived by push. */
    AsyncFunction("showLocal") { payloadJson: String ->
      FlareNotifier.handle(context, payloadJson, waitForSound = false)
    }

    /** Plays a built-in sound, e.g. to preview the urgent alert volume. */
    AsyncFunction("previewSound") { slug: String, urgent: Boolean ->
      AlertPlayer.play(context, slug, null, urgent, "preview")
      Unit
    }

    Function("stopSound") {
      AlertPlayer.stop()
    }
  }

  companion object {
    @Volatile
    private var instance: FlarePushModule? = null

    /** Lets the open app refresh its feed when a push arrives. */
    fun emitMessage(raw: String) {
      try {
        instance?.sendEvent("onMessage", bundleOf("payload" to raw))
      } catch (_: Exception) {
      }
    }

    fun emitToken(token: String) {
      try {
        instance?.sendEvent("onToken", bundleOf("token" to token))
      } catch (_: Exception) {
      }
    }
  }
}
