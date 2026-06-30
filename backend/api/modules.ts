import type { VercelRequest, VercelResponse } from '@vercel/node';

// Dynamic Exercise Module JSON Schema interfaces
export interface JointPoints {
  p1: number[];
  p2: number[];
  p3: number[];
}

export type ExerciseRule = any;

export interface DynamicExerciseSchema {
  exercise_key: string;
  display_name: string;
  category: string;
  description: string;
  primary_joints: JointPoints;
  muscle_engagement: {
    primary: {
      type: 'linear_angle';
      rest_angle: number;
      active_angle: number;
      muscle: string;
    };
    secondary: {
      type: 'scaled';
      base: 'primary';
      factor: number;
      muscle: string;
    };
  };
  rules: ExerciseRule[];
}

export const MODULES_REGISTRY: Record<string, DynamicExerciseSchema> = {
  squat: {
    exercise_key: 'squat',
    display_name: 'BODYWEIGHT SQUATS',
    category: 'Calisthenics',
    description: 'Calisthenics - Targets Quads and Glutes. Enforces 95° parallel depth.',
    primary_joints: {
      p1: [23, 24],
      p2: [25, 26],
      p3: [27, 28]
    },
    muscle_engagement: {
      primary: {
        type: 'linear_angle',
        rest_angle: 170,
        active_angle: 90,
        muscle: 'quads'
      },
      secondary: {
        type: 'scaled',
        base: 'primary',
        factor: 0.8,
        muscle: 'glutes'
      }
    },
    rules: [
      {
        id: 'spine_rounded',
        type: 'angle',
        joints: {
          p1: [11, 12],
          p2: [23, 24],
          p3: [25, 26]
        },
        threshold: 138,
        comparison: 'less_than',
        deduction: 30,
        warning: 'STRAIGHTEN YOUR BACK!'
      },
      {
        id: 'knee_shear',
        type: 'toe_shear',
        knee: [25, 26],
        toe: [31, 32],
        threshold: 0.04,
        deduction: 20,
        warning: 'KEEP KNEES BEHIND TOES!'
      },
      {
        id: 'shallow_depth',
        type: 'angle',
        joints: {
          p1: [23, 24],
          p2: [25, 26],
          p3: [27, 28]
        },
        threshold: 95,
        comparison: 'greater_than',
        deduction: 0,
        warning: 'GO DEEPER!',
        warning_range: [95, 140]
      }
    ]
  },
  pushup: {
    exercise_key: 'pushup',
    display_name: 'DUMBBELL PUSH-UPS',
    category: 'Floor',
    description: 'Floor - Targets Chest and Triceps. Evaluates 75° depth and spine sag.',
    primary_joints: {
      p1: [11, 12],
      p2: [13, 14],
      p3: [15, 16]
    },
    muscle_engagement: {
      primary: {
        type: 'linear_angle',
        rest_angle: 165,
        active_angle: 75,
        muscle: 'chest'
      },
      secondary: {
        type: 'scaled',
        base: 'primary',
        factor: 0.7,
        muscle: 'triceps'
      }
    },
    rules: [
      {
        id: 'shallow_depth',
        type: 'angle',
        joints: {
          p1: [11, 12],
          p2: [13, 14],
          p3: [15, 16]
        },
        threshold: 75,
        comparison: 'greater_than',
        deduction: 0,
        warning: 'GO DEEPER!',
        warning_range: [75, 140]
      },
      {
        id: 'alignment_faults',
        type: 'alignment',
        shoulder: [11, 12],
        hip: [23, 24],
        ankle: [27, 28],
        threshold_percent: 0.12,
        sag_deduction: 25,
        pike_deduction: 25,
        sag_warning: 'STRAIGHTEN BODY - HIPS SAGGING!',
        pike_warning: 'LOWER YOUR HIPS!'
      }
    ]
  },
  dumbbell_fly: {
    exercise_key: 'dumbbell_fly',
    display_name: 'DUMBBELL CHEST FLYES',
    category: 'Standing',
    description: 'Standing - Targets Pectorals and Shoulders. Flags back hyperextension.',
    primary_joints: {
      p1: [13, 14],
      p2: [11, 12],
      p3: [23, 24]
    },
    muscle_engagement: {
      primary: {
        type: 'linear_angle',
        rest_angle: 30,
        active_angle: 100,
        muscle: 'chest'
      },
      secondary: {
        type: 'scaled',
        base: 'primary',
        factor: 0.6,
        muscle: 'shoulders'
      }
    },
    rules: [
      {
        id: 'over_extend',
        type: 'angle',
        joints: {
          p1: [13, 14],
          p2: [11, 12],
          p3: [23, 24]
        },
        threshold: 110,
        comparison: 'greater_than',
        deduction: 0,
        warning: 'DONT OVER-EXTEND ARMS!'
      },
      {
        id: 'under_extend',
        type: 'angle',
        joints: {
          p1: [13, 14],
          p2: [11, 12],
          p3: [23, 24]
        },
        threshold: 30,
        comparison: 'less_than',
        deduction: 0,
        warning: 'OPEN YOUR CHEST!'
      },
      {
        id: 'trunk_stability',
        type: 'trunk_stability',
        shoulder: [11, 12],
        hip: [23, 24],
        threshold_degrees: 15,
        deduction: 30,
        warning: 'STABILIZE CORE - AVOID HYPEREXTENSION!'
      }
    ]
  }
};

import { verifyAccessToken, extractToken, setCorsHeaders } from './utils/auth';

export default function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res, 'GET,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Security Check: Verify Access Token or Mobile API Key Signature
  const token = extractToken(req.headers);
  const mobileApiKey = process.env.MOBILE_API_KEY || 'aura-mobile-key-123';

  const isAuthorized = token && (verifyAccessToken(token) !== null || token === mobileApiKey);

  if (!isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized: Invalid access token or API signature.' });
  }

  const { key } = req.query;

  if (key) {
    const exerciseKey = String(key).toLowerCase();
    const moduleSchema = MODULES_REGISTRY[exerciseKey];
    if (!moduleSchema) {
      return res.status(404).json({ error: `Module for '${exerciseKey}' not found.` });
    }
    return res.status(200).json(moduleSchema);
  }

  // Otherwise return full registry index
  return res.status(200).json(MODULES_REGISTRY);
}
