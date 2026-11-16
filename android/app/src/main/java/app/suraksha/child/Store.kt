package app.suraksha.child

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Tokens and the linked device profile are encrypted with an AES-256-GCM key that
 * never leaves the Android keystore. The server URL stays plain because it is not a secret.
 */
object SecureStore {
    private const val PREFS = "suraksha_child"
    private const val KEY_ALIAS = "suraksha_child_store"
    private const val KEY_TOKENS = "tokens"
    private const val KEY_PROFILE = "profile"
    private const val KEY_SERVER = "server_url"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val body = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(body, Base64.NO_WRAP)
    }

    private fun decrypt(value: String): String? = runCatching {
        val body = Base64.decode(value, Base64.NO_WRAP)
        val iv = body.copyOfRange(0, 12)
        val data = body.copyOfRange(12, body.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
        String(cipher.doFinal(data), Charsets.UTF_8)
    }.getOrNull()

    fun serverUrl(context: Context): String =
        prefs(context).getString(KEY_SERVER, null)?.takeIf { it.isNotBlank() } ?: BuildConfig.DEFAULT_SERVER_URL

    fun setServerUrl(context: Context, url: String) {
        prefs(context).edit().putString(KEY_SERVER, url.trim().trimEnd('/')).apply()
    }

    fun saveTokens(context: Context, tokens: JsonTokens) {
        prefs(context).edit().putString(KEY_TOKENS, encrypt(Json.encodeTokens(tokens))).apply()
    }

    fun tokens(context: Context): JsonTokens? =
        prefs(context).getString(KEY_TOKENS, null)?.let(::decrypt)?.let(Json::decodeTokens)

    fun saveProfile(context: Context, profile: String) {
        prefs(context).edit().putString(KEY_PROFILE, encrypt(profile)).apply()
    }

    fun profile(context: Context): String? =
        prefs(context).getString(KEY_PROFILE, null)?.let(::decrypt)

    fun clear(context: Context) {
        prefs(context).edit().remove(KEY_TOKENS).remove(KEY_PROFILE).apply()
    }
}
