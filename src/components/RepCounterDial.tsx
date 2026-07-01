import React from 'react';
import { View, StyleSheet, Text } from 'react-native';

interface RepCounterDialProps {
  reps: number;
  targetReps: number;
  accuracy: number;
  isActive: boolean;
}

export default function RepCounterDial({
  reps,
  targetReps,
  accuracy,
  isActive
}: RepCounterDialProps) {
  // Accuracy text color based on Stitch design thresholds
  let accuracyColor = '#10B981'; // Stitch Emerald Green (#10B981)
  if (accuracy < 70) {
    accuracyColor = '#F43F5E'; // Stitch Coral Red (#F43F5E)
  } else if (accuracy < 85) {
    accuracyColor = '#A855F7'; // Stitch Neon Purple (#A855F7)
  }

  return (
    <View style={[styles.container, isActive && styles.activeContainer]}>
      {/* Reps Counter Block */}
      <View style={styles.block}>
        <Text style={styles.label}>REPETITIONS</Text>
        <View style={styles.metricRow}>
          <Text style={styles.massiveNumber}>
            {reps.toString().padStart(2, '0')}
          </Text>
          <Text style={styles.separator}>/</Text>
          <Text style={styles.targetNumber}>
            {targetReps.toString().padStart(2, '0')}
          </Text>
        </View>
      </View>

      {/* Vertical Divider */}
      <View style={styles.divider} />

      {/* Accuracy Score Block */}
      <View style={styles.block}>
        <Text style={styles.label}>FORM ACCURACY</Text>
        <View style={styles.metricRow}>
          <Text style={[styles.massiveNumber, { color: accuracyColor }]}>
            {Math.round(accuracy).toString().padStart(3, ' ')}
          </Text>
          <Text style={styles.percent}>%</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: 'rgba(26, 26, 28, 0.8)', // Glassmorphic background
    borderRadius: 24, // rounded-xl (1.5rem)
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)', // Subtle white border
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    shadowColor: '#A855F7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 5,
  },
  activeContainer: {
    borderColor: '#10B981', // Glows Emerald Green when form is valid
    shadowColor: '#10B981',
    shadowOpacity: 0.25,
    shadowRadius: 20,
  },
  block: {
    flex: 1,
    alignItems: 'center',
  },
  label: {
    color: '#919094', // Stitch outline color
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'Inter',
    letterSpacing: 1.5,
    marginBottom: 12,
    textAlign: 'center',
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
  },
  massiveNumber: {
    color: '#E5E2E1', // Stitch on-surface
    fontSize: 80,
    fontWeight: '800',
    fontFamily: 'JetBrains Mono',
    includeFontPadding: false,
  },
  separator: {
    color: '#46464A', // Stitch outline-variant
    fontSize: 48,
    fontWeight: '300',
    marginHorizontal: 8,
    fontFamily: 'JetBrains Mono',
  },
  targetNumber: {
    color: '#919094', // Stitch outline
    fontSize: 40,
    fontWeight: '700',
    fontFamily: 'JetBrains Mono',
  },
  percent: {
    color: '#919094',
    fontSize: 32,
    fontWeight: '700',
    fontFamily: 'JetBrains Mono',
    marginLeft: 4,
  },
  divider: {
    width: 1,
    height: '80%',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginHorizontal: 12,
  },
});
