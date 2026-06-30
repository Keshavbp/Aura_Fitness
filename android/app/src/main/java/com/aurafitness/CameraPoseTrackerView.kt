package com.aurafitness

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import android.util.Log
import android.view.View.MeasureSpec
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.facebook.react.bridge.Arguments
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.events.RCTEventEmitter
import com.google.common.util.concurrent.ListenableFuture
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class CameraPoseTrackerView(private val reactContext: ThemedReactContext) : FrameLayout(reactContext) {

    private val previewView: PreviewView
    private var cameraProviderFuture: ListenableFuture<ProcessCameraProvider>
    private var poseHelper: PoseLandmarkerHelper? = null
    private var cameraExecutor: ExecutorService
    private var frameCounter = 0

    init {
        layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )

        previewView = PreviewView(reactContext).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            // Force TextureView (compatible mode) to resolve React Native SurfaceView layering / black screen bugs
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            scaleType = PreviewView.ScaleType.FILL_CENTER
        }
        addView(previewView)

        cameraProviderFuture = ProcessCameraProvider.getInstance(reactContext)
        cameraExecutor = Executors.newSingleThreadExecutor()
        poseHelper = PoseLandmarkerHelper(reactContext)
    }

    override fun requestLayout() {
        super.requestLayout()
        post(measureAndLayout)
    }

    private val measureAndLayout = Runnable {
        measure(
            MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
            MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY)
        )
        layout(left, top, right, bottom)
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        super.onLayout(changed, left, top, right, bottom)
        previewView.measure(
            MeasureSpec.makeMeasureSpec(right - left, MeasureSpec.EXACTLY),
            MeasureSpec.makeMeasureSpec(bottom - top, MeasureSpec.EXACTLY)
        )
        previewView.layout(0, 0, right - left, bottom - top)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (hasCameraPermission()) {
            startCamera()
        } else {
            Log.w(TAG, "No camera permission on attaching to window")
        }
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        cameraExecutor.shutdown()
        poseHelper?.clearPoseLandmarker()
        poseHelper = null
    }

    private fun hasCameraPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            reactContext,
            Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun startCamera() {
        cameraProviderFuture.addListener({
            val cameraProvider = cameraProviderFuture.get()
            bindCameraUseCases(cameraProvider)
        }, ContextCompat.getMainExecutor(reactContext))
    }

    @OptIn(ExperimentalGetImage::class)
    private fun bindCameraUseCases(cameraProvider: ProcessCameraProvider) {
        val lifecycleOwner = reactContext.currentActivity as? LifecycleOwner
        if (lifecycleOwner == null) {
            Log.e(TAG, "Current activity is null or not a LifecycleOwner. Cannot bind CameraX.")
            return
        }

        val cameraSelector = CameraSelector.Builder()
            .requireLensFacing(CameraSelector.LENS_FACING_FRONT)
            .build()

        val preview = Preview.Builder().build().also {
            it.setSurfaceProvider(previewView.surfaceProvider)
        }

        val imageAnalysis = ImageAnalysis.Builder()
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build()

        imageAnalysis.setAnalyzer(cameraExecutor) { imageProxy ->
            frameCounter++
            // Process every 2nd frame to balance CPU performance
            if (frameCounter % 2 != 0) {
                imageProxy.close()
                return@setAnalyzer
            }

            try {
                val originalBitmap = imageProxy.toBitmap()
                val rotationDegrees = imageProxy.imageInfo.rotationDegrees

                // Rotate and horizontally mirror for preview match
                val matrix = Matrix().apply {
                    postRotate(rotationDegrees.toFloat())
                    postScale(-1f, 1f)
                }
                val processedBitmap = Bitmap.createBitmap(
                    originalBitmap,
                    0, 0,
                    originalBitmap.width,
                    originalBitmap.height,
                    matrix,
                    true
                )

                val result = poseHelper?.detect(processedBitmap)
                if (result != null && result.landmarks().isNotEmpty()) {
                    val firstPose = result.landmarks()[0]
                    
                    val landmarksArray = Arguments.createArray()
                    for (landmark in firstPose) {
                        val pt = Arguments.createMap().apply {
                            putDouble("x", landmark.x().toDouble())
                            putDouble("y", landmark.y().toDouble())
                            putDouble("z", landmark.z().toDouble())
                            putDouble("visibility", landmark.presence().orElse(0.8f).toDouble())
                        }
                        landmarksArray.pushMap(pt)
                    }

                    val event = Arguments.createMap().apply {
                        putArray("landmarks", landmarksArray)
                    }
                    
                    reactContext.runOnUiQueueThread {
                        reactContext.getJSModule(RCTEventEmitter::class.java).receiveEvent(
                            id,
                            "topPoseDetected",
                            event
                        )
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error in frame analysis loop: ${e.message}")
            } finally {
                imageProxy.close()
            }
        }

        try {
            cameraProvider.unbindAll()
            cameraProvider.bindToLifecycle(
                lifecycleOwner,
                cameraSelector,
                preview,
                imageAnalysis
            )
        } catch (exc: Exception) {
            Log.e(TAG, "Use case binding failed", exc)
        }
    }

    companion object {
        private const val TAG = "CameraPoseTrackerView"
    }
}
