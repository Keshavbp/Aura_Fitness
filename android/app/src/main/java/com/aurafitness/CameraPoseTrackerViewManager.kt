package com.aurafitness

import com.facebook.react.common.MapBuilder
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext

class CameraPoseTrackerViewManager : SimpleViewManager<CameraPoseTrackerView>() {

    override fun getName(): String {
        return REACT_CLASS
    }

    override fun createViewInstance(reactContext: ThemedReactContext): CameraPoseTrackerView {
        return CameraPoseTrackerView(reactContext)
    }

    override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any>? {
        return MapBuilder.builder<String, Any>()
            .put("topPoseDetected", MapBuilder.of("registrationName", "onPoseDetected"))
            .build()
    }

    companion object {
        const val REACT_CLASS = "CameraPoseTrackerView"
    }
}
