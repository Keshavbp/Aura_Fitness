export interface Point {
  x: number;
  y: number;
  visibility?: number;
}

export function calculateAngle(p1: Point, p2: Point, p3: Point): number {
  const angleRad = Math.abs(
    Math.atan2(p3.y - p2.y, p3.x - p2.x) - Math.atan2(p1.y - p2.y, p1.x - p2.x)
  );
  let angleDeg = angleRad * (180 / Math.PI);
  if (angleDeg > 180) {
    angleDeg = 360 - angleDeg;
  }
  return angleDeg;
}

// 2nd-order Savitzky-Golay smoothing for a 7-frame window (center point)
export function savitzkyGolaySmooth(buffer: number[]): number {
  if (buffer.length < 7) {
    return buffer.reduce((a, b) => a + b, 0) / buffer.length;
  }
  const coef = [-2, 3, 6, 7, 6, 3, -2];
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    sum += buffer[i] * coef[i];
  }
  return sum / 21;
}

export class JointFilter {
  private history: Map<number, { x: number[]; y: number[] }> = new Map();

  // Smooth a set of landmarks (0-32). Returns the smoothed landmarks.
  public filterLandmarks(landmarks: Point[]): Point[] {
    if (!landmarks || landmarks.length === 0) return [];
    
    return landmarks.map((lm, idx) => {
      if (!this.history.has(idx)) {
        this.history.set(idx, { x: [], y: [] });
      }
      
      const ptHist = this.history.get(idx)!;
      ptHist.x.push(lm.x);
      ptHist.y.push(lm.y);
      
      if (ptHist.x.length > 7) ptHist.x.shift();
      if (ptHist.y.length > 7) ptHist.y.shift();
      
      return {
        x: savitzkyGolaySmooth(ptHist.x),
        y: savitzkyGolaySmooth(ptHist.y),
        visibility: lm.visibility
      };
    });
  }

  public clear() {
    this.history.clear();
  }
}

export interface ExerciseEvaluation {
  targetAngle: number;
  formAccuracy: number; // 30.0 - 100.0
  faultSpineRounded: boolean;
  faultKneeShear: boolean;
  faultShallowDepth: boolean;
  warnings: string[];
  muscleEngagement: {
    primary: number;   // 0.0 - 1.0
    secondary: number; // 0.0 - 1.0
  };
}

export function evaluateSquat(landmarks: Point[]): ExerciseEvaluation {
  if (landmarks.length < 33) {
    return createEmptyEvaluation();
  }

  // Choose side with higher visibility (left vs right)
  const leftVisibility = (landmarks[23].visibility ?? 0) + (landmarks[25].visibility ?? 0) + (landmarks[27].visibility ?? 0);
  const rightVisibility = (landmarks[24].visibility ?? 0) + (landmarks[26].visibility ?? 0) + (landmarks[28].visibility ?? 0);
  
  const isLeft = leftVisibility >= rightVisibility;
  
  const hip = isLeft ? landmarks[23] : landmarks[24];
  const knee = isLeft ? landmarks[25] : landmarks[26];
  const ankle = isLeft ? landmarks[27] : landmarks[28];
  const shoulder = isLeft ? landmarks[11] : landmarks[12];
  const toe = isLeft ? landmarks[31] : landmarks[32]; // Toes/Foot index

  // Calculate knee flexion angle (Hip-Knee-Ankle)
  const kneeAngle = calculateAngle(hip, knee, ankle);
  
  // 1. Shallow depth: squat depth parallel threshold (95 degrees or less)
  const faultShallowDepth = kneeAngle > 95;

  // 2. Spine rounding check (Shoulder-Hip-Knee)
  const spineAngle = calculateAngle(shoulder, hip, knee);
  const faultSpineRounded = spineAngle < 138;

  // 3. Knee shear check: Knee_X drifts past Toe_X by more than 0.04 spatial coefficient
  // In profile view: if facing left, toe is to the left of knee. 
  // Let's use absolute difference for robust generic checking.
  const kneeShearDistance = Math.abs(knee.x - toe.x);
  const faultKneeShear = knee.x > toe.x ? (knee.x - toe.x) > 0.04 : false; // knee past toe boundary

  // Form accuracy score calculation (base 100, deduct for faults)
  let deductions = 0;
  const warnings: string[] = [];

  if (faultSpineRounded) {
    deductions += 30;
    warnings.push("STRAIGHTEN YOUR BACK!");
  }
  if (faultKneeShear) {
    deductions += 20;
    warnings.push("KEEP KNEES BEHIND TOES!");
  }
  if (kneeAngle < 140 && faultShallowDepth) {
    warnings.push("GO DEEPER!");
  }

  const formAccuracy = Math.max(30, 100 - deductions);

  // Muscle engagement (Quads/Glutes)
  // At rest (170 deg) -> 0. Engagement increases as knee angle approaches 90 deg.
  const engagement = Math.min(1, Math.max(0, (170 - kneeAngle) / 80));

  return {
    targetAngle: kneeAngle,
    formAccuracy,
    faultSpineRounded,
    faultKneeShear,
    faultShallowDepth,
    warnings,
    muscleEngagement: {
      primary: engagement, // Quads
      secondary: engagement * 0.8 // Glutes
    }
  };
}

