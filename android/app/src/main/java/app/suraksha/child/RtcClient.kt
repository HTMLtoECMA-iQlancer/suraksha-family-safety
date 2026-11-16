package app.suraksha.child

import android.content.Context
import android.content.Intent
import android.util.Log
import org.json.JSONObject
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.Camera2Enumerator
import org.webrtc.CameraVideoCapturer
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoSource
import org.webrtc.VideoTrack

/**
 * The child is always the offerer. Media is captured only after the child taps Approve,
 * Android shows its own camera/microphone/screen indicators, and the foreground service
 * notification stays visible for the whole call.
 */
class RtcClient(
    private val context: Context,
    private val realtime: Realtime,
    private val sessionId: String,
    private val kind: String,
    private val projectionIntent: Intent?,
    private val iceServers: List<PeerConnection.IceServer>,
    private val onState: (String) -> Unit,
) {
    private val eglBase = EglBase.create()
    private var factory: PeerConnectionFactory? = null
    private var peer: PeerConnection? = null
    private var capturer: VideoCapturer? = null
    private var videoSource: VideoSource? = null
    private var audioSource: AudioSource? = null
    private var videoTrack: VideoTrack? = null
    private var audioTrack: AudioTrack? = null
    private var surfaceHelper: SurfaceTextureHelper? = null
    private val pendingIce = mutableListOf<IceCandidate>()

    fun start() {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context)
                .setEnableInternalTracer(false)
                .createInitializationOptions(),
        )
        val encoder = DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true)
        val decoder = DefaultVideoDecoderFactory(eglBase.eglBaseContext)
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(encoder)
            .setVideoDecoderFactory(decoder)
            .createPeerConnectionFactory()

        val config = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }
        peer = factory?.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate) {
                realtime.send(
                    "signal",
                    sessionId,
                    JSONObject().put(
                        "kind",
                        "ice",
                    ).put(
                        "candidate",
                        JSONObject()
                            .put("candidate", candidate.sdp)
                            .put("sdpMid", candidate.sdpMid)
                            .put("sdpMLineIndex", candidate.sdpMLineIndex),
                    ),
                )
            }

            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit
            override fun onSignalingChange(state: PeerConnection.SignalingState) = Unit
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
                onState(state.name.lowercase())
            }

            override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) = Unit
            override fun onAddStream(stream: MediaStream) = Unit
            override fun onRemoveStream(stream: MediaStream) = Unit
            override fun onDataChannel(channel: DataChannel) = Unit
            override fun onRenegotiationNeeded() = Unit
            override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) = Unit
        })

        val streams = listOf("suraksha")
        when (kind) {
            "camera" -> addCamera(streams)
            "screen" -> addScreen(streams)
            "audio" -> Unit
            else -> addCamera(streams)
        }
        val micAllowed = android.content.pm.PackageManager.PERMISSION_GRANTED ==
            androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.RECORD_AUDIO)
        if (kind == "audio" || (kind == "camera" && micAllowed)) addMicrophone(streams)

        val constraints = MediaConstraints()
        peer?.createOffer(object : SdpObserver {
            override fun onCreateSuccess(description: SessionDescription) {
                peer?.setLocalDescription(SimpleSdpObserver(), description)
                realtime.sendReady(sessionId)
                realtime.send(
                    "signal",
                    sessionId,
                    JSONObject().put("kind", "offer").put(
                        "sdp",
                        JSONObject().put("type", description.type.canonicalForm()).put("sdp", description.description),
                    ),
                )
                onState("offer_sent")
            }

            override fun onCreateFailure(error: String) {
                Log.w("SurakshaChild", "offer failed: $error")
                onState("failed")
            }

            override fun onSetSuccess() = Unit
            override fun onSetFailure(error: String) = Unit
        }, constraints)
    }

    private fun addCamera(streams: List<String>) {
        val enumerator = Camera2Enumerator(context)
        val device = enumerator.deviceNames.firstOrNull { enumerator.isFrontFacing(it) }
            ?: enumerator.deviceNames.firstOrNull() ?: return
        val cameraCapturer = enumerator.createCapturer(device, null) ?: return
        capturer = cameraCapturer
        surfaceHelper = SurfaceTextureHelper.create("SurakshaCapture", eglBase.eglBaseContext)
        val source = factory?.createVideoSource(false)
        videoSource = source
        cameraCapturer.initialize(surfaceHelper, context, source?.capturerObserver)
        cameraCapturer.startCapture(1280, 720, 24)
        val track = factory?.createVideoTrack("suraksha-video", source)
        videoTrack = track
        if (track != null) peer?.addTrack(track, streams)
    }

    private fun addScreen(streams: List<String>) {
        val intent = projectionIntent ?: return
        val screenCapturer = ScreenCapturerAndroid(intent, object : android.media.projection.MediaProjection.Callback() {
            override fun onStop() {
                onState("stopped")
            }
        })
        capturer = screenCapturer
        surfaceHelper = SurfaceTextureHelper.create("SurakshaScreen", eglBase.eglBaseContext)
        val source = factory?.createVideoSource(false)
        videoSource = source
        screenCapturer.initialize(surfaceHelper, context, source?.capturerObserver)
        screenCapturer.startCapture(1280, 720, 15)
        val track = factory?.createVideoTrack("suraksha-screen", source)
        videoTrack = track
        if (track != null) peer?.addTrack(track, streams)
    }

    private fun addMicrophone(streams: List<String>) {
        val source = factory?.createAudioSource(MediaConstraints()) ?: return
        audioSource = source
        val track = factory?.createAudioTrack("suraksha-audio", source) ?: return
        audioTrack = track
        peer?.addTrack(track, streams)
    }

    /** Answer and ICE messages relayed from the parent. */
    fun onSignal(payload: JSONObject) {
        when (payload.optString("kind")) {
            "answer" -> {
                val sdp = payload.getJSONObject("sdp")
                peer?.setRemoteDescription(
                    SimpleSdpObserver(),
                    SessionDescription(SessionDescription.Type.ANSWER, sdp.getString("sdp")),
                )
                val queued = pendingIce.toList()
                pendingIce.clear()
                queued.forEach { peer?.addIceCandidate(it) }
            }

            "ice" -> {
                val candidate = payload.getJSONObject("candidate")
                val ice = IceCandidate(
                    candidate.optString("sdpMid"),
                    candidate.optInt("sdpMLineIndex"),
                    candidate.getString("candidate"),
                )
                if (peer?.remoteDescription != null) peer?.addIceCandidate(ice) else pendingIce.add(ice)
            }
        }
    }

    @Volatile private var disposed = false

    fun dispose() {
        if (disposed) return
        disposed = true
        runCatching { capturer?.stopCapture() }
        runCatching { capturer?.dispose() }
        runCatching { videoTrack?.dispose() }
        runCatching { videoSource?.dispose() }
        runCatching { audioTrack?.dispose() }
        runCatching { audioSource?.dispose() }
        runCatching { peer?.close() }
        runCatching { surfaceHelper?.dispose() }
        runCatching { factory?.dispose() }
        runCatching { eglBase.release() }
        peer = null
        factory = null
    }
}

private class SimpleSdpObserver : SdpObserver {
    override fun onCreateSuccess(description: SessionDescription) = Unit
    override fun onSetSuccess() = Unit
    override fun onCreateFailure(error: String) = Unit
    override fun onSetFailure(error: String) = Unit
}
