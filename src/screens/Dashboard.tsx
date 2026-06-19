import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  Alert
} from 'react-native';
import { Camera, CameraView, useCameraPermissions } from 'expo-camera';
import Svg, { Line, Circle } from 'react-native-svg';
import { Platform } from 'react-native';
import CameraPoseTrackerView from '../components/CameraPoseTrackerView';
import NetInfo from '@react-native-community/netinfo';
import AnatomyHeatmap from '../components/AnatomyHeatmap';
import RepCounterDial from '../components/RepCounterDial';
import {
  initDb,
  startWorkoutSession,
  getWorkoutSessionsHistory,
  updateSessionDuration,
  getUnsyncedSessions,
  getUnsyncedTelemetry,
  markSessionsAsSynced,
  WorkoutSession,
  getSessionTelemetry,
  getCachedModule
} from '../database/sqlite';
import {
  Point,
  JointFilter,
  evaluateSquat,
  evaluatePushUp,
  evaluateDumbbellFly,
  ExerciseEvaluation,
  evaluateDynamicExercise
} from '../engines/motionMath';
import { RepetitionStateMachine, RepState } from '../engines/stateMachine';
import { playRepCompletionChime, speakVocalCoachingAlert } from '../engines/audioSynthesizer';
import { downloadExerciseModule } from '../engines/moduleManager';