export function evaluatePushUp(landmarks: Point[]): ExerciseEvaluation {
  if (landmarks.length < 33) {
    return createEmptyEvaluation();
  }

  const leftVisibility = (landmarks[11].visibility ?? 0) + (landmarks[13].visibility ?? 0) + (landmarks[15].visibility ?? 0);
  const rightVisibility = (landmarks[12].visibility ?? 0) + (landmarks[14].visibility ?? 0) + (landmarks[16].visibility ?? 0);
  
  const isLeft = leftVisibility >= rightVisibility;
  
  const shoulder = isLeft ? landmarks[11] : landmarks[12];
  const elbow = isLeft ? landmarks[13] : landmarks[14];
  const wrist = isLeft ? landmarks[15] : landmarks[16];
  const hip = isLeft ? landmarks[23] : landmarks[24];
  const ankle = isLeft ? landmarks[27] : landmarks[28];

  // Calculate elbow flexion/extension (Shoulder-Elbow-Wrist)
  const elbowAngle = calculateAngle(shoulder, elbow, wrist);

  // Core Alignment Check (Shoulder-Hip-Ankle line deviation)
  // Expected hip position on the line between shoulder and ankle
  // Equation of line in 2D: y_expected = y1 + (x_hip - x1) * (y2 - y1) / (x2 - x1)
  const denom = (ankle.x - shoulder.x) || 0.0001;
  const expectedHipY = shoulder.y + ((hip.x - shoulder.x) * (ankle.y - shoulder.y)) / denom;
  const dy = hip.y - expectedHipY;
  
  // Compute shoulder-ankle vector length as normalization base
  const vectorLength = Math.sqrt(Math.pow(ankle.x - shoulder.x, 2) + Math.pow(ankle.y - shoulder.y, 2)) || 0.0001;
  const hipDeviationPercent = dy / vectorLength;

  // Sagging: Hip Y is greater than expected (closer to bottom of screen/floor)
  // Piking: Hip Y is less than expected (closer to top of screen/ceiling)
  const faultSaggingHips = hipDeviationPercent > 0.12;
  const faultHighPiking = hipDeviationPercent < -0.12;

  let deductions = 0;
  const warnings: string[] = [];

  if (faultSaggingHips) {
    deductions += 25;
    warnings.push("STRAIGHTEN BODY - HIPS SAGGING!");
  } else if (faultHighPiking) {
    deductions += 25;
    warnings.push("LOWER YOUR HIPS!");
  }

  // Check push-up depth
  const faultShallowDepth = elbowAngle > 75;

  if (elbowAngle < 140 && faultShallowDepth) {
    warnings.push("GO DEEPER!");
  }

  const formAccuracy = Math.max(30, 100 - deductions);

  // Chest/Triceps engagement based on elbow angle
  // Rest (165 deg) -> 0. Concentric max at 75 deg.
  const engagement = Math.min(1, Math.max(0, (165 - elbowAngle) / 90));

  return {
    targetAngle: elbowAngle,
    formAccuracy,
    faultSpineRounded: faultHighPiking, // High-piking/sagging mapped to spine rounding fields in DB
    faultKneeShear: faultSaggingHips,
    faultShallowDepth,
    warnings,
    muscleEngagement: {
      primary: engagement, // Chest
      secondary: engagement * 0.7 // Triceps
    }
  };
}

