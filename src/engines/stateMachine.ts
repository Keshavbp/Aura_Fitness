import { ExerciseEvaluation } from './motionMath';
import { logRepTelemetry, incrementSessionReps } from '../database/sqlite';

export type RepState = 1 | 2 | 3 | 4; // 1 = UP/Rest, 2 = DOWN/Concentric, 3 = ASCENDING/Eccentric, 4 = COMPLETION

export class RepetitionStateMachine {
  private currentState: RepState = 1;
  private depthSecured: boolean = false;
  private minAngle: number = 180;
  private maxAngle: number = 0;
  
  // Accumulated faults in current rep
  private faultSpineRounded: boolean = false;
  private faultKneeShear: boolean = false;
  private faultShallowDepth: boolean = false;
  private worstAccuracyScore: number = 100;
  
  private repIndex: number = 0;
  private sessionId: string;
  private exerciseKey: string;
  
  // Audio/UI trigger callbacks
  private onRepCompleted: (repIndex: number, score: number) => void;
  private onStateChange: (state: RepState) => void;

  constructor(
    sessionId: string,
    exerciseKey: string,
    onRepCompleted: (repIndex: number, score: number) => void,
    onStateChange: (state: RepState) => void
  ) {
    this.sessionId = sessionId;
    this.exerciseKey = exerciseKey;
    this.onRepCompleted = onRepCompleted;
    this.onStateChange = onStateChange;
  }

  public processFrame(evalResult: ExerciseEvaluation) {
    const angle = evalResult.targetAngle;

    // Accumulate faults observed during the current rep
    if (evalResult.faultSpineRounded) this.faultSpineRounded = true;
    if (evalResult.faultKneeShear) this.faultKneeShear = true;
    if (evalResult.formAccuracy < this.worstAccuracyScore) {
      this.worstAccuracyScore = evalResult.formAccuracy;
    }

    if (this.exerciseKey === 'dumbbell_fly') {
      this.processDumbbellFlyFrame(angle, evalResult);
    } else {
      this.processSquatOrPushupFrame(angle, evalResult);
    }
  }

  private processSquatOrPushupFrame(angle: number, evalResult: ExerciseEvaluation) {
    const depthThreshold = this.exerciseKey === 'squat' ? 95 : 75; // 95 for Squat, 75 for Push-up

    switch (this.currentState) {
      case 1: // UP (Resting state, angle > 155)
        if (angle < 145) {
          this.transitionTo(2);
          this.minAngle = angle;
          this.faultShallowDepth = evalResult.faultShallowDepth;
        }
        break;

      case 2: // DOWN (Concentric transition, going down)
        if (angle < this.minAngle) {
          this.minAngle = angle;
        }
        
        // Depth threshold security check
        if (angle <= depthThreshold) {
          this.depthSecured = true;
        }

        // Check for transition to Ascending (angle increases from min by > 10 degrees)
        if (angle > this.minAngle + 10) {
          this.transitionTo(3);
        }
        break;

      case 3: // ASCENDING (Eccentric recovery, heading back up)
        // Check for completion (returns above 155)
        if (angle >= 155) {
          this.transitionTo(4);
        }
        break;

      case 4: // COMPLETION (Validation & Save)
        this.validateAndSaveRep();
        this.transitionTo(1);
        break;
    }
  }

  private processDumbbellFlyFrame(angle: number, evalResult: ExerciseEvaluation) {
    // Dumbbell Flyes: Rest (State 1) is closed (abduction angle < 40).
    // State 2 (Concentric) is opening arms (abduction angle > 50).
    // Depth (Max extension): abduction angle >= 90 (limit 110).
    // State 3 (Eccentric) is closing arms (abduction angle < maxAngle - 10).
    // State 4 (Completion): abduction angle < 40.

    switch (this.currentState) {
      case 1: // UP / Rest (Closed posture)
        if (angle > 50) {
          this.transitionTo(2);
          this.maxAngle = angle;
          this.faultShallowDepth = evalResult.faultShallowDepth;
        }
        break;

      case 2: // DOWN / Extension (Opening arms)
        if (angle > this.maxAngle) {
          this.maxAngle = angle;
        }

        if (angle >= 90) {
          this.depthSecured = true;
        }

        if (angle < this.maxAngle - 10) {
          this.transitionTo(3);
        }
        break;

      case 3: // ASCENDING / Flexion (Closing arms)
        if (angle <= 40) {
          this.transitionTo(4);
        }
        break;

      case 4: // COMPLETION
        this.validateAndSaveRep();
        this.transitionTo(1);
        break;
    }
  }

  private transitionTo(nextState: RepState) {
    this.currentState = nextState;
    this.onStateChange(nextState);
  }

  private validateAndSaveRep() {
    if (this.depthSecured) {
      this.repIndex += 1;
      
      // Calculate final accuracy score (incorporate shallow depth penalty if relevant)
      const shallowPenalty = this.faultShallowDepth ? 30 : 0;
      const finalScore = Math.max(30, this.worstAccuracyScore - shallowPenalty);
      
      // Increment rep count in local DB
      incrementSessionReps(this.sessionId);
      
      // Save rep telemetry
      logRepTelemetry(
        this.sessionId,
        this.repIndex,
        this.exerciseKey === 'dumbbell_fly' ? this.maxAngle : this.minAngle,
        finalScore,
        {
          spineRounded: this.faultSpineRounded,
          kneeShear: this.faultKneeShear,
          shallowDepth: this.faultShallowDepth
        }
      );
      
      // Fire callback
      this.onRepCompleted(this.repIndex, finalScore);
    } else {
      // Rep was shallow or incomplete. Do not increment, but we can signal warning.
      this.onRepCompleted(0, 0); // Rep failed
    }

    // Reset rep tracker states
    this.depthSecured = false;
    this.minAngle = 180;
    this.maxAngle = 0;
    this.faultSpineRounded = false;
    this.faultKneeShear = false;
    this.faultShallowDepth = false;
    this.worstAccuracyScore = 100;
  }

  public getCurrentState(): RepState {
    return this.currentState;
  }

  public getRepIndex(): number {
    return this.repIndex;
  }
}
