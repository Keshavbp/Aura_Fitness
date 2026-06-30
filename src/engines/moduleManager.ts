import { saveDownloadedModule } from '../database/sqlite';

// Dynamic Exercise Module JSON Schema interfaces
export interface JointPoints {
  p1: number[]; // Left/Right indices, e.g. [23, 24]
  p2: number[]; // Left/Right indices, e.g. [25, 26]
  p3: number[]; // Left/Right indices, e.g. [27, 28]
}

export interface AngleRule {
  id: string;
  type: 'angle';
  joints: JointPoints;
  threshold: number;
  comparison: 'less_than' | 'greater_than';
  deduction: number;
  warning: string;
  warning_range?: [number, number]; // min and max angles where warning applies
}

export interface AlignmentRule {
  id: string;
  type: 'alignment';
  shoulder: number[];
  hip: number[];
  ankle: number[];
  threshold_percent: number; // e.g. 0.12
  sag_deduction: number;
  pike_deduction: number;
  sag_warning: string;
  pike_warning: string;
}

export interface ShearRule {
  id: string;
  type: 'toe_shear';
  knee: number[];
  toe: number[];
  threshold: number; // e.g. 0.04
  deduction: number;
  warning: string;
}

export interface StabilityRule {
  id: string;
  type: 'trunk_stability';
  shoulder: number[];
  hip: number[];
  threshold_degrees: number; // e.g. 15
  deduction: number;
  warning: string;
}

export type ExerciseRule = AngleRule | AlignmentRule | ShearRule | StabilityRule;

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
      active_angle: number; // angle for max contraction
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

// Simulated server-side registry of exercise modules
const SERVER_MODULES_REGISTRY: Record<string, DynamicExerciseSchema> = {
  squat: {
    exercise_key: 'squat',
    display_name: 'BODYWEIGHT SQUATS',
    category: 'Calisthenics',
    description: 'Calisthenics - Targets Quads and Glutes. Enforces 95° parallel depth.',
    primary_joints: {
      p1: [23, 24], // Hip
      p2: [25, 26], // Knee
      p3: [27, 28]  // Ankle
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
          p1: [11, 12], // Shoulder
          p2: [23, 24], // Hip
          p3: [25, 26]  // Knee
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
      p1: [11, 12], // Shoulder
      p2: [13, 14], // Elbow
      p3: [15, 16]  // Wrist
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
      p1: [13, 14], // Elbow
      p2: [11, 12], // Shoulder
      p3: [23, 24]  // Hip
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

const getApiUrl = (path: string): string => {
  const hostedUrl = process.env.EXPO_PUBLIC_BACKEND_URL || 'https://aura-fitness-backend.vercel.app';
  return `${hostedUrl}${path}`;
};

/**
 * Downloads an exercise module from the remote Vercel API with progress updates.
 * Falls back to the local simulation registry if offline or the server fails.
 * Saves the schema to the local SQLite database/localStorage upon completion.
 */
export function downloadExerciseModule(
  exerciseKey: string,
  onProgress: (percent: number) => void,
  accessToken?: string
): Promise<DynamicExerciseSchema> {
  return new Promise(async (resolve, reject) => {
    let moduleData: DynamicExerciseSchema | null = null;
    let fetchError: any = null;

    try {
      const headers: Record<string, string> = {
        'x-api-key': process.env.EXPO_PUBLIC_API_KEY || 'aura-mobile-key-123'
      };
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }
      const response = await fetch(getApiUrl(`/api/modules?key=${exerciseKey}`), {
        headers
      });
      if (response.ok) {
        moduleData = await response.json();
      } else {
        fetchError = new Error(`Server returned status ${response.status}`);
      }
    } catch (err) {
      fetchError = err;
    }

    // Fallback to local simulation registry if network fetch fails
    if (!moduleData) {
      console.log(`EAS/Vercel network fetch failed: ${fetchError?.message || 'Offline'}. Falling back to local offline registry.`);
      moduleData = SERVER_MODULES_REGISTRY[exerciseKey];
    }

    if (!moduleData) {
      reject(new Error(`Exercise module '${exerciseKey}' not found on server or offline database.`));
      return;
    }

    // Animate download progress bar for premium visual UX feedback
    let progress = 0;
    const finalModuleData = moduleData; // capture for closure
    const interval = setInterval(() => {
      progress += Math.floor(Math.random() * 20) + 10;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        
        try {
          saveDownloadedModule(exerciseKey, JSON.stringify(finalModuleData));
          onProgress(100);
          resolve(finalModuleData);
        } catch (err) {
          reject(new Error(`Failed to save downloaded module: ${err}`));
        }
      } else {
        onProgress(progress);
      }
    }, 100);
  });
}
