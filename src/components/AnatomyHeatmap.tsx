import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import Svg, { Path, Rect, Circle, G } from 'react-native-svg';

interface AnatomyHeatmapProps {
  primaryEngagement: number; // 0.0 to 1.0
  secondaryEngagement: number; // 0.0 to 1.0
  exerciseKey: string;
}

export default function AnatomyHeatmap({
  primaryEngagement,
  secondaryEngagement,
  exerciseKey
}: AnatomyHeatmapProps) {

  // Helper to interpolate between Slate Charcoal (rgba(30, 41, 59, 0.2)) and Flame Neon Orange (rgba(255, 69, 0, 1.0))
  const getMuscleColor = (intensity: number) => {
    const r = Math.round(30 + (255 - 30) * intensity);
    const g = Math.round(41 + (69 - 41) * intensity);
    const b = Math.round(59 + (0 - 59) * intensity);
    const a = 0.2 + 0.8 * intensity;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  };

  // Determine muscle engagement based on exercise key
  let chestColor = getMuscleColor(0);
  let shoulderColor = getMuscleColor(0);
  let tricepsColor = getMuscleColor(0);
  let quadsColor = getMuscleColor(0);
  let glutesColor = getMuscleColor(0);

  if (exerciseKey === 'squat') {
    quadsColor = getMuscleColor(primaryEngagement);
    glutesColor = getMuscleColor(secondaryEngagement);
  } else if (exerciseKey === 'pushup') {
    chestColor = getMuscleColor(primaryEngagement);
    tricepsColor = getMuscleColor(secondaryEngagement);
  } else if (exerciseKey === 'dumbbell_fly') {
    chestColor = getMuscleColor(primaryEngagement);
    shoulderColor = getMuscleColor(secondaryEngagement);
  }

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {/* Front View */}
        <View style={styles.modelContainer}>
          <Text style={styles.label}>FRONT VIEW</Text>
          <Svg width="120" height="240" viewBox="0 0 120 240">
            {/* Background silhouette base */}
            <G opacity="0.15">
              {/* Head */}
              <Circle cx="60" cy="25" r="12" fill="#E2E8F0" />
              {/* Neck */}
              <Rect x="57" y="37" width="6" height="8" rx="2" fill="#E2E8F0" />
              {/* Torso */}
              <Path d="M40 45 L80 45 L74 110 L46 110 Z" fill="#E2E8F0" />
              {/* Arms */}
              <Path d="M38 45 L26 85 L28 120 L34 120 L33 90 L40 55 Z" fill="#E2E8F0" />
              <Path d="M82 45 L94 85 L92 120 L86 120 L87 90 L80 55 Z" fill="#E2E8F0" />
              {/* Legs */}
              <Path d="M46 112 L38 170 L34 225 L44 225 L46 170 L54 112 Z" fill="#E2E8F0" />
              <Path d="M74 112 L82 170 L86 225 L76 225 L74 170 L66 112 Z" fill="#E2E8F0" />
            </G>

            {/* Dynamic Active Layers */}
            {/* Chest (Pectorals) */}
            <Path d="M43 52 C48 50, 58 50, 60 55 C62 50, 72 50, 77 52 L75 75 L45 75 Z" fill={chestColor} stroke="#FF4500" strokeWidth={exerciseKey === 'pushup' || exerciseKey === 'dumbbell_fly' ? 1.5 : 0.5} />
            
            {/* Shoulders (Deltoids) */}
            <Path d="M37 45 C35 50, 36 58, 41 60 L42 47 Z" fill={shoulderColor} />
            <Path d="M83 45 C85 50, 84 58, 79 60 L78 47 Z" fill={shoulderColor} />

            {/* Quadriceps (Front Thighs) */}
            <Path d="M45 115 L39 168 L48 168 L53 115 Z" fill={quadsColor} stroke="#FF4500" strokeWidth={exerciseKey === 'squat' ? 1.5 : 0.5} />
            <Path d="M75 115 L81 168 L72 168 L67 115 Z" fill={quadsColor} stroke="#FF4500" strokeWidth={exerciseKey === 'squat' ? 1.5 : 0.5} />
          </Svg>
        </View>

        {/* Back View */}
        <View style={styles.modelContainer}>
          <Text style={styles.label}>BACK VIEW</Text>
          <Svg width="120" height="240" viewBox="0 0 120 240">
            {/* Background silhouette base */}
            <G opacity="0.15">
              <Circle cx="60" cy="25" r="12" fill="#E2E8F0" />
              <Rect x="57" y="37" width="6" height="8" rx="2" fill="#E2E8F0" />
              <Path d="M40 45 L80 45 L74 110 L46 110 Z" fill="#E2E8F0" />
              <Path d="M38 45 L26 85 L28 120 L34 120 L33 90 L40 55 Z" fill="#E2E8F0" />
              <Path d="M82 45 L94 85 L92 120 L86 120 L87 90 L80 55 Z" fill="#E2E8F0" />
              <Path d="M46 112 L38 170 L34 225 L44 225 L46 170 L54 112 Z" fill="#E2E8F0" />
              <Path d="M74 112 L82 170 L86 225 L76 225 L74 170 L66 112 Z" fill="#E2E8F0" />
            </G>

            {/* Dynamic Active Layers */}
            {/* Triceps (Back Arms) */}
            <Path d="M35 55 L28 85 L32 85 L37 60 Z" fill={tricepsColor} stroke="#FF4500" strokeWidth={exerciseKey === 'pushup' ? 1.5 : 0.5} />
            <Path d="M85 55 L92 85 L88 85 L83 60 Z" fill={tricepsColor} stroke="#FF4500" strokeWidth={exerciseKey === 'pushup' ? 1.5 : 0.5} />

            {/* Gluteus Maximus (Glutes/Butt) */}
            <Path d="M46 108 C46 100, 58 100, 60 108 C62 100, 74 100, 74 108 L72 128 L48 128 Z" fill={glutesColor} stroke="#FF4500" strokeWidth={exerciseKey === 'squat' ? 1.5 : 0.5} />
          </Svg>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1E293B33', // Slate Charcoal with 20% alpha
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  modelContainer: {
    alignItems: 'center',
  },
  label: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'Inter',
    letterSpacing: 1,
    marginBottom: 8,
  }
});
