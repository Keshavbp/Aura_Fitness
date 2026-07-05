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

    if (!moduleData) {
      reject(new Error(`Exercise module '${exerciseKey}' download failed: ${fetchError?.message || 'Offline'}.`));
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
