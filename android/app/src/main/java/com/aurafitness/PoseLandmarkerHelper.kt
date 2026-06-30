package com.aurafitness

import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarkerResult

class PoseLandmarkerHelper(
    val context: Context,
    var minPoseDetectionConfidence: Float = 0.5F,
    var minPoseTrackingConfidence: Float = 0.5F,
    var minPosePresenceConfidence: Float = 0.5F,
    var currentDelegate: Int = DELEGATE_GPU
) {

    private var poseLandmarker: PoseLandmarker? = null

    init {
        setupPoseLandmarker()
    }

    fun clearPoseLandmarker() {
        poseLandmarker?.close()
        poseLandmarker = null
    }

    fun setupPoseLandmarker() {
        val baseOptionBuilder = BaseOptions.builder()
        baseOptionBuilder.setModelAssetPath("pose_landmarker.task")

        when (currentDelegate) {
            DELEGATE_CPU -> {
                baseOptionBuilder.setDelegate(Delegate.CPU)
            }
            DELEGATE_GPU -> {
                baseOptionBuilder.setDelegate(Delegate.GPU)
            }
        }

        try {
            val optionsBuilder = PoseLandmarker.PoseLandmarkerOptions.builder()
                .setBaseOptions(baseOptionBuilder.build())
                .setMinPoseDetectionConfidence(minPoseDetectionConfidence)
                .setMinTrackingConfidence(minPoseTrackingConfidence)
                .setMinPosePresenceConfidence(minPosePresenceConfidence)
                .setRunningMode(RunningMode.IMAGE)

            val options = optionsBuilder.build()
            poseLandmarker = PoseLandmarker.createFromOptions(context, options)
        } catch (e: IllegalStateException) {
            Log.e(TAG, "MediaPipe Pose Landmarker failed to initialize: " + e.message)
            if (currentDelegate == DELEGATE_GPU) {
                Log.d(TAG, "GPU delegate failed. Retrying with CPU fallback...")
                currentDelegate = DELEGATE_CPU
                setupPoseLandmarker()
            }
        } catch (e: Exception) {
            Log.e(TAG, "MediaPipe Pose Landmarker failed to create: " + e.message)
        }
    }

    fun detect(bitmap: Bitmap): PoseLandmarkerResult? {
        if (poseLandmarker == null) {
            return null
        }
        val mpImage = BitmapImageBuilder(bitmap).build()
        return try {
            poseLandmarker?.detect(mpImage)
        } catch (e: Exception) {
            Log.e(TAG, "Error running pose landmarker: ${e.message}")
            null
        }
    }

    companion object {
        const val DELEGATE_CPU = 0
        const val DELEGATE_GPU = 1
        private const val TAG = "PoseLandmarkerHelper"
    }
}
