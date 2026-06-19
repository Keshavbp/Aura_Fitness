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
  // Accuracy text color based on score thresholds
  let accuracyColor = '#00FF88'; // Emerald
  if (accuracy < 70) {
    accuracyColor = '#FF3366'; // Crimson
  } else if (accuracy < 85) {
    accuracyColor = '#FFB800'; // Amber/Orange
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
    backgroundColor: '#0F172A',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#1E293B',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  activeContainer: {
    borderColor: '#00FF88', // Glowing Neon Emerald when active
    shadowColor: '#00FF88',
    shadowOpacity: 0.1,
    shadowRadius: 16,
  },
  block: {
    flex: 1,
    alignItems: 'center',
  },
  label: {
    color: '#94A3B8',
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
    color: '#FFFFFF',
    fontSize: 80, // Large telemetry display
    fontWeight: '800',
    fontFamily: 'JetBrains Mono', // Prevents tabular shifting
    includeFontPadding: false,
  },
  separator: {
    color: '#475569',
    fontSize: 48,
    fontWeight: '300',
    marginHorizontal: 8,
    fontFamily: 'JetBrains Mono',
  },
  targetNumber: {
    color: '#64748B',
    fontSize: 40,
    fontWeight: '700',
    fontFamily: 'JetBrains Mono',
  },
  percent: {
    color: '#64748B',
    fontSize: 32,
    fontWeight: '700',
    fontFamily: 'JetBrains Mono',
    marginLeft: 4,
  },
  divider: {
    width: 1,
    height: '80%',
    backgroundColor: '#334155',
    marginHorizontal: 12,
  },
});
