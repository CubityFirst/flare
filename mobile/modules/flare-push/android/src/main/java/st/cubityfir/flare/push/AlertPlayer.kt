package st.cubityfir.flare.push

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Plays alert sounds. Notification channels are silent, so Flare can play each message's own
 * sound (built-in or uploaded) and choose the audio stream:
 *
 * - Normal and high priority play as notifications: they follow the notification volume,
 *   stay silent in silent/vibrate mode and are muted by Do Not Disturb.
 * - Urgent alerts play as alarms: they follow the alarm volume, which silent mode doesn't
 *   touch, and Do Not Disturb lets alarms through by default. With "override volume" on,
 *   the alarm volume is raised to full while the alert plays, then restored.
 */
object AlertPlayer {
  private const val TAG = "FlareAlertPlayer"
  /** How long an urgent alert keeps looping unless it's acknowledged or dismissed first. */
  private const val URGENT_LOOP_MS = 15_000L

  private val main = Handler(Looper.getMainLooper())
  private var player: MediaPlayer? = null
  private var playingTag: String? = null
  private var restoreAlarmVolume: Int? = null
  private var done: CountDownLatch? = null

  private val builtins = mapOf(
    "flare" to R.raw.flare_sound_flare,
    "chime" to R.raw.flare_sound_chime,
    "blip" to R.raw.flare_sound_blip,
    "pulse" to R.raw.flare_sound_pulse,
    "cascade" to R.raw.flare_sound_cascade,
    "klaxon" to R.raw.flare_sound_klaxon,
    "siren" to R.raw.flare_sound_siren,
  )

  /** A custom sound, downloaded once and cached by URL. Null if it can't be fetched. */
  private fun customSound(context: Context, url: String): File? {
    val dir = File(context.cacheDir, "flare-sounds").apply { mkdirs() }
    val hash = MessageDigest.getInstance("SHA-256").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }
    val file = File(dir, hash.take(32))
    if (file.exists() && file.length() > 0) return file
    return if (Api.download(context, url, file)) file else null
  }

  /**
   * Starts a sound. Returns a latch that opens when it has finished, so a background caller
   * (the messaging service) can keep the process alive until then.
   */
  @Synchronized
  fun play(context: Context, slug: String?, url: String?, urgent: Boolean, tag: String?): CountDownLatch? {
    if (slug == "none") return null
    val app = context.applicationContext
    // Resolve the source before stopping whatever is playing (the download may take a moment).
    val file = url?.let { customSound(app, it) }
    val resId = builtins[slug ?: ""] ?: builtins[if (urgent) "klaxon" else "flare"]!!

    stopLocked()
    val audio = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    if (urgent && FlareStore(app).overrideVolume) {
      try {
        val current = audio.getStreamVolume(AudioManager.STREAM_ALARM)
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_ALARM)
        if (current < max) {
          restoreAlarmVolume = current
          audio.setStreamVolume(AudioManager.STREAM_ALARM, max, 0)
        }
      } catch (e: SecurityException) {
        Log.w(TAG, "Couldn't raise the alarm volume", e)
      }
    }

    val attrs = AudioAttributes.Builder()
      .setUsage(if (urgent) AudioAttributes.USAGE_ALARM else AudioAttributes.USAGE_NOTIFICATION)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
    val latch = CountDownLatch(1)
    try {
      val mp = MediaPlayer()
      mp.setAudioAttributes(attrs)
      if (file != null) {
        mp.setDataSource(app, Uri.fromFile(file))
      } else {
        app.resources.openRawResourceFd(resId).use { fd -> mp.setDataSource(fd.fileDescriptor, fd.startOffset, fd.length) }
      }
      mp.isLooping = urgent
      mp.setOnCompletionListener { stop() }
      mp.setOnErrorListener { _, what, extra ->
        Log.w(TAG, "Playback error $what/$extra")
        stop()
        true
      }
      mp.prepare()
      mp.start()
      player = mp
      playingTag = tag
      done = latch
      if (urgent) main.postDelayed({ stopIfTag(tag) }, URGENT_LOOP_MS)
    } catch (e: Exception) {
      Log.w(TAG, "Couldn't play alert sound", e)
      stopLocked()
      latch.countDown()
    }
    return latch
  }

  /** Plays a sound and waits for it to finish (bounded), for use off the main thread. */
  fun playAndWait(context: Context, slug: String?, url: String?, urgent: Boolean, tag: String?) {
    play(context, slug, url, urgent, tag)?.await(URGENT_LOOP_MS + 2_000, TimeUnit.MILLISECONDS)
  }

  @Synchronized
  fun stop() = stopLocked()

  /** Stops the sound only if it belongs to this notification. */
  @Synchronized
  fun stopIfTag(tag: String?) {
    if (tag != null && tag == playingTag) stopLocked()
  }

  private fun stopLocked() {
    main.removeCallbacksAndMessages(null)
    player?.let {
      try {
        it.stop()
      } catch (_: Exception) {
      }
      it.release()
    }
    player = null
    playingTag = null
    restoreAlarmVolume?.let { volume ->
      restoreAlarmVolume = null
      // Context-free: AudioManager is reachable from any context, and this runs in-process.
      appContext?.let { ctx ->
        try {
          (ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager)
            .setStreamVolume(AudioManager.STREAM_ALARM, volume, 0)
        } catch (_: SecurityException) {
        }
      }
    }
    done?.countDown()
    done = null
  }

  /** Set once by FlareNotifier, so the volume can be restored from any callback. */
  @Volatile
  var appContext: Context? = null
}