export function evaluateDumbbellFly(landmarks: Point[]): ExerciseEvaluation {
  if (landmarks.length < 33) {
    return createEmptyEvaluation();
  }

  const leftVisibility = (landmarks[11].visibility ?? 0) + (landmarks[13].visibility ?? 0) + (landmarks[23].visibility ?? 0);
  const rightVisibility = (landmarks[12].visibility ?? 0) + (landmarks[14].visibility ?? 0) + (landmarks[24].visibility ?? 0);
  
  const isLeft = leftVisibility >= rightVisibility;

  const shoulder = isLeft ? landmarks[11] : landmarks[12];
  const elbow = isLeft ? landmarks[13] : landmarks[14];
  const hip = isLeft ? landmarks[23] : landmarks[24];
  const ankle = isLeft ? landmarks[27] : landmarks[28];

  // Calculate Shoulder Abduction (Elbow-Shoulder-Hip)
  const abductionAngle = calculateAngle(elbow, shoulder, hip);

  // Trunk stability: spine vector (shoulder -> hip) angle with vertical vector (0, 1)
  const spineDx = hip.x - shoulder.x;
  const spineDy = hip.y - shoulder.y;
  const spineLength = Math.sqrt(spineDx * spineDx + spineDy * spineDy) || 0.0001;
  
  // Angle relative to vertical (dot product with unit vertical vector)
  const cosTheta = spineDy / spineLength;
  const spineAngleWithVertical = Math.acos(Math.max(-1, Math.min(1, cosTheta))) * (180 / Math.PI);
  
  // Hyperextension fault: spine angle with vertical exceeds 15 degrees
  const faultHyperextension = spineAngleWithVertical > 15;

  let deductions = 0;
  const warnings: string[] = [];

  if (faultHyperextension) {
    deductions += 30;
    warnings.push("STABILIZE CORE - AVOID HYPEREXTENSION!");
  }

  // Dumbbell fly range: between 30 and 110 degrees
  const faultShallowDepth = abductionAngle < 30 || abductionAngle > 110;

  if (abductionAngle > 110) {
    warnings.push("DONT OVER-EXTEND ARMS!");
  } else if (abductionAngle < 30) {
    warnings.push("OPEN YOUR CHEST!");
  }

  const formAccuracy = Math.max(30, 100 - deductions);

  // Chest/Shoulders engagement based on abduction range
  // Rest at 30 deg -> max at 90-110 deg.
  const engagement = Math.min(1, Math.max(0, (abductionAngle - 30) / 70));

  return {
    targetAngle: abductionAngle,
    formAccuracy,
    faultSpineRounded: faultHyperextension, // Map to DB columns
    faultKneeShear: false,
    faultShallowDepth,
    warnings,
    muscleEngagement: {
      primary: engagement, // Chest
      secondary: engagement * 0.6 // Shoulders
    }
  };
}

function createEmptyEvaluation(): ExerciseEvaluation {
  return {
    targetAngle: 180,
    formAccuracy: 100,
    faultSpineRounded: false,
    faultKneeShear: false,
    faultShallowDepth: false,
    warnings: [],
    muscleEngagement: { primary: 0, secondary: 0 }
  };
}

