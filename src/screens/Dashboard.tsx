import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  Alert,
  TextInput,
  ActivityIndicator,
  Platform
} from 'react-native';
import { Camera, CameraView, useCameraPermissions } from 'expo-camera';
import Svg, { Line, Circle } from 'react-native-svg';
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
  getCachedModule,
  insertOrUpdateUser
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
import * as SecureStore from 'expo-secure-store';

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

  const [showExitModal, setShowExitModal] = useState<boolean>(false);

  // In-memory access token cache
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // User Authentication States
  const [currentUser, setCurrentUser] = useState<{ userId: string; username: string; role: string } | null>(null);
  const [authMode, setAuthMode] = useState<'LOGIN' | 'SIGNUP'>('LOGIN');
  const [authUsername, setAuthUsername] = useState<string>('');
  const [authPassword, setAuthPassword] = useState<string>('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(false);

  // Retry & Sync backoff refs
  const syncAttemptsRef = useRef<number>(0);
  const syncTimerRef = useRef<any>(null);

  // Web MediaPipe states & refs
  const [mediaPipeLoaded, setMediaPipeLoaded] = useState(false);
  const poseLandmarkerRef = useRef<any>(null);
  const requestRef = useRef<any>(null);

  // Helper to ensure we have a valid access token, auto-logging in or refreshing if needed
  const getOrRefreshAccessToken = async (): Promise<string | null> => {
    if (accessToken) return accessToken;

    try {
      const storedRefreshToken = await SecureStore.getItemAsync('aura_refresh_token');
      if (storedRefreshToken) {
        // Try refreshing token
        const refreshResponse = await fetch(hostedUrlPath('/api/auth/refresh'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.EXPO_PUBLIC_API_KEY || 'aura-mobile-key-123'
          },
          body: JSON.stringify({ refreshToken: storedRefreshToken })
        });
        if (refreshResponse.ok) {
          const data = await refreshResponse.json();
          setAccessToken(data.accessToken);
          return data.accessToken;
        }
      }

      // If in guest mode, auto-login using default credentials
      if (!currentUser || currentUser.userId === 'usr_default_athlete_id') {
        const loginResponse = await fetch(hostedUrlPath('/api/auth/login'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.EXPO_PUBLIC_API_KEY || 'aura-mobile-key-123'
          },
          body: JSON.stringify({ username: 'athlete', password: 'athlete123' })
        });

        if (loginResponse.ok) {
          const data = await loginResponse.json();
          setAccessToken(data.accessToken);
          if (data.refreshToken) {
            await SecureStore.setItemAsync('aura_refresh_token', data.refreshToken);
          }
          return data.accessToken;
        }
      }
    } catch (err) {
      console.warn("Failed to retrieve or refresh authentication session", err);
    }
    return null;
  };

  const hostedUrlPath = (path: string): string => {
    const hostedUrl = 'https://aura-fitness-backend.vercel.app';
    return `${hostedUrl}${path}`;
  };

  // Check cached user session on mount
  const checkCachedUserSession = async () => {
    try {
      const token = await getOrRefreshAccessToken();
      if (token) {
        const payload = decodeJwt(token);
        if (payload && payload.userId) {
          const isGuest = payload.userId === 'usr_default_athlete_id';
          setCurrentUser({
            userId: payload.userId,
            username: isGuest ? 'gym_bro_default' : (payload.userId === 'usr_admin_id' ? 'admin' : 'athlete'),
            role: payload.role || 'athlete'
          });
          insertOrUpdateUser(payload.userId, isGuest ? 'gym_bro_default' : (payload.userId === 'usr_admin_id' ? 'admin' : 'athlete'), payload.role || 'athlete');
        }
      }
    } catch (err) {
      console.warn("Failed checking cached user session", err);
    }
  };

  // Submit sign-in / sign-up credentials
  const handleAuthSubmit = async () => {
    if (!authUsername.trim() || !authPassword.trim()) {
      setAuthError('Username and password are required.');
      return;
    }
    setAuthError(null);
    setAuthLoading(true);

    try {
      const endpoint = authMode === 'LOGIN' ? '/api/auth/login' : '/api/auth/signup';
      const response = await fetch(hostedUrlPath(endpoint), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.EXPO_PUBLIC_API_KEY || 'aura-mobile-key-123'
        },
        body: JSON.stringify({
          username: authUsername.trim(),
          password: authPassword.trim()
        })
      });

      const data = await response.json();

      if (!response.ok) {
        setAuthError(data.error || 'Authentication failed.');
        setAuthLoading(false);
        return;
      }

      setAccessToken(data.accessToken);
      if (data.refreshToken) {
        await SecureStore.setItemAsync('aura_refresh_token', data.refreshToken);
      }

      const payload = decodeJwt(data.accessToken);
      const userId = payload?.userId || data.user?.userId || 'usr_unknown';
      const userRole = payload?.role || data.user?.role || 'athlete';

      setCurrentUser({
        userId,
        username: authUsername.trim(),
        role: userRole
      });

      insertOrUpdateUser(userId, authUsername.trim(), userRole);
      setAuthUsername('');
      setAuthPassword('');
      Alert.alert("Welcome", `Logged in as ${authUsername.trim().toUpperCase()}!`);
    } catch (err: any) {
      setAuthError(err.message || 'Connection error. Please try again.');
    } finally {
      setAuthLoading(false);
    }
  };

  // Guest Mode Skip
  const handleGuestMode = async () => {
    setAuthLoading(true);
    try {
      await SecureStore.deleteItemAsync('aura_refresh_token');
      setAccessToken(null);
      
      const guestUser = {
        userId: 'usr_default_athlete_id',
        username: 'gym_bro_default',
        role: 'athlete'
      };
      
      setCurrentUser(guestUser);
      insertOrUpdateUser(guestUser.userId, guestUser.username, guestUser.role);
      
      await getOrRefreshAccessToken();
    } catch (err) {
      console.warn("Failed to enter guest mode", err);
    } finally {
      setAuthLoading(false);
    }
  };

  // Sign Out
  const handleSignOut = async () => {
    try {
      await SecureStore.deleteItemAsync('aura_refresh_token');
      setAccessToken(null);
      setCurrentUser(null);
      setScreenMode('SETUP');
    } catch (err) {
      console.warn("Failed to sign out", err);
    }
  };

  const renderAuthUI = () => {
    return (
      <ScrollView contentContainerStyle={styles.setupScrollContainer}>
        <Text style={styles.sectionTitle}>
          {authMode === 'LOGIN' ? 'ATHLETE SIGN IN' : 'CREATE NEW ACCOUNT'}
        </Text>
        
        <View style={styles.column}>
          <Text style={styles.inputLabel}>Username</Text>
          <TextInput
            style={styles.textInput}
            value={authUsername}
            onChangeText={setAuthUsername}
            placeholder="Enter username"
            placeholderTextColor="#64748B"
            autoCapitalize="none"
          />
          
          <Text style={styles.inputLabel}>Password</Text>
          <TextInput
            style={styles.textInput}
            value={authPassword}
            onChangeText={setAuthPassword}
            placeholder="Enter password"
            placeholderTextColor="#64748B"
            secureTextEntry
            autoCapitalize="none"
          />
          
          {authError && <Text style={styles.authErrorText}>{authError}</Text>}
          
          <TouchableOpacity
            style={[styles.primaryButton, authLoading && styles.primaryButtonDisabled]}
            disabled={authLoading}
            onPress={handleAuthSubmit}
          >
            {authLoading ? (
              <ActivityIndicator color="#0A0E17" style={{ transform: [{ scale: 1 }] }} />
            ) : (
              <Text style={styles.primaryButtonText}>
                {authMode === 'LOGIN' ? 'SIGN IN' : 'REGISTER'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => {
              setAuthMode(authMode === 'LOGIN' ? 'SIGNUP' : 'LOGIN');
              setAuthError(null);
            }}
          >
            <Text style={styles.secondaryButtonText}>
              {authMode === 'LOGIN' ? 'CREATE A NEW ACCOUNT' : 'ALREADY HAVE AN ACCOUNT? SIGN IN'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.guestButton}
            onPress={handleGuestMode}
          >
            <Text style={styles.guestButtonText}>SKIP / GUEST MODE</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  };

  // Pure JS Base64URL JWT Decoder helper
  const decodeJwt = (token: string): any => {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      
      let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const pad = base64.length % 4;
      if (pad) {
        if (pad === 1) return null;
        base64 += new Array(5 - pad).join('=');
      }
      
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      let output = '';
      let buffer = 0;
      let bits = 0;
      
      for (let i = 0; i < base64.length; i++) {
        const char = base64[i];
        if (char === '=') break;
        const val = chars.indexOf(char);
        if (val === -1) continue;
        buffer = (buffer << 6) | val;
        bits += 6;
        if (bits >= 8) {
          bits -= 8;
          output += String.fromCharCode((buffer >> bits) & 0xff);
        }
      }
      return JSON.parse(output);
    } catch (err) {
      console.error("JWT decoding failed", err);
      return null;
    }
  };

  // Layout responsiveness
  const { width, height } = Dimensions.get('window');
  const isWidescreen = width > height;

  useEffect(() => {
    initDb();
    loadHistory();
    checkCachedUserSession();

    if (Platform.OS === 'web') {
      loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/vision_bundle.js')
        .then(() => {
          setMediaPipeLoaded(true);
        })
        .catch(err => console.error("Failed to load MediaPipe Web SDK", err));
    }

    // Subscribe to Network Info
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOnline(state.isConnected ?? false);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) clearInterval(timerRef.current);
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  // Sync worker simulator
  useEffect(() => {
    if (isOnline) {
      syncAttemptsRef.current = 0;
      triggerBackgroundSync();
    } else {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
      setSyncStatus('Offline (Sync Paused)');
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
      const token = await getOrRefreshAccessToken();
      await downloadExerciseModule(exercise, (progress) => {
        setDownloadProgress(progress);
      }, token || undefined);
      setIsModuleDownloaded(true);
      Alert.alert("Success", `${exercise.toUpperCase().replace('_', ' ')} module downloaded successfully and cached offline.`);
    } catch (err: any) {
      Alert.alert("Download Failed", err.message || "An error occurred during download.");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleStartWorkout = async () => {
    try {
      let granted = false;
      // Check existing permission state first to avoid race condition
      // where requestPermission may not be ready on first render
      if (permission?.granted) {
        granted = true;
        setHasCameraPermission(true);
      } else if (requestPermission) {
        try {
          const response = await requestPermission();
          granted = response.granted;
          setHasCameraPermission(granted);
        } catch (err) {
          console.warn("Error requesting camera permission", err);
          setHasCameraPermission(false);
        }
      } else {
        console.warn("requestPermission not ready yet");
        setHasCameraPermission(false);
      }

      if (!granted) {
        Alert.alert(
          "Camera Warning",
          "No video input device found or camera permission denied. Please connect a camera to continue."
        );
      }
      
      // Create new session log
      const userId = currentUser ? currentUser.userId : 'usr_default_athlete_id';
      const sessionId = startWorkoutSession(userId, exercise);
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

    } catch (err) {
      console.error("handleStartWorkout crashed", err);
      Alert.alert(
        "Session Error",
        "Failed to start exercise session. Please restart the app and try again."
      );
    }
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
  };

  // Web MediaPipe functions
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
          
          const mappedPoints: Point[] = rawPoints.map((pt: any) => ({
            x: pt.x,
            y: pt.y,
            visibility: pt.visibility ?? 0.8
          }));
          
          const smoothed = jointFilterRef.current.filterLandmarks(mappedPoints);
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
      } catch (err) {
        console.error("Error in Web MediaPipe prediction loop", err);
      }
      
      requestRef.current = requestAnimationFrame(predictWebLoop);
    }
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
    const hostedUrl = 'https://aura-fitness-backend.vercel.app';
    return `${hostedUrl}${path}`;
  };

  // Background Sync Worker
  const triggerBackgroundSync = async () => {
    setSyncStatus('Syncing...');
    try {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }

      const token = await getOrRefreshAccessToken();
      if (!token) {
        setSyncStatus('Auth Failed');
        return;
      }

      const unsynced = getUnsyncedSessions();
      if (unsynced.length === 0) {
        setSyncStatus('Synced (Up-to-date)');
        return;
      }
      
      const telemetry = getUnsyncedTelemetry();
      
      const payload = {
        sync_meta: {
          device_timestamp: Math.floor(Date.now() / 1000),
          local_user_id: currentUser ? currentUser.userId : 'usr_default_athlete_id'
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
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'x-api-key': process.env.EXPO_PUBLIC_API_KEY || 'aura-mobile-key-123'
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
      syncAttemptsRef.current = 0; // Reset attempts on successful sync

    } catch (err: any) {
      setSyncStatus('Sync Pending (Offline / Retry)');
      console.warn("Background Sync API error", err);

      if (isOnline) {
        syncAttemptsRef.current += 1;
        const delay = Math.min(5000 * Math.pow(2, syncAttemptsRef.current), 60000);
        console.log(`Sync failed. Retrying in ${delay}ms (Attempt #${syncAttemptsRef.current})`);
        
        syncTimerRef.current = setTimeout(() => {
          triggerBackgroundSync();
        }, delay);
      }
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
          {currentUser && (
            <Text style={{ color: '#00E5FF', fontSize: 11, fontFamily: 'Inter', marginRight: 8, fontWeight: '700' }}>
              👤 {currentUser.username.toUpperCase()}
            </Text>
          )}
          <View style={[styles.networkDot, { backgroundColor: isOnline ? '#00FF88' : '#FF3366' }]} />
          <Text style={styles.networkText}>{isOnline ? 'ONLINE CLOUD' : 'OFFLINE MODE'}</Text>
          <TouchableOpacity
            style={styles.syncToggleButton}
            onPress={() => setIsOnline(!isOnline)}
          >
            <Text style={styles.syncToggleText}>Toggle Network</Text>
          </TouchableOpacity>
          {currentUser && (
            <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
              <Text style={styles.signOutButtonText}>LOGOUT</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {currentUser === null ? (
        renderAuthUI()
      ) : (
        <>
          {/* SETUP SCENE */}
          {screenMode === 'SETUP' && (
        <ScrollView contentContainerStyle={styles.setupScrollContainer}>
          <Text style={styles.sectionTitle}>SELECT WORKOUT ROUTINE</Text>
          
          <View style={isWidescreen ? styles.row : styles.column}>
            {/* Squat Card */}
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setExercise('squat')}
              style={[
                styles.exerciseCard,
                exercise === 'squat' && styles.exerciseCardActive
              ]}
            >
              <Text style={styles.exerciseName}>BODYWEIGHT SQUATS</Text>
              <Text style={styles.exerciseDesc}>Calisthenics - Targets Quads and Glutes. Enforces 95° parallel depth.</Text>
            </TouchableOpacity>

            {/* Pushup Card */}
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setExercise('pushup')}
              style={[
                styles.exerciseCard,
                exercise === 'pushup' && styles.exerciseCardActive
              ]}
            >
              <Text style={styles.exerciseName}>DUMBBELL PUSH-UPS</Text>
              <Text style={styles.exerciseDesc}>Floor - Targets Chest and Triceps. Evaluates 75° depth and spine sag.</Text>
            </TouchableOpacity>

            {/* Flyes Card */}
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setExercise('dumbbell_fly')}
              style={[
                styles.exerciseCard,
                exercise === 'dumbbell_fly' && styles.exerciseCardActive
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
              isDownloading && styles.primaryButtonDisabled
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
            style={styles.secondaryButton}
            onPress={() => setScreenMode('HISTORY')}
          >
            <Text style={styles.secondaryButtonText}>VIEW WORKOUT LOGS HISTORY</Text>
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
            {hasCameraPermission === true ? (
              Platform.OS === 'web' ? (
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
              ) : (
                <CameraView style={StyleSheet.absoluteFillObject} facing="front">
                  <View style={styles.nativeNoticeOverlay}>
                    <Text style={styles.nativeNoticeText}>Live Mirror Active</Text>
                    <Text style={styles.nativeNoticeSubText}>
                      Use the calibration sliders below to simulate joint movement.
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
              </View>
            )}

            {/* SKELETON SVG OVERLAY LAYER */}
            {cameraActive && landmarks.length >= 33 && (
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
              style={styles.primaryButton}
              onPress={() => setShowExitModal(true)}
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
            style={styles.syncButton}
            onPress={triggerBackgroundSync}
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
            style={styles.secondaryButton}
            onPress={() => setScreenMode('SETUP')}
          >
            <Text style={styles.secondaryButtonText}>BACK TO DASHBOARD</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
        </>
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
                style={[styles.modalButton, styles.modalButtonYes]}
                onPress={() => { setShowExitModal(false); handleFinishWorkout(); }}
              >
                <Text style={styles.modalButtonText}>Finish Session</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonNo]}
                onPress={() => setShowExitModal(false)}
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
  },
  inputLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Inter',
    marginBottom: 6,
    alignSelf: 'flex-start',
  },
  textInput: {
    width: '100%',
    backgroundColor: '#131D31',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 12,
    color: '#FFFFFF',
    fontFamily: 'Inter',
    marginBottom: 16,
  },
  authErrorText: {
    color: '#FF3366',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Inter',
    marginBottom: 16,
    textAlign: 'center',
  },
  guestButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    paddingVertical: 14,
    width: '100%',
    alignItems: 'center',
    marginVertical: 12,
  },
  guestButtonText: {
    color: '#00E5FF',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'Montserrat',
  },
  signOutButton: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginLeft: 8,
  },
  signOutButtonText: {
    color: '#FF3366',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'Inter',
  }
});