type ScreenMode = 'SETUP' | 'WORKOUT' | 'HISTORY';

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      resolve();
      return;
    }
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script ${src}`));
    document.head.appendChild(script);
  });
}

export default function Dashboard() {
  const [screenMode, setScreenMode] = useState<ScreenMode>('SETUP');
  const [exercise, setExercise] = useState<'squat' | 'pushup' | 'dumbbell_fly'>('squat');
  
  // Dynamic server module cache states
  const [isModuleDownloaded, setIsModuleDownloaded] = useState<boolean>(false);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  
  // Camera & Device warning status
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [permission, requestPermission] = useCameraPermissions();

  // Web MediaPipe states
  const [mediaPipeLoaded, setMediaPipeLoaded] = useState(false);
  const poseLandmarkerRef = useRef<any>(null);
  const requestRef = useRef<number | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') {
      loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/vision_bundle.js')
        .then(() => {
          setMediaPipeLoaded(true);
        })
        .catch(err => console.error("Failed to load MediaPipe Web SDK", err));
    }
  }, []);
  
  // Real-time telemetry states
  const [reps, setReps] = useState<number>(0);
  const [accuracy, setAccuracy] = useState<number>(100);
  const [duration, setDuration] = useState<number>(0);
  const [warningMsg, setWarningMsg] = useState<string>('');
  const [repState, setRepState] = useState<RepState>(1);
  const [primaryEngagement, setPrimaryEngagement] = useState<number>(0);
  const [secondaryEngagement, setSecondaryEngagement] = useState<number>(0);
  const [currentAngle, setCurrentAngle] = useState<number>(170);
  const [landmarks, setLandmarks] = useState<Point[]>([]);
  
  // Database & Sync states
  const [history, setHistory] = useState<WorkoutSession[]>([]);
  const [selectedSessionTelemetry, setSelectedSessionTelemetry] = useState<any[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [syncStatus, setSyncStatus] = useState<string>('Idle');

  // Slider Biometric inputs for testing the mathematical pipeline
  const [kneeSlider, setKneeSlider] = useState<number>(170);
  const [spineSlider, setSpineSlider] = useState<number>(170);
  const [elbowSlider, setElbowSlider] = useState<number>(170);
  const [hipSagSlider, setHipSagSlider] = useState<number>(0); // vertical sag deviation %
  const [abductionSlider, setAbductionSlider] = useState<number>(30); // Flyes opening angle

  // Active workout session reference IDs
  const activeSessionIdRef = useRef<string | null>(null);
  const stateMachineRef = useRef<RepetitionStateMachine | null>(null);
  const jointFilterRef = useRef<JointFilter>(new JointFilter());
  const timerRef = useRef<any>(null);

  // TV Remote Focus Emulation State
  const [focusedId, setFocusedId] = useState<string>('ex_squat');
  const [showExitModal, setShowExitModal] = useState<boolean>(false);

  // Layout responsiveness
  const { width, height } = Dimensions.get('window');
  const isWidescreen = width > height;

  useEffect(() => {
    initDb();
    loadHistory();

    // Subscribe to Network Info
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOnline(state.isConnected ?? false);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Sync worker simulator
  useEffect(() => {
    if (isOnline) {
      triggerBackgroundSync();
    }
  }, [isOnline]);

  const loadHistory = () => {
    try {
      const logs = getWorkoutSessionsHistory();
      setHistory(logs);
    } catch (err) {
      console.warn("Failed to load DB history logs", err);
    }
  };

  // Check module cache status whenever selected exercise changes
  useEffect(() => {
    const cached = getCachedModule(exercise);
    setIsModuleDownloaded(!!cached);
  }, [exercise]);

  const handleDownloadModule = async () => {
    if (isDownloading) return;
    
    if (!isOnline) {
      Alert.alert(
        "Internet Connection Required",
        `Downloading the ${exercise.toUpperCase().replace('_', ' ')} module for the first time requires an active network connection.`
      );
      return;
    }

    setIsDownloading(true);
    setDownloadProgress(0);
    try {
      await downloadExerciseModule(exercise, (progress) => {
        setDownloadProgress(progress);
      });
      setIsModuleDownloaded(true);
      Alert.alert("Success", `${exercise.toUpperCase().replace('_', ' ')} module downloaded successfully and cached offline.`);
    } catch (err: any) {
      Alert.alert("Download Failed", err.message || "An error occurred during download.");
    } finally {
      setIsDownloading(false);
    }
  };

  const initWebMediaPipe = async () => {
    try {
      const FilesetResolver = (window as any).vision?.FilesetResolver || (window as any).FilesetResolver;
      const PoseLandmarker = (window as any).vision?.PoseLandmarker || (window as any).PoseLandmarker;
      
      if (!FilesetResolver || !PoseLandmarker) {
        console.warn("MediaPipe SDK objects not found on window");
        setWarningMsg("MediaPipe SDK loading... Please verify internet connectivity.");
        return;
      }

      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
      );
      
      let landmarker;
      try {
        landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numPoses: 1
        });
      } catch (gpuErr) {
        console.warn("MediaPipe GPU delegate failed, trying CPU fallback...", gpuErr);
        landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
            delegate: "CPU"
          },
          runningMode: "VIDEO",
          numPoses: 1
        });
      }
      
      poseLandmarkerRef.current = landmarker;
      setWarningMsg("");
      startWebCamera();
    } catch (err) {
      console.error("Failed to initialize Web MediaPipe", err);
      setWarningMsg("Failed to load tracking model. Using offline sliders.");
    }
  };

  const startWebCamera = () => {
    const video = document.getElementById('web-camera-feed') as HTMLVideoElement;
    if (video) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error("Camera API blocked: Browser requires HTTPS or localhost.");
        setHasCameraPermission(false);
        setWarningMsg("Browser blocked camera (insecure context). Use HTTPS or localhost.");
        return;
      }
      navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
        .then(stream => {
          video.srcObject = stream;
          video.addEventListener('loadeddata', predictWebLoop);
          setHasCameraPermission(true);
          setWarningMsg("");
        })
        .catch(err => {
          console.error("Failed to start web camera stream", err);
          setHasCameraPermission(false);
          setWarningMsg("Camera access denied or device occupied.");
        });
    }
  };

  const predictWebLoop = () => {
    const video = document.getElementById('web-camera-feed') as HTMLVideoElement;
    const landmarker = poseLandmarkerRef.current;
    
    if (video && landmarker && activeSessionIdRef.current) {
      try {
        const results = landmarker.detectForVideo(video, performance.now());
        if (results && results.landmarks && results.landmarks.length > 0) {
          const rawPoints = results.landmarks[0]; // 33 landmarks
          
          // Map to our Point interface
          const mappedPoints: Point[] = rawPoints.map((pt: any) => ({
            x: pt.x,
            y: pt.y,
            visibility: pt.visibility ?? 0.8
          }));
          
          // Filter coordinates via Savitzky-Golay
          const smoothed = jointFilterRef.current.filterLandmarks(mappedPoints);
          setLandmarks(smoothed);
          
          // Evaluate exercise metrics dynamically using downloaded module schema
          const schemaJson = getCachedModule(exercise) || '{}';
          const result = evaluateDynamicExercise(smoothed, schemaJson);
          
          setCurrentAngle(result.targetAngle);
          setPrimaryEngagement(result.muscleEngagement.primary);
          setSecondaryEngagement(result.muscleEngagement.secondary);
          
          if (result.warnings.length > 0) {
            setWarningMsg(result.warnings[0]);
            speakVocalCoachingAlert(result.warnings[0]);
          } else {
            setWarningMsg('');
          }
          
          if (stateMachineRef.current) {
            stateMachineRef.current.processFrame(result);
          }
        }
      } catch (err) {
        console.warn("Prediction frame processing error", err);
      }
      
      requestRef.current = requestAnimationFrame(predictWebLoop);
    }
  };

  const handleStartWorkout = async () => {
    let granted = false;
    if (Platform.OS === 'web') {
      granted = true; // Web uses navigator.mediaDevices in initWebMediaPipe
      setHasCameraPermission(true);
    } else {
      // Request camera permission and wait for response
      try {
        const response = await requestPermission();
        granted = response.granted;
        setHasCameraPermission(granted);
      } catch (err) {
        console.warn("Error requesting camera permission", err);
        setHasCameraPermission(false);
      }

      if (!granted) {
        Alert.alert(
          "Camera Warning",
          "No video input device found or camera permission denied. Please connect a camera to continue."
        );
      }
    }
    
    // Create new session log
    const sessionId = startWorkoutSession('usr_default_athlete_id', exercise);
    activeSessionIdRef.current = sessionId;
    
    // Initialize tracking variables
    setReps(0);
    setAccuracy(100);
    setDuration(0);
    setWarningMsg('');
    setRepState(1);
    setPrimaryEngagement(0);
    setSecondaryEngagement(0);
    
    // Reset sliders depending on exercise
    if (exercise === 'squat') {
      setCurrentAngle(170);
      setKneeSlider(170);
      setSpineSlider(170);
    } else if (exercise === 'pushup') {
      setCurrentAngle(170);
      setElbowSlider(170);
      setHipSagSlider(0);
    } else {
      setCurrentAngle(30);
      setAbductionSlider(30);
      setSpineSlider(170);
    }

    // Initialize State Machine
    stateMachineRef.current = new RepetitionStateMachine(
      sessionId,
      exercise,
      (repIndex, score) => {
        if (repIndex > 0) {
          setReps(repIndex);
          setAccuracy(prev => (prev === 100 ? score : (prev + score) / 2));
          playRepCompletionChime();
        } else {
          speakVocalCoachingAlert("GO DEEPER!");
        }
      },
      (state) => {
        setRepState(state);
      }
    );
    
    jointFilterRef.current.clear();
    setCameraActive(true);
    setScreenMode('WORKOUT');
    
    // Start duration clock
    if (timerRef.current) clearInterval(timerRef.current);
    let seconds = 0;
    timerRef.current = setInterval(() => {
      seconds++;
      setDuration(seconds);
      updateSessionDuration(sessionId, seconds);
    }, 1000);

    // Web camera init
    if (Platform.OS === 'web') {
      setTimeout(() => {
        initWebMediaPipe();
      }, 500);
    }

    // Shift D-pad focus
    setFocusedId('btn_finish');
  };

  const handleFinishWorkout = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
    
    // Stop webcam track on Web
    if (Platform.OS === 'web') {
      const video = document.getElementById('web-camera-feed') as HTMLVideoElement;
      if (video && video.srcObject) {
        const stream = video.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    }

    setCameraActive(false);
    activeSessionIdRef.current = null;
    stateMachineRef.current = null;
    loadHistory();
    setScreenMode('HISTORY');
    setFocusedId('btn_back_setup');
  };

  // Process Mock coordinates through mathematical pipeline based on slider state
  const runSlidersPipeline = () => {
    if (!stateMachineRef.current) return;

    // Generate synthetic 33 MediaPipe landmarks based on slider values
    const mockLandmarks: Point[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));

    if (exercise === 'squat') {
      // Squat: Knee (25/26), Hip (23/24), Ankle (27/28), Shoulder (11/12)
      // We simulate joint positions matching kneeSlider & spineSlider
      const kneeRad = (kneeSlider * Math.PI) / 180;
      mockLandmarks[23] = { x: 0.5, y: 0.4, visibility: 0.95 }; // Hip
      // Knee position shifts out depending on knee angle
      mockLandmarks[25] = { x: 0.5 - Math.sin(kneeRad) * 0.1, y: 0.6, visibility: 0.95 }; // Knee
      mockLandmarks[27] = { x: 0.5, y: 0.8, visibility: 0.95 }; // Ankle
      
      // Shoulder position shifts depending on spine angle (Hip is vertex)
      const spineRad = (spineSlider * Math.PI) / 180;
      mockLandmarks[11] = { x: 0.5 + Math.cos(spineRad) * 0.15, y: 0.2, visibility: 0.95 }; // Shoulder
      
      // Toe position (Toe shear test: Knee_X - Toe_X)
      mockLandmarks[31] = { x: 0.48, y: 0.82, visibility: 0.9 }; // Toe

      // Filter landmarks via Savitzky-Golay
      const smoothed = jointFilterRef.current.filterLandmarks(mockLandmarks);
      setLandmarks(smoothed);
      
      // Evaluate dynamically
      const schemaJson = getCachedModule(exercise) || '{}';
      const result = evaluateDynamicExercise(smoothed, schemaJson);
      setCurrentAngle(result.targetAngle);
      setPrimaryEngagement(result.muscleEngagement.primary);
      setSecondaryEngagement(result.muscleEngagement.secondary);
      
      // Update UI alerts
      if (result.warnings.length > 0) {
        setWarningMsg(result.warnings[0]);
        speakVocalCoachingAlert(result.warnings[0]);
      } else {
        setWarningMsg('');
      }

      // Feed into state machine
      stateMachineRef.current.processFrame(result);

    } else if (exercise === 'pushup') {
      // Pushup: Shoulder (11/12), Elbow (13/14), Wrist (15/16), Hip (23/24), Ankle (27/28)
      // Elbow angle slider
      const elbowRad = (elbowSlider * Math.PI) / 180;
      mockLandmarks[11] = { x: 0.3, y: 0.5, visibility: 0.95 }; // Shoulder
      mockLandmarks[13] = { x: 0.3 - Math.sin(elbowRad) * 0.08, y: 0.58, visibility: 0.95 }; // Elbow
      mockLandmarks[15] = { x: 0.3, y: 0.65, visibility: 0.95 }; // Wrist

      // Hip position shifts vertically from shoulder-ankle vector based on hipSagSlider (-50% to +50%)
      mockLandmarks[27] = { x: 0.8, y: 0.5, visibility: 0.95 }; // Ankle
      // Direct midpoint between shoulder and ankle
      const midX = 0.55;
      const midY = 0.5;
      // sag coefficient added to Midpoint Y
      mockLandmarks[23] = { x: midX, y: midY + hipSagSlider / 200, visibility: 0.95 }; // Hip

      const smoothed = jointFilterRef.current.filterLandmarks(mockLandmarks);
      setLandmarks(smoothed);
      const schemaJson = getCachedModule(exercise) || '{}';
      const result = evaluateDynamicExercise(smoothed, schemaJson);
      setCurrentAngle(result.targetAngle);
      setPrimaryEngagement(result.muscleEngagement.primary);
      setSecondaryEngagement(result.muscleEngagement.secondary);

      if (result.warnings.length > 0) {
        setWarningMsg(result.warnings[0]);
        speakVocalCoachingAlert(result.warnings[0]);
      } else {
        setWarningMsg('');
      }

      stateMachineRef.current.processFrame(result);

    } else if (exercise === 'dumbbell_fly') {
      // Flyes: Shoulder (11/12), Elbow (13/14), Hip (23/24)
      const abdRad = (abductionSlider * Math.PI) / 180;
      mockLandmarks[23] = { x: 0.5, y: 0.6, visibility: 0.95 }; // Hip
      mockLandmarks[11] = { x: 0.5, y: 0.3, visibility: 0.95 }; // Shoulder
      // Elbow moves outwards depending on abduction angle
      mockLandmarks[13] = { x: 0.5 - Math.sin(abdRad) * 0.15, y: 0.3 + Math.cos(abdRad) * 0.15, visibility: 0.95 }; // Elbow

      // Spine tilt (Hyperextension check relative to vertical)
      // Spine is shoulder -> hip. We shift shoulder X to simulate backward tilt
      const spineAngle = spineSlider - 170; // tilt offset
      mockLandmarks[11].x = 0.5 + Math.sin((spineAngle * Math.PI) / 180) * 0.3;

      const smoothed = jointFilterRef.current.filterLandmarks(mockLandmarks);
      setLandmarks(smoothed);
      const schemaJson = getCachedModule(exercise) || '{}';
      const result = evaluateDynamicExercise(smoothed, schemaJson);
      setCurrentAngle(result.targetAngle);
      setPrimaryEngagement(result.muscleEngagement.primary);
      setSecondaryEngagement(result.muscleEngagement.secondary);

      if (result.warnings.length > 0) {
        setWarningMsg(result.warnings[0]);
        speakVocalCoachingAlert(result.warnings[0]);
      } else {
        setWarningMsg('');
      }

      stateMachineRef.current.processFrame(result);
    }
  };

  // Run pipeline when sliders modify
  useEffect(() => {
    if (cameraActive) {
      runSlidersPipeline();
    }
  }, [kneeSlider, spineSlider, elbowSlider, hipSagSlider, abductionSlider, cameraActive]);

  const getApiUrl = (path: string): string => {
    if (typeof window !== 'undefined' && window.location) {
      return path;
    }
    const hostedUrl = 'https://AURA-FITNESS-REPLACE-WITH-YOUR-VERCEL-URL.vercel.app';
    return `${hostedUrl}${path}`;
  };

  // Background Sync Worker
  const triggerBackgroundSync = async () => {
    setSyncStatus('Syncing...');
    try {
      const unsynced = getUnsyncedSessions();
      if (unsynced.length === 0) {
        setSyncStatus('Synced (Up-to-date)');
        return;
      }
      
      const telemetry = getUnsyncedTelemetry();
      
      const payload = {
        sync_meta: {
          device_timestamp: Math.floor(Date.now() / 1000),
          local_user_id: 'usr_default_athlete_id'
        },
        payload_queue: {
          sessions: unsynced.map(s => ({
            session_id: s.session_id,
            exercise_key: s.exercise_key,
            total_reps_logged: s.total_reps_logged,
            active_duration_seconds: s.active_duration_seconds,
            started_at: s.started_at
          })),
          telemetry: telemetry
        }
      };

      console.log("Sync Worker sending POST /api/sync payload:", JSON.stringify(payload, null, 2));

      // Fire real HTTP request to Vercel Serverless Sync API
      const response = await fetch(getApiUrl('/api/sync'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Server returned error status ${response.status}`);
      }

      const responseData = await response.json();
      const sessionIdsToMark = responseData.synced_session_ids || unsynced.map(s => s.session_id);
      
      markSessionsAsSynced(sessionIdsToMark);
      loadHistory();
      setSyncStatus(`Sync Successful (${sessionIdsToMark.length} sets uploaded)`);

    } catch (err: any) {
      setSyncStatus('Sync Error');
      console.warn("Background Sync API error", err);
    }
  };

  const handleSelectHistoryLog = (sessionId: string) => {
    try {
      const repsLogs = getSessionTelemetry(sessionId);
      setSelectedSessionId(sessionId);
      setSelectedSessionTelemetry(repsLogs);
    } catch (err) {
      console.warn("Failed to get session telemetry logs", err);
    }
  };

  const handleOpenAdminPortal = () => {
    if (Platform.OS === 'web') {
      window.location.href = '/admin/';
    } else {
      Alert.alert(
        "Web Dashboard",
        "The Admin Portal is a web-based dashboard. Access it via a browser on your Vercel deployment."
      );
    }
  };

  // TV Remote Focus D-Pad Handler Simulation
  const handleDPadPress = (direction: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'SELECT') => {
    if (showExitModal) {
      if (direction === 'LEFT' || direction === 'RIGHT') {
        setFocusedId(prev => (prev === 'btn_exit_confirm_yes' ? 'btn_exit_confirm_no' : 'btn_exit_confirm_yes'));
      } else if (direction === 'SELECT') {
        if (focusedId === 'btn_exit_confirm_yes') {
          setShowExitModal(false);
          handleFinishWorkout();
        } else {
          setShowExitModal(false);
          setFocusedId('btn_finish');
        }
      }
      return;
    }

    if (screenMode === 'SETUP') {
      if (direction === 'DOWN') {
        if (focusedId === 'ex_squat' || focusedId === 'ex_pushup' || focusedId === 'ex_dumbbell_fly') {
          setFocusedId('btn_start');
        } else if (focusedId === 'btn_start') {
          setFocusedId('nav_history');
        } else if (focusedId === 'nav_history') {
          setFocusedId('nav_admin');
        }
      } else if (direction === 'UP') {
        if (focusedId === 'btn_start') {
          setFocusedId('ex_squat');
        } else if (focusedId === 'nav_history') {
          setFocusedId('btn_start');
        } else if (focusedId === 'nav_admin') {
          setFocusedId('nav_history');
        }
      } else if (direction === 'RIGHT') {
        if (focusedId === 'ex_squat') setFocusedId('ex_pushup');
        else if (focusedId === 'ex_pushup') setFocusedId('ex_dumbbell_fly');
      } else if (direction === 'LEFT') {
        if (focusedId === 'ex_dumbbell_fly') setFocusedId('ex_pushup');
        else if (focusedId === 'ex_pushup') setFocusedId('ex_squat');
      } else if (direction === 'SELECT') {
        if (focusedId === 'ex_squat') setExercise('squat');
        else if (focusedId === 'ex_pushup') setExercise('pushup');
        else if (focusedId === 'ex_dumbbell_fly') setExercise('dumbbell_fly');
        else if (focusedId === 'btn_start') {
          if (isModuleDownloaded) {
            handleStartWorkout();
          } else {
            handleDownloadModule();
          }
        }
        else if (focusedId === 'nav_history') {
          setScreenMode('HISTORY');
          setFocusedId('btn_back_setup');
        }
        else if (focusedId === 'nav_admin') {
          handleOpenAdminPortal();
        }
      }
    } else if (screenMode === 'WORKOUT') {
      if (direction === 'SELECT') {
        if (focusedId === 'btn_finish') {
          setShowExitModal(true);
          setFocusedId('btn_exit_confirm_no');
        }
      }
    } else if (screenMode === 'HISTORY') {
      if (direction === 'SELECT') {
        if (focusedId === 'btn_back_setup') {
          setScreenMode('SETUP');
          setFocusedId('ex_squat');
        } else if (focusedId === 'btn_sync_now') {
          triggerBackgroundSync();
        }
      } else if (direction === 'DOWN' && focusedId === 'btn_back_setup') {
        setFocusedId('btn_sync_now');
      } else if (direction === 'UP' && focusedId === 'btn_sync_now') {
        setFocusedId('btn_back_setup');
      }
    }
  };

  const getFocusStyle = (id: string) => {
    return focusedId === id ? styles.focusedNode : {};
  };

  const formatTimer = (secondsCount: number) => {
    const mins = Math.floor(secondsCount / 60);
    const secs = secondsCount % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <View style={styles.container}>
      {/* Dynamic Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>AURA FITNESS</Text>
        <View style={styles.headerBadgeContainer}>
          <View style={[styles.networkDot, { backgroundColor: isOnline ? '#00FF88' : '#FF3366' }]} />
          <Text style={styles.networkText}>{isOnline ? 'ONLINE CLOUD' : 'OFFLINE MODE'}</Text>
          <TouchableOpacity
            style={styles.syncToggleButton}
            onPress={() => setIsOnline(!isOnline)}
          >
            <Text style={styles.syncToggleText}>Toggle Network</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* SETUP SCENE */}
      {screenMode === 'SETUP' && (
        <ScrollView contentContainerStyle={styles.setupScrollContainer}>
          <Text style={styles.sectionTitle}>SELECT WORKOUT ROUTINE</Text>
          
          <View style={isWidescreen ? styles.row : styles.column}>
            {/* Squat Card */}
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => { setExercise('squat'); setFocusedId('ex_squat'); }}
              style={[
                styles.exerciseCard,
                exercise === 'squat' && styles.exerciseCardActive,
                getFocusStyle('ex_squat')
              ]}
            >
              <Text style={styles.exerciseName}>BODYWEIGHT SQUATS</Text>
              <Text style={styles.exerciseDesc}>Calisthenics - Targets Quads and Glutes. Enforces 95° parallel depth.</Text>
            </TouchableOpacity>

            {/* Pushup Card */}
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => { setExercise('pushup'); setFocusedId('ex_pushup'); }}
              style={[
                styles.exerciseCard,
                exercise === 'pushup' && styles.exerciseCardActive,
                getFocusStyle('ex_pushup')
              ]}
            >
              <Text style={styles.exerciseName}>DUMBBELL PUSH-UPS</Text>
              <Text style={styles.exerciseDesc}>Floor - Targets Chest and Triceps. Evaluates 75° depth and spine sag.</Text>
            </TouchableOpacity>

            {/* Flyes Card */}
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => { setExercise('dumbbell_fly'); setFocusedId('ex_dumbbell_fly'); }}
              style={[
                styles.exerciseCard,
                exercise === 'dumbbell_fly' && styles.exerciseCardActive,
                getFocusStyle('ex_dumbbell_fly')
              ]}
            >
              <Text style={styles.exerciseName}>DUMBBELL CHEST FLYES</Text>
              <Text style={styles.exerciseDesc}>Standing - Targets Pectorals and Shoulders. Flags back hyperextension.</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[
              styles.primaryButton,
              !isModuleDownloaded && styles.primaryButtonDownload,
              isDownloading && styles.primaryButtonDisabled,
              getFocusStyle('btn_start')
            ]}
            disabled={isDownloading}
            onPress={isModuleDownloaded ? handleStartWorkout : handleDownloadModule}
          >
            <Text style={[
              styles.primaryButtonText,
              !isModuleDownloaded && styles.primaryButtonTextDownload,
              isDownloading && styles.primaryButtonTextDisabled
            ]}>
              {isDownloading
                ? `DOWNLOADING MODULE... ${downloadProgress}%`
                : isModuleDownloaded
                  ? 'START EXERCISE SESSION'
                  : 'DOWNLOAD EXERCISE MODULE'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryButton, getFocusStyle('nav_history')]}
            onPress={() => { setScreenMode('HISTORY'); setFocusedId('btn_back_setup'); }}
          >
            <Text style={styles.secondaryButtonText}>VIEW WORKOUT LOGS HISTORY</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.adminButton, getFocusStyle('nav_admin')]}
            onPress={handleOpenAdminPortal}
          >
            <Text style={styles.adminButtonText}>OPEN CLOUD ADMIN PORTAL</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* WORKOUT SESSION SCENE */}
      {screenMode === 'WORKOUT' && (
        <View style={isWidescreen ? styles.workoutTvContainer : styles.workoutMobileContainer}>
          
          {/* CAMERA FEED VIEWPORT */}
          <View style={[
            styles.cameraViewport, 
            isWidescreen ? styles.cameraViewportTv : styles.cameraViewportMobile,
            warningMsg !== '' && styles.cameraViewportWarning
          ]}>
            {Platform.OS === 'web' ? (
              <View style={StyleSheet.absoluteFillObject}>
                {React.createElement('video', {
                  id: 'web-camera-feed',
                  autoPlay: true,
                  playsInline: true,
                  style: {
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    transform: 'scaleX(-1)'
                  }
                })}
              </View>
            ) : hasCameraPermission === true ? (
              Platform.OS === 'android' ? (
                <CameraPoseTrackerView
                  style={StyleSheet.absoluteFillObject}
                  onPoseDetected={(event) => {
                    const rawPoints = event.nativeEvent.landmarks;
                    if (rawPoints && rawPoints.length > 0) {
                      const smoothed = jointFilterRef.current.filterLandmarks(rawPoints);
                      setLandmarks(smoothed);
                      
                      const schemaJson = getCachedModule(exercise) || '{}';
                      const result = evaluateDynamicExercise(smoothed, schemaJson);
                      
                      setCurrentAngle(result.targetAngle);
                      setPrimaryEngagement(result.muscleEngagement.primary);
                      setSecondaryEngagement(result.muscleEngagement.secondary);
                      
                      if (result.warnings.length > 0) {
                        setWarningMsg(result.warnings[0]);
                        speakVocalCoachingAlert(result.warnings[0]);
                      } else {
                        setWarningMsg('');
                      }
                      
                      if (stateMachineRef.current) {
                        stateMachineRef.current.processFrame(result);
                      }
                    }
                  }}
                />
              ) : (
                <CameraView style={StyleSheet.absoluteFillObject} facing="front">
                  <View style={styles.nativeNoticeOverlay}>
                    <Text style={styles.nativeNoticeText}>Live Mirror Active</Text>
                    <Text style={styles.nativeNoticeSubText}>
                      Real-time AI pose tracking runs on the Web build.
                    </Text>
                    <Text style={styles.nativeNoticeSubText}>
                      Open the app in a web browser to use camera tracking.
                    </Text>
                  </View>
                </CameraView>
              )
            ) : (
              /* Camera Frame Viewport Overlay for warning */
              <View style={styles.cameraWarningOverlay}>
                <Text style={styles.cameraWarningSymbol}>⚠</Text>
                <Text style={styles.cameraWarningText}>
                  No video input device found or camera permission denied. Please connect a camera to continue.
                </Text>
                <Text style={styles.cameraSubText}>
                  Note: Real-time pose tracking is running in the Web build.
                </Text>
              </View>
            )}

            {/* SKELETON SVG OVERLAY LAYER */}
            {cameraActive && (Platform.OS === 'web' || Platform.OS === 'android') && landmarks.length >= 33 && (
              <Svg style={StyleSheet.absoluteFillObject} viewBox="0 0 100 100">
                {/* Left Side: Shoulder(11) -> Hip(23) -> Knee(25) -> Ankle(27) */}
                <Line
                  x1={landmarks[11].x * 100}
                  y1={landmarks[11].y * 100}
                  x2={landmarks[23].x * 100}
                  y2={landmarks[23].y * 100}
                  stroke={warningMsg !== '' ? '#FF3366' : '#00FF88'}
                  strokeWidth="2"
                />
                <Line
                  x1={landmarks[23].x * 100}
                  y1={landmarks[23].y * 100}
                  x2={landmarks[25].x * 100}
                  y2={landmarks[25].y * 100}
                  stroke={warningMsg !== '' ? '#FF3366' : '#00FF88'}
                  strokeWidth="2"
                />
                <Line
                  x1={landmarks[25].x * 100}
                  y1={landmarks[25].y * 100}
                  x2={landmarks[27].x * 100}
                  y2={landmarks[27].y * 100}
                  stroke={warningMsg !== '' ? '#FF3366' : '#00FF88'}
                  strokeWidth="2"
                />

                {/* Right Side: Shoulder(12) -> Hip(24) -> Knee(26) -> Ankle(28) */}
                <Line
                  x1={landmarks[12].x * 100}
                  y1={landmarks[12].y * 100}
                  x2={landmarks[24].x * 100}
                  y2={landmarks[24].y * 100}
                  stroke={warningMsg !== '' ? '#FF3366' : '#00FF88'}
                  strokeWidth="2"
                />
                <Line
                  x1={landmarks[24].x * 100}
                  y1={landmarks[24].y * 100}
                  x2={landmarks[26].x * 100}
                  y2={landmarks[26].y * 100}
                  stroke={warningMsg !== '' ? '#FF3366' : '#00FF88'}
                  strokeWidth="2"
                />
                <Line
                  x1={landmarks[26].x * 100}
                  y1={landmarks[26].y * 100}
                  x2={landmarks[28].x * 100}
                  y2={landmarks[28].y * 100}
                  stroke={warningMsg !== '' ? '#FF3366' : '#00FF88'}
                  strokeWidth="2"
                />

                {/* Connecting lines */}
                <Line
                  x1={landmarks[11].x * 100}
                  y1={landmarks[11].y * 100}
                  x2={landmarks[12].x * 100}
                  y2={landmarks[12].y * 100}
                  stroke={warningMsg !== '' ? '#FF3366' : '#00FF88'}
                  strokeWidth="2"
                />
                <Line
                  x1={landmarks[23].x * 100}
                  y1={landmarks[23].y * 100}
                  x2={landmarks[24].x * 100}
                  y2={landmarks[24].y * 100}
                  stroke={warningMsg !== '' ? '#FF3366' : '#00FF88'}
                  strokeWidth="2"
                />

                {/* Arms and exercise-specific additions */}
                {exercise === 'pushup' && (
                  <>
                    <Line
                      x1={landmarks[11].x * 100}
                      y1={landmarks[11].y * 100}
                      x2={landmarks[13].x * 100}
                      y2={landmarks[13].y * 100}
                      stroke={warningMsg !== '' ? '#FF3366' : '#00FF88'}
                      strokeWidth="2"
                    />
                    <Line
                      x1={landmarks[13].x * 100}
                      y1={landmarks[13].y * 100}
                      x2={landmarks[15].x * 100}
                      y2={landmarks[15].y * 100}
                      stroke={warningMsg !== '' ? '#FF3366' : '#00FF88'}
                      strokeWidth="2"
                    />
                  </>
                )}
                {exercise === 'dumbbell_fly' && (
                  <>
                    <Line
                      x1={landmarks[11].x * 100}
                      y1={landmarks[11].y * 100}
                      x2={landmarks[13].x * 100}
                      y2={landmarks[13].y * 100}
                      stroke={warningMsg !== '' ? '#FF3366' : '#00FF88'}
                      strokeWidth="2"
                    />
                  </>
                )}

                {/* Joints Markers */}
                <Circle cx={landmarks[11].x * 100} cy={landmarks[11].y * 100} r="3" fill="#FFFFFF" />
                <Circle cx={landmarks[12].x * 100} cy={landmarks[12].y * 100} r="3" fill="#FFFFFF" />
                <Circle cx={landmarks[23].x * 100} cy={landmarks[23].y * 100} r="3" fill="#FFFFFF" />
                <Circle cx={landmarks[24].x * 100} cy={landmarks[24].y * 100} r="3" fill="#FFFFFF" />
                {exercise === 'squat' && (
                  <>
                    <Circle cx={landmarks[25].x * 100} cy={landmarks[25].y * 100} r="3" fill="#FFFFFF" />
                    <Circle cx={landmarks[26].x * 100} cy={landmarks[26].y * 100} r="3" fill="#FFFFFF" />
                  </>
                )}
                {exercise === 'pushup' && (
                  <>
                    <Circle cx={landmarks[13].x * 100} cy={landmarks[13].y * 100} r="3" fill="#FFFFFF" />
                    <Circle cx={landmarks[15].x * 100} cy={landmarks[15].y * 100} r="3" fill="#FFFFFF" />
                  </>
                )}
                {exercise === 'dumbbell_fly' && (
                  <>
                    <Circle cx={landmarks[13].x * 100} cy={landmarks[13].y * 100} r="3" fill="#FFFFFF" />
                  </>
                )}
              </Svg>
            )}

            {/* Posture Warning HUD HUD Alerts */}
            {warningMsg !== '' && (
              <View style={styles.hudAlert}>
                <Text style={styles.hudAlertText}>{warningMsg}</Text>
              </View>
            )}

            {/* Active Rep State Label */}
            <View style={styles.stateLabelBadge}>
              <Text style={styles.stateLabelBadgeText}>
                STATE: {repState === 1 ? 'UP' : repState === 2 ? 'DOWN' : repState === 3 ? 'ASCENDING' : 'VALIDATING'}
              </Text>
            </View>
          </View>

          {/* TELEMETRY & HEATMAP SIDEBAR */}
          <ScrollView style={isWidescreen ? styles.sidebarTv : styles.sidebarMobile}>
            
            {/* Top metrics dials */}
            <RepCounterDial
              reps={reps}
              targetReps={15}
              accuracy={accuracy}
              isActive={warningMsg === ''}
            />

            <View style={styles.metricsRowMini}>
              <View style={styles.metricMiniBlock}>
                <Text style={styles.miniLabel}>ELAPSED TIMER</Text>
                <Text style={styles.miniValue}>{formatTimer(duration)}</Text>
              </View>
              <View style={styles.metricMiniBlock}>
                <Text style={styles.miniLabel}>ACTIVE JOINT ANGLE</Text>
                <Text style={styles.miniValue}>{Math.round(currentAngle)}°</Text>
              </View>
            </View>

            {/* SVG Anatomy Heatmap */}
            <Text style={styles.panelTitle}>ANATOMICAL MUSCLE ENGAGEMENT</Text>
            <AnatomyHeatmap
              primaryEngagement={primaryEngagement}
              secondaryEngagement={secondaryEngagement}
              exerciseKey={exercise}
            />

            {/* Debug calibration panel removed from UI */}

            {/* Action Buttons */}
            <TouchableOpacity
              style={[styles.primaryButton, getFocusStyle('btn_finish')]}
              onPress={() => handleDPadPress('SELECT')}
            >
              <Text style={styles.primaryButtonText}>FINISH EXERCISE SESSION</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      {/* HISTORY WORKOUT LOGS SCENE */}
      {screenMode === 'HISTORY' && (
        <ScrollView contentContainerStyle={styles.setupScrollContainer}>
          <Text style={styles.sectionTitle}>WORKOUT SESSION HISTORY DATABASE</Text>
          <Text style={styles.syncStatusText}>Cloud Status: {syncStatus}</Text>

          <TouchableOpacity
            style={[styles.syncButton, getFocusStyle('btn_sync_now')]}
            onPress={() => handleDPadPress('SELECT')}
          >
            <Text style={styles.syncButtonText}>SYNC LOCAL DB TO CLOUD</Text>
          </TouchableOpacity>

          <View style={styles.historyList}>
            {history.map((log) => (
              <TouchableOpacity
                key={log.session_id}
                style={[
                  styles.historyCard,
                  selectedSessionId === log.session_id && styles.historyCardSelected
                ]}
                onPress={() => handleSelectHistoryLog(log.session_id)}
              >
                <View style={styles.historyCardHeader}>
                  <Text style={styles.historyExerciseName}>
                    {log.exercise_key.toUpperCase()} - {log.total_reps_logged} REPS
                  </Text>
                  <Text style={styles.syncStatusTag}>
                    {log.is_synced === 1 ? '✅ Synced' : '⏳ Unsynced'}
                  </Text>
                </View>
                <Text style={styles.historyTime}>
                  Started: {new Date(log.started_at * 1000).toLocaleString()}
                </Text>
                <Text style={styles.historyDuration}>
                  Duration: {formatTimer(log.active_duration_seconds)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Granular rep telemetry detail list */}
          {selectedSessionId && (
            <View style={styles.telemetrySection}>
              <Text style={styles.telemetryTitle}>GRANULAR REPETITION TELEMETRY DETAILS</Text>
              {selectedSessionTelemetry.length === 0 ? (
                <Text style={styles.noData}>No repetitions logged or depth requirements not achieved.</Text>
              ) : (
                selectedSessionTelemetry.map((rep) => (
                  <View key={rep.rep_id} style={styles.telemetryCard}>
                    <Text style={styles.telemetryIndex}>Rep #{rep.rep_index}</Text>
                    <Text style={styles.telemetryAngle}>Min Joint Angle: {Math.round(rep.min_joint_angle)}°</Text>
                    <Text style={styles.telemetryScore}>Score: {Math.round(rep.form_accuracy_score)}%</Text>
                    <Text style={styles.telemetryErrors}>
                      Faults: {rep.fault_spine_rounded === 1 ? ' Spine Rounded ' : ''}
                      {rep.fault_knee_shear === 1 ? ' Knee Shear ' : ''}
                      {rep.fault_shallow_depth === 1 ? ' Shallow Depth ' : ''}
                      {rep.fault_spine_rounded === 0 && rep.fault_knee_shear === 0 && rep.fault_shallow_depth === 0 ? 'None' : ''}
                    </Text>
                  </View>
                ))
              )}
            </View>
          )}

          <TouchableOpacity
            style={[styles.secondaryButton, getFocusStyle('btn_back_setup')]}
            onPress={() => { setScreenMode('SETUP'); setFocusedId('ex_squat'); }}
          >
            <Text style={styles.secondaryButtonText}>BACK TO DASHBOARD</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* D-PAD ON-SCREEN TESTING CONTROLLER REMOTE (Hidden for mobile view test) */}
      {false && (
        <View style={styles.remoteControllerContainer}>
          <Text style={styles.remoteTitle}>TV REMOTE D-PAD INTERCEPT (SIMULATOR)</Text>
          <View style={styles.remoteButtonRow}>
            <TouchableOpacity onPress={() => handleDPadPress('UP')} style={styles.remoteBtn}><Text style={styles.remoteBtnText}>▲</Text></TouchableOpacity>
          </View>
          <View style={styles.remoteButtonRow}>
            <TouchableOpacity onPress={() => handleDPadPress('LEFT')} style={styles.remoteBtn}><Text style={styles.remoteBtnText}>◀</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => handleDPadPress('SELECT')} style={[styles.remoteBtn, styles.remoteBtnSelect]}><Text style={styles.remoteSelectText}>OK</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => handleDPadPress('RIGHT')} style={styles.remoteBtn}><Text style={styles.remoteBtnText}>▶</Text></TouchableOpacity>
          </View>
          <View style={styles.remoteButtonRow}>
            <TouchableOpacity onPress={() => handleDPadPress('DOWN')} style={styles.remoteBtn}><Text style={styles.remoteBtnText}>▼</Text></TouchableOpacity>
          </View>
        </View>
      )}

      {/* EXIT WORKOUT SESSION CONFIRMATION MODAL STATE INTERCEPT */}
      {showExitModal && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Confirm Workout Session End?</Text>
            <Text style={styles.modalBody}>
              Are you sure you want to finish the session? Unsaved repetitions will be deleted.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonYes, getFocusStyle('btn_exit_confirm_yes')]}
                onPress={() => { setShowExitModal(false); handleFinishWorkout(); }}
              >
                <Text style={styles.modalButtonText}>Finish Session</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonNo, getFocusStyle('btn_exit_confirm_no')]}
                onPress={() => { setShowExitModal(false); setFocusedId('btn_finish'); }}
              >
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0E17', // Background Midnight Core
    paddingTop: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#1E293B',
  },
  headerTitle: {
    color: '#00FF88', // Neon Emerald
    fontSize: 24,
    fontWeight: '800',
    fontFamily: 'Montserrat',
    letterSpacing: -1,
  },
  headerBadgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  networkDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  networkText: {
    color: '#94A3B8',
    fontSize: 12,
    fontFamily: 'Inter',
    fontWeight: '600',
    marginRight: 12,
  },
  syncToggleButton: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  syncToggleText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'Inter',
  },
  setupScrollContainer: {
    padding: 24,
    alignItems: 'center',
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    fontFamily: 'Montserrat',
    letterSpacing: 0.5,
    marginBottom: 24,
    alignSelf: 'flex-start',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 24,
  },
  column: {
    flexDirection: 'column',
    width: '100%',
    marginBottom: 24,
  },
  exerciseCard: {
    flex: 1,
    backgroundColor: '#131D31',
    borderRadius: 12,
    padding: 20,
    marginHorizontal: 8,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: '#1E293B',
    minHeight: 120,
  },
  exerciseCardActive: {
    borderColor: '#00FF88',
    backgroundColor: '#1B2C4E',
  },
  exerciseName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    fontFamily: 'Montserrat',
    marginBottom: 8,
  },
  exerciseDesc: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 16,
    fontFamily: 'Inter',
  },
  primaryButton: {
    backgroundColor: '#00FF88',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 32,
    width: '100%',
    alignItems: 'center',
    marginVertical: 12,
  },
  primaryButtonText: {
    color: '#0A0E17',
    fontSize: 16,
    fontWeight: '800',
    fontFamily: 'Montserrat',
  },
  secondaryButton: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 32,
    width: '100%',
    alignItems: 'center',
    marginVertical: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  secondaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'Montserrat',
  },
  adminButton: {
    backgroundColor: 'rgba(0, 229, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.25)',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 32,
    width: '100%',
    alignItems: 'center',
    marginVertical: 8,
  },
  adminButtonText: {
    color: '#00E5FF',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'Montserrat',
    letterSpacing: 0.5,
  },
  // WORKOUT SCENE LAYOUTS
  workoutTvContainer: {
    flexDirection: 'row',
    flex: 1,
    paddingHorizontal: 24, // TV safe margin
    paddingVertical: 12,
  },
  workoutMobileContainer: {
    flexDirection: 'column',
    flex: 1,
  },
  cameraViewport: {
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 2,
    borderColor: '#1E293B',
  },
  cameraViewportTv: {
    width: '60%',
    height: '95%',
    marginRight: '2%',
    borderRadius: 16,
  },
  cameraViewportMobile: {
    width: '100%',
    height: 300,
  },
  cameraViewportWarning: {
    borderColor: '#FF3366', // Flashes vibrant crimson during faults/warnings
  },
  cameraWarningOverlay: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraWarningSymbol: {
    color: '#FF3366',
    fontSize: 48,
    marginBottom: 12,
  },
  cameraWarningText: {
    color: '#FF3366',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 20,
    fontFamily: 'Inter',
  },
  cameraSubText: {
    color: '#94A3B8',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 12,
    fontFamily: 'Inter',
  },
  hudAlert: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(255, 51, 102, 0.9)', // 4px crimson border style equivalent
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FF3366',
  },
  hudAlertText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
    textAlign: 'center',
    fontFamily: 'Inter',
  },
  stateLabelBadge: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    backgroundColor: '#00FF88',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  stateLabelBadgeText: {
    color: '#0A0E17',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'JetBrains Mono',
  },
  sidebarTv: {
    width: '38%',
    height: '95%',
  },
  sidebarMobile: {
    width: '100%',
    padding: 16,
  },
  panelTitle: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'Inter',
    letterSpacing: 1,
    marginTop: 20,
    marginBottom: 8,
  },
  metricsRowMini: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 12,
  },
  metricMiniBlock: {
    flex: 1,
    backgroundColor: '#131D31',
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  miniLabel: {
    color: '#94A3B8',
    fontSize: 9,
    fontWeight: '700',
    fontFamily: 'Inter',
    marginBottom: 4,
  },
  miniValue: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    fontFamily: 'JetBrains Mono',
  },
  // BIOMETRICS CALIBRATOR DEBUG PANEL
  debugPanel: {
    backgroundColor: '#0A0E17',
    borderWidth: 1,
    borderColor: '#FF3366',
    borderRadius: 12,
    padding: 16,
    marginVertical: 16,
  },
  debugTitle: {
    color: '#FF3366',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'Montserrat',
    marginBottom: 12,
  },
  sliderLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Inter',
    marginTop: 8,
  },
  sliderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 8,
  },
  sliderBtn: {
    backgroundColor: '#1E293B',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FF336633',
  },
  btnTxt: {
    color: '#FF3366',
    fontSize: 20,
    fontWeight: '800',
  },
  sliderValueText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'JetBrains Mono',
  },
  // D-PAD EMULATION REMOTE
  remoteControllerContainer: {
    backgroundColor: '#0A0E17',
    borderWidth: 1,
    borderColor: '#00FF8833',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 24,
    marginVertical: 24,
  },
  remoteTitle: {
    color: '#00FF88',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    fontFamily: 'Inter',
    marginBottom: 12,
  },
  remoteButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
  },
  remoteBtn: {
    backgroundColor: '#1E293B',
    width: 48,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: '#334155',
  },
  remoteBtnSelect: {
    width: 64,
    backgroundColor: '#00FF88',
    borderColor: '#00FF88',
  },
  remoteBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  remoteSelectText: {
    color: '#0A0E17',
    fontSize: 14,
    fontWeight: '800',
  },
  // D-PAD Focus Highlight visual engine
  focusedNode: {
    borderWidth: 2,
    borderColor: '#00FF88', // Neon Emerald border glow boost
    transform: [{ scale: 1.05 }], // Scale scale(1.05) transition 150ms
    shadowColor: '#00FF88',
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  // EXIT MODAL INTERCEPT
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(10, 14, 23, 0.85)', // heavy dark overlay filter blur layer
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  modalCard: {
    backgroundColor: '#131D31',
    borderRadius: 16,
    padding: 24,
    width: '80%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    fontFamily: 'Montserrat',
    marginBottom: 12,
  },
  modalBody: {
    color: '#94A3B8',
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'Inter',
    marginBottom: 24,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  modalButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginLeft: 12,
  },
  modalButtonYes: {
    backgroundColor: '#FF3366', // Crimson
  },
  modalButtonNo: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontFamily: 'Inter',
  },
  // HISTORY VIEW STYLES
  syncStatusText: {
    color: '#94A3B8',
    fontSize: 14,
    fontFamily: 'Inter',
    marginBottom: 12,
  },
  syncButton: {
    backgroundColor: '#1B2C4E',
    borderWidth: 1,
    borderColor: '#00FF88',
    borderRadius: 12,
    paddingVertical: 14,
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
  },
  syncButtonText: {
    color: '#00FF88',
    fontWeight: '800',
    fontFamily: 'Montserrat',
    fontSize: 12,
  },
  historyList: {
    width: '100%',
    marginBottom: 20,
  },
  historyCard: {
    backgroundColor: '#131D31',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginVertical: 6,
    width: '100%',
  },
  historyCardSelected: {
    borderColor: '#FF4500',
  },
  historyCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  historyExerciseName: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontFamily: 'Montserrat',
    fontSize: 14,
  },
  syncStatusTag: {
    fontSize: 11,
    fontFamily: 'Inter',
    fontWeight: '600',
  },
  historyTime: {
    color: '#94A3B8',
    fontSize: 11,
    fontFamily: 'Inter',
    marginBottom: 4,
  },
  historyDuration: {
    color: '#64748B',
    fontSize: 11,
    fontFamily: 'Inter',
  },
  telemetrySection: {
    width: '100%',
    backgroundColor: '#10192A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    padding: 16,
    marginVertical: 12,
  },
  telemetryTitle: {
    color: '#FF4500',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'Montserrat',
    marginBottom: 12,
  },
  noData: {
    color: '#64748B',
    fontSize: 12,
    fontFamily: 'Inter',
    textAlign: 'center',
    padding: 12,
  },
  telemetryCard: {
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    paddingVertical: 10,
  },
  telemetryIndex: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'Inter',
  },
  telemetryAngle: {
    color: '#94A3B8',
    fontSize: 12,
    fontFamily: 'Inter',
    marginTop: 2,
  },
  telemetryScore: {
    color: '#00FF88',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Inter',
    marginTop: 2,
  },
  telemetryErrors: {
    color: '#FF3366',
    fontSize: 11,
    fontFamily: 'Inter',
    marginTop: 4,
  },
  primaryButtonDownload: {
    backgroundColor: '#FF4500', // Premium Orange alert accent
  },
  primaryButtonDisabled: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  primaryButtonTextDownload: {
    color: '#FFFFFF',
  },
  primaryButtonTextDisabled: {
    color: '#64748B',
  },
  nativeNoticeOverlay: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
  },
  nativeNoticeText: {
    color: '#00FF88',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'Montserrat',
    marginBottom: 2,
  },
  nativeNoticeSubText: {
    color: '#94A3B8',
    fontSize: 10,
    fontFamily: 'Inter',
    textAlign: 'center',
  }
});