export function evaluateDynamicExercise(landmarks: Point[], schemaJson: string): ExerciseEvaluation {
  if (landmarks.length < 33 || !schemaJson || schemaJson === '{}') {
    return createEmptyEvaluation();
  }

  let schema: any;
  try {
    schema = JSON.parse(schemaJson);
  } catch (err) {
    console.warn("Failed to parse exercise schema JSON in evaluator", err);
    return createEmptyEvaluation();
  }

  if (!schema || !schema.primary_joints || !schema.primary_joints.p1 || !schema.primary_joints.p2 || !schema.primary_joints.p3) {
    return createEmptyEvaluation();
  }

  // 1. Choose side with higher visibility (left vs right)
  const leftVis = (landmarks[schema.primary_joints.p1[0]]?.visibility ?? 0) +
                  (landmarks[schema.primary_joints.p2[0]]?.visibility ?? 0) +
                  (landmarks[schema.primary_joints.p3[0]]?.visibility ?? 0);
  
  const rightVis = (landmarks[schema.primary_joints.p1[1]]?.visibility ?? 0) +
                   (landmarks[schema.primary_joints.p2[1]]?.visibility ?? 0) +
                   (landmarks[schema.primary_joints.p3[1]]?.visibility ?? 0);
  
  const isLeft = leftVis >= rightVis;
  const sideIdx = isLeft ? 0 : 1;

  // 2. Calculate target joint flexion/extension angle
  const p1 = landmarks[schema.primary_joints.p1[sideIdx]];
  const p2 = landmarks[schema.primary_joints.p2[sideIdx]];
  const p3 = landmarks[schema.primary_joints.p3[sideIdx]];
  
  if (!p1 || !p2 || !p3) {
    return createEmptyEvaluation();
  }
  
  const targetAngle = calculateAngle(p1, p2, p3);

  let faultSpineRounded = false;
  let faultKneeShear = false;
  let faultShallowDepth = false;
  let deductions = 0;
  const warnings: string[] = [];

  // 3. Process dynamic rules
  if (Array.isArray(schema.rules)) {
    for (const rule of schema.rules) {
      if (!rule || typeof rule !== 'object') continue;

      if (rule.type === 'angle') {
        if (!rule.joints || !rule.joints.p1 || !rule.joints.p2 || !rule.joints.p3) continue;
        const rp1 = landmarks[rule.joints.p1[sideIdx]];
        const rp2 = landmarks[rule.joints.p2[sideIdx]];
        const rp3 = landmarks[rule.joints.p3[sideIdx]];
        if (!rp1 || !rp2 || !rp3) continue;
        const ruleAngle = calculateAngle(rp1, rp2, rp3);
        
        let conditionMet = false;
        if (rule.comparison === 'less_than') {
          conditionMet = ruleAngle < rule.threshold;
        } else if (rule.comparison === 'greater_than') {
          conditionMet = ruleAngle > rule.threshold;
        }

        if (conditionMet) {
          if (rule.id === 'spine_rounded') {
            faultSpineRounded = true;
          } else if (rule.id === 'shallow_depth') {
            faultShallowDepth = true;
          }
          
          deductions += rule.deduction || 0;
          
          // Check if warning range criteria is satisfied
          if (rule.warning_range) {
            const [minLimit, maxLimit] = rule.warning_range;
            if (ruleAngle >= minLimit && ruleAngle <= maxLimit) {
              warnings.push(rule.warning);
            }
          } else {
            warnings.push(rule.warning);
          }
        }
      } 
      
      else if (rule.type === 'toe_shear') {
        if (!rule.knee || !rule.toe) continue;
        const kneePt = landmarks[rule.knee[sideIdx]];
        const toePt = landmarks[rule.toe[sideIdx]];
        if (!kneePt || !toePt) continue;
        
        const isViolated = kneePt.x > toePt.x ? (kneePt.x - toePt.x) > rule.threshold : false;
        if (isViolated) {
          faultKneeShear = true;
          deductions += rule.deduction || 0;
          warnings.push(rule.warning);
        }
      } 
      
      else if (rule.type === 'alignment') {
        if (!rule.shoulder || !rule.hip || !rule.ankle) continue;
        const shPt = landmarks[rule.shoulder[sideIdx]];
        const hipPt = landmarks[rule.hip[sideIdx]];
        const akPt = landmarks[rule.ankle[sideIdx]];
        if (!shPt || !hipPt || !akPt) continue;
        
        const denom = (akPt.x - shPt.x) || 0.0001;
        const expectedHipY = shPt.y + ((hipPt.x - shPt.x) * (akPt.y - shPt.y)) / denom;
        const dy = hipPt.y - expectedHipY;
        
        const vectorLength = Math.sqrt(Math.pow(akPt.x - shPt.x, 2) + Math.pow(akPt.y - shPt.y, 2)) || 0.0001;
        const hipDeviationPercent = dy / vectorLength;
        
        // Sagging check (deviation past positive threshold)
        if (hipDeviationPercent > rule.threshold_percent) {
          faultKneeShear = true; // mapped to knee shear in db columns for pushup
          deductions += rule.sag_deduction || 0;
          warnings.push(rule.sag_warning);
        } 
        // Piking check (deviation below negative threshold)
        else if (hipDeviationPercent < -rule.threshold_percent) {
          faultSpineRounded = true; // mapped to spine rounding in db columns for pushup
          deductions += rule.pike_deduction || 0;
          warnings.push(rule.pike_warning);
        }
      } 
      
      else if (rule.type === 'trunk_stability') {
        if (!rule.shoulder || !rule.hip) continue;
        const shPt = landmarks[rule.shoulder[sideIdx]];
        const hipPt = landmarks[rule.hip[sideIdx]];
        if (!shPt || !hipPt) continue;
        
        const spineDx = hipPt.x - shPt.x;
        const spineDy = hipPt.y - shPt.y;
        const spineLength = Math.sqrt(spineDx * spineDx + spineDy * spineDy) || 0.0001;
        
        const cosTheta = spineDy / spineLength;
        const angleWithVertical = Math.acos(Math.max(-1, Math.min(1, cosTheta))) * (180 / Math.PI);
        
        if (angleWithVertical > rule.threshold_degrees) {
          faultSpineRounded = true; // mapped to spine rounding in db columns for flyes
          deductions += rule.deduction || 0;
          warnings.push(rule.warning);
        }
      }
    }
  }

  const formAccuracy = Math.max(30, 100 - deductions);

  // 4. Calculate dynamic muscle engagement
  let primaryEngagement = 0;
  if (schema.muscle_engagement && schema.muscle_engagement.primary) {
    const primaryConf = schema.muscle_engagement.primary;
    if (primaryConf.type === 'linear_angle') {
      const rest = primaryConf.rest_angle;
      const active = primaryConf.active_angle;
      let eng = 0;
      if (rest > active) {
        eng = (rest - targetAngle) / (rest - active);
      } else {
        eng = (targetAngle - rest) / (active - rest);
      }
      primaryEngagement = Math.min(1, Math.max(0, eng));
    }
  }

  let secondaryEngagement = 0;
  if (schema.muscle_engagement && schema.muscle_engagement.secondary) {
    const secondaryConf = schema.muscle_engagement.secondary;
    if (secondaryConf.type === 'scaled' && secondaryConf.base === 'primary') {
      secondaryEngagement = primaryEngagement * (secondaryConf.factor || 1.0);
    }
  }

  return {
    targetAngle,
    formAccuracy,
    faultSpineRounded,
    faultKneeShear,
    faultShallowDepth,
    warnings,
    muscleEngagement: {
      primary: primaryEngagement,
      secondary: secondaryEngagement
    }
  };
}
