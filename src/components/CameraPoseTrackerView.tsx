import React from 'react';
import { requireNativeComponent, ViewProps } from 'react-native';
import { Point } from '../engines/motionMath';

export interface PoseDetectedEvent {
  nativeEvent: {
    landmarks: Point[];
  };
}

export interface CameraPoseTrackerViewProps extends ViewProps {
  onPoseDetected?: (event: PoseDetectedEvent) => void;
}

// Links directly to the CameraPoseTrackerView registered by the Kotlin View Manager
const NativeCameraPoseTrackerView = requireNativeComponent<CameraPoseTrackerViewProps>('CameraPoseTrackerView');

export const CameraPoseTrackerView: React.FC<CameraPoseTrackerViewProps> = (props) => {
  return <NativeCameraPoseTrackerView {...props} />;
};

export default CameraPoseTrackerView;
