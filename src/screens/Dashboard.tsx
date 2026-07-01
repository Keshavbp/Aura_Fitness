import React, { useState, useEffect, useRef, useMemo } from 'react';
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
import CameraPoseTrackerView from '../components/CameraPoseTrackerView';
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
  const [showUserDropdown, setShowUserDropdown] = useState<boolean>(false);
  
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
  const historyMetrics = useMemo(() => {
    const totalWorkouts = history.length;
    const totalReps = history.reduce((sum, item) => sum + (item.total_reps_logged || 0), 0);
    const validAccuracySessions = history.filter(item => item.avg_accuracy !== null && item.avg_accuracy !== undefined);
    const avgAccuracy = validAccuracySessions.length > 0
      ? Math.round(validAccuracySessions.reduce((sum, item) => sum + (item.avg_accuracy || 0), 0) / validAccuracySessions.length)
      : 100;
    return {
      totalWorkouts,
      totalReps,
      avgAccuracy
    };
  }, [history]);

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
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const isPausedRef = useRef<boolean>(false);

  // In-memory access token cache
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // User Authentication States
  const [currentUser, setCurrentUser] = useState<{ userId: string; username: string; role: string } | null>(null);
  const [authMode, setAuthMode] = useState<'LOGIN' | 'SIGNUP'>('LOGIN');
  const [authUsername, setAuthUsername] = useState<string>('');
  const [authPassword, setAuthPassword] = useState<string>('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [authEmail, setAuthEmail] = useState<string>('');
  const [authConfirmPassword, setAuthConfirmPassword] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('CALISTHENICS');
  const [showNotificationPanel, setShowNotificationPanel] = useState<boolean>(false);

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
      if (currentUser?.userId === 'usr_default_athlete_id') {
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
    const hostedUrl = process.env.EXPO_PUBLIC_BACKEND_URL || 'https://aura-fitness-backend.vercel.app';
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
    if (authMode === 'SIGNUP') {
      if (!authEmail.trim()) {
        setAuthError('Email is required.');
        return;
      }
      if (authPassword !== authConfirmPassword) {
        setAuthError('Passwords do not match.');
        return;
      }
    }
    setAuthError(null);
    setAuthLoading(true);

    try {
      const endpoint = authMode === 'LOGIN' ? '/api/auth/login' : '/api/auth/register';
      const bodyPayload: any = {
        username: authUsername.trim(),
        password: authPassword.trim()
      };
      if (authMode === 'SIGNUP') {
        bodyPayload.email = authEmail.trim();
      }
      const response = await fetch(hostedUrlPath(endpoint), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.EXPO_PUBLIC_API_KEY || 'aura-mobile-key-123'
        },
        body: JSON.stringify(bodyPayload)
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
      setAuthEmail('');
      setAuthConfirmPassword('');
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
      setShowUserDropdown(false);
      setScreenMode('SETUP');
    } catch (err) {
      console.warn("Failed to sign out", err);
    }
  };

  const renderAuthUI = () => {
    return (
      <ScrollView contentContainerStyle={styles.authScrollContainer}>
        <View style={styles.authHeaderContainer}>
          <Text style={styles.authTitle}>AURA FITNESS</Text>
          <Text style={styles.authSubtitle}>SMART FORM COACH</Text>
        </View>

        <View style={styles.authCard}>
          <View style={styles.authTabsContainer}>
            <TouchableOpacity
              style={[styles.authTabButton, authMode === 'LOGIN' && styles.authTabButtonActive]}
              onPress={() => { setAuthMode('LOGIN'); setAuthError(null); }}
            >
              <Text style={[styles.authTabButtonText, authMode === 'LOGIN' && styles.authTabButtonTextActive]}>
                SIGN IN
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.authTabButton, authMode === 'SIGNUP' && styles.authTabButtonActive]}
              onPress={() => { setAuthMode('SIGNUP'); setAuthError(null); }}
            >
              <Text style={[styles.authTabButtonText, authMode === 'SIGNUP' && styles.authTabButtonTextActive]}>
                CREATE ACCOUNT
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.authForm}>
            {authMode === 'SIGNUP' && (
              <View style={styles.authInputWrapper}>
                <Text style={styles.authInputLabel}>EMAIL ADDRESS</Text>
                <View style={styles.authInputContainer}>
                  <Text style={styles.authInputIcon}>✉</Text>
                  <TextInput
                    style={styles.authTextInput}
                    value={authEmail}
                    onChangeText={setAuthEmail}
                    placeholder="name@domain.com"
                    placeholderTextColor="#64748B"
                    autoCapitalize="none"
                    keyboardType="email-address"
                  />
                </View>
              </View>
            )}

            <View style={styles.authInputWrapper}>
              <Text style={styles.authInputLabel}>USERNAME</Text>
              <View style={styles.authInputContainer}>
                <Text style={styles.authInputIcon}>👤</Text>
                <TextInput
                  style={styles.authTextInput}
                  value={authUsername}
                  onChangeText={setAuthUsername}
                  placeholder="Enter unique username"
                  placeholderTextColor="#64748B"
                  autoCapitalize="none"
                />
              </View>
            </View>

            <View style={styles.authInputWrapper}>
              <Text style={styles.authInputLabel}>PASSWORD</Text>
              <View style={styles.authInputContainer}>
                <Text style={styles.authInputIcon}>🔒</Text>
                <TextInput
                  style={styles.authTextInput}
                  value={authPassword}
                  onChangeText={setAuthPassword}
                  placeholder="Enter password"
                  placeholderTextColor="#64748B"
                  secureTextEntry
                  autoCapitalize="none"
                />
              </View>
            </View>

            {authMode === 'SIGNUP' && (
              <View style={styles.authInputWrapper}>
                <Text style={styles.authInputLabel}>CONFIRM PASSWORD</Text>
                <View style={styles.authInputContainer}>
                  <Text style={styles.authInputIcon}>🔒</Text>
                  <TextInput
                    style={styles.authTextInput}
                    value={authConfirmPassword}
                    onChangeText={setAuthConfirmPassword}
                    placeholder="Re-enter password"
                    placeholderTextColor="#64748B"
                    secureTextEntry
                    autoCapitalize="none"
                  />
                </View>
              </View>
            )}

            {authError && <Text style={styles.authErrorText}>{authError}</Text>}

            <View style={styles.authActions}>
              <TouchableOpacity
                style={[styles.authPrimaryButton, authLoading && styles.authPrimaryButtonDisabled]}
                disabled={authLoading}
                onPress={handleAuthSubmit}
              >
                {authLoading ? (
                  <ActivityIndicator color="#0A0A0B" />
                ) : (
                  <Text style={styles.authPrimaryButtonText}>
                    {authMode === 'LOGIN' ? 'SIGN IN ATHLETE ➔' : 'CREATE ACCOUNT ➔'}
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.authGuestButton}
                onPress={handleGuestMode}
              >
                <Text style={styles.authGuestButtonText}>SKIP / GUEST MODE</Text>
              </TouchableOpacity>
            </View>
          </View>
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

  const handleDownloadModule = async (exerciseKey?: 'squat' | 'pushup' | 'dumbbell_fly') => {
    const targetExercise = exerciseKey || exercise;
    if (isDownloading) return;
    
    if (!isOnline) {
      Alert.alert(
        "Internet Connection Required",
        `Downloading the ${targetExercise.toUpperCase().replace('_', ' ')} module for the first time requires an active network connection.`
      );
      return;
    }

    setIsDownloading(true);
    setDownloadProgress(0);
    try {
      const token = await getOrRefreshAccessToken();
      await downloadExerciseModule(targetExercise, (progress) => {
        setDownloadProgress(progress);
      }, token || undefined);
      setIsModuleDownloaded(true);
    } catch (err: any) {
      Alert.alert("Download Failed", err.message || "An error occurred during download.");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleStartWorkout = async (exerciseKey?: 'squat' | 'pushup' | 'dumbbell_fly') => {
    const targetExercise = exerciseKey || exercise;
    if (exerciseKey) {
      setExercise(exerciseKey);
    }
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
      const sessionId = startWorkoutSession(userId, targetExercise);
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
      if (targetExercise === 'squat') {
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

  const togglePause = () => {
    isPausedRef.current = !isPausedRef.current;
    setIsPaused(isPausedRef.current);
  };

  const squatCached = !!getCachedModule('squat');
  const pushupCached = !!getCachedModule('pushup');
  const flyCached = !!getCachedModule('dumbbell_fly');

  return (
    <View style={styles.container}>
      {/* Dynamic Header (hidden during active workout and in login screen) */}
      {screenMode !== 'WORKOUT' && currentUser !== null && (
        <View style={styles.header}>
          <View style={styles.leftHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={styles.headerTitle}>AURA FITNESS</Text>
            </View>
            <View style={styles.dropdownContainer}>
              <TouchableOpacity
                style={styles.headerUserDropdownTrigger}
                onPress={() => setShowUserDropdown(!showUserDropdown)}
                activeOpacity={0.7}
              >
                <Text style={styles.headerSubtitle}>
                  👤 {currentUser.username.toUpperCase()}  ▼
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* DesktopCenter Nav Tabs */}
          {isWidescreen && (
            <View style={styles.desktopNavLinks}>
              <TouchableOpacity
                style={[styles.desktopNavLink, screenMode === 'SETUP' && styles.desktopNavLinkActive]}
                onPress={() => setScreenMode('SETUP')}
              >
                <Text style={[styles.desktopNavLinkText, screenMode === 'SETUP' && styles.desktopNavLinkTextActive]}>
                  HOME
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.desktopNavLink, screenMode === 'HISTORY' && styles.desktopNavLinkActive]}
                onPress={() => setScreenMode('HISTORY')}
              >
                <Text style={[styles.desktopNavLinkText, screenMode === 'HISTORY' && styles.desktopNavLinkTextActive]}>
                  HISTORY
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.headerBadgeContainer}>
            <View style={[styles.networkDot, { backgroundColor: isOnline ? '#10B981' : '#F43F5E' }]} />
            <Text style={styles.networkText}>{isOnline ? 'ONLINE' : 'OFFLINE'}</Text>
            <TouchableOpacity 
              style={{ padding: 6, marginLeft: 12 }}
              onPress={() => setShowNotificationPanel(!showNotificationPanel)}
            >
              <Text style={{ fontSize: 20 }}>🔔</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Profile Dropdown Menu Overlay */}
      {currentUser && showUserDropdown && (
        <View style={styles.userDropdownMenu}>
          <TouchableOpacity 
            style={styles.userDropdownItem} 
            onPress={() => {
              setShowUserDropdown(false);
              handleSignOut();
            }}
          >
            <Text style={styles.userDropdownItemText}>LOGOUT</Text>
          </TouchableOpacity>
        </View>
      )}

      {currentUser === null ? (
        renderAuthUI()
      ) : (
        <>
          {/* SETUP SCENE */}
          {screenMode === 'SETUP' && (
            <ScrollView contentContainerStyle={styles.setupScrollContainer}>
              <Text style={styles.sectionTitle}>SELECT AN EXERCISE MODULE</Text>

              {/* Horizontal Category Pill Filter */}
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false} 
                style={styles.categoryScroll} 
                contentContainerStyle={styles.categoryScrollContent}
              >
                {['CALISTHENICS', 'WEIGHTLIFTING', 'CARDIO', 'MOBILITY'].map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[
                      styles.categoryPill,
                      selectedCategory === cat && styles.categoryPillActive
                    ]}
                    onPress={() => setSelectedCategory(cat)}
                  >
                    <Text style={[
                      styles.categoryPillText,
                      selectedCategory === cat && styles.categoryPillTextActive
                    ]}>
                      {cat}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Exercises Bento Cards Grid */}
              <View style={isWidescreen ? styles.row : styles.column}>
                {selectedCategory === 'CALISTHENICS' && (
                  <>
                    {/* Squats Bento Card */}
                    <View style={[styles.exerciseCard, exercise === 'squat' && styles.exerciseCardActive]}>
                      <View style={styles.exerciseCardHeader}>
                        <View>
                          <Text style={styles.exerciseName}>Squats</Text>
                          <View style={styles.chipContainer}>
                            <View style={styles.chip}><Text style={styles.chipText}>LOWER BODY</Text></View>
                            <View style={styles.chip}><Text style={styles.chipText}>CALISTHENICS</Text></View>
                          </View>
                        </View>
                        <View style={styles.exerciseIconContainer}>
                          <Text style={styles.exerciseIcon}>🏋</Text>
                        </View>
                      </View>

                      {/* 10-word Short Description */}
                      <Text style={{ color: '#919094', fontSize: 13, fontFamily: 'Inter', marginVertical: 12 }}>
                        Master parallel depth squat to build leg strength and glutes.
                      </Text>

                      <View style={styles.exerciseCardFooter}>
                        <TouchableOpacity
                          style={[
                            styles.cardActionButton,
                            !squatCached && styles.cardActionButtonDownload,
                            isDownloading && styles.cardActionButtonDisabled
                          ]}
                          disabled={isDownloading}
                          onPress={() => squatCached ? handleStartWorkout('squat') : handleDownloadModule('squat')}
                        >
                          <Text style={[styles.cardActionButtonText, isDownloading && styles.cardActionButtonTextDisabled]}>
                            {isDownloading && exercise === 'squat'
                              ? `DOWNLOADING... ${downloadProgress}%`
                              : squatCached
                                ? 'START WORKOUT ➔'
                                : 'DOWNLOAD MODULE'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    {/* Pushups Bento Card */}
                    <View style={[styles.exerciseCard, exercise === 'pushup' && styles.exerciseCardActive]}>
                      <View style={styles.exerciseCardHeader}>
                        <View>
                          <Text style={styles.exerciseName}>Push-ups</Text>
                          <View style={styles.chipContainer}>
                            <View style={styles.chip}><Text style={styles.chipText}>CHEST & ARMS</Text></View>
                            <View style={styles.chip}><Text style={styles.chipText}>CALISTHENICS</Text></View>
                          </View>
                        </View>
                        <View style={styles.exerciseIconContainer}>
                          <Text style={styles.exerciseIcon}>🤸</Text>
                        </View>
                      </View>

                      {/* 10-word Short Description */}
                      <Text style={{ color: '#919094', fontSize: 13, fontFamily: 'Inter', marginVertical: 12 }}>
                        Classic upper body exercise targeting chest, shoulders, and triceps.
                      </Text>

                      <View style={styles.exerciseCardFooter}>
                        <TouchableOpacity
                          style={[
                            styles.cardActionButton,
                            !pushupCached && styles.cardActionButtonDownload,
                            isDownloading && styles.cardActionButtonDisabled
                          ]}
                          disabled={isDownloading}
                          onPress={() => pushupCached ? handleStartWorkout('pushup') : handleDownloadModule('pushup')}
                        >
                          <Text style={[styles.cardActionButtonText, isDownloading && styles.cardActionButtonTextDisabled]}>
                            {isDownloading && exercise === 'pushup'
                              ? `DOWNLOADING... ${downloadProgress}%`
                              : pushupCached
                                ? 'START WORKOUT ➔'
                                : 'DOWNLOAD MODULE'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </>
                )}

                {selectedCategory === 'WEIGHTLIFTING' && (
                  <>
                    {/* Chest Flyes Bento Card */}
                    <View style={[styles.exerciseCard, exercise === 'dumbbell_fly' && styles.exerciseCardActive]}>
                      <View style={styles.exerciseCardHeader}>
                        <View>
                          <Text style={styles.exerciseName}>Chest Flyes</Text>
                          <View style={styles.chipContainer}>
                            <View style={styles.chip}><Text style={styles.chipText}>PECTORALS</Text></View>
                            <View style={styles.chip}><Text style={styles.chipText}>WEIGHTLIFTING</Text></View>
                          </View>
                        </View>
                        <View style={styles.exerciseIconContainer}>
                          <Text style={styles.exerciseIcon}>💪</Text>
                        </View>
                      </View>

                      {/* 10-word Short Description */}
                      <Text style={{ color: '#919094', fontSize: 13, fontFamily: 'Inter', marginVertical: 12 }}>
                        Isolate pectorals with wide opening chest flyes movement.
                      </Text>

                      <View style={styles.exerciseCardFooter}>
                        <TouchableOpacity
                          style={[
                            styles.cardActionButton,
                            !flyCached && styles.cardActionButtonDownload,
                            isDownloading && styles.cardActionButtonDisabled
                          ]}
                          disabled={isDownloading}
                          onPress={() => flyCached ? handleStartWorkout('dumbbell_fly') : handleDownloadModule('dumbbell_fly')}
                        >
                          <Text style={[styles.cardActionButtonText, isDownloading && styles.cardActionButtonTextDisabled]}>
                            {isDownloading && exercise === 'dumbbell_fly'
                              ? `DOWNLOADING... ${downloadProgress}%`
                              : flyCached
                                ? 'START WORKOUT ➔'
                                : 'DOWNLOAD MODULE'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </>
                )}

                {(selectedCategory === 'CARDIO' || selectedCategory === 'MOBILITY') && (
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40, width: '100%' }}>
                    <Text style={{ fontSize: 32, marginBottom: 8 }}>⏳</Text>
                    <Text style={{ color: '#919094', fontSize: 14, fontFamily: 'Inter', textAlign: 'center' }}>
                      No {selectedCategory.toLowerCase()} routines downloaded or available.
                    </Text>
                  </View>
                )}
              </View>
            </ScrollView>
          )}

      {/* WORKOUT SESSION SCENE */}
      {screenMode === 'WORKOUT' && (
        <View style={StyleSheet.absoluteFillObject}>
          {/* CAMERA FEED VIEWPORT */}
          <View style={StyleSheet.absoluteFillObject}>
            {hasCameraPermission === true ? (
              Platform.OS === 'web' ? (
                <View style={StyleSheet.absoluteFillObject}>
                  {React.createElement('video', {
                    id: 'web-camera-feed',
                    autoPlay: true,
                    playsInline: true,
                    muted: true,
                    style: { width: '100%', height: '100%', objectFit: 'cover' }
                  })}
                </View>
              ) : Platform.OS === 'android' ? (
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
                  stroke={warningMsg !== '' ? '#FFb4ab' : '#4edea3'}
                  strokeWidth="1"
                />
                <Line
                  x1={landmarks[23].x * 100}
                  y1={landmarks[23].y * 100}
                  x2={landmarks[25].x * 100}
                  y2={landmarks[25].y * 100}
                  stroke={warningMsg !== '' ? '#FFb4ab' : '#4edea3'}
                  strokeWidth="1"
                />
                <Line
                  x1={landmarks[25].x * 100}
                  y1={landmarks[25].y * 100}
                  x2={landmarks[27].x * 100}
                  y2={landmarks[27].y * 100}
                  stroke={warningMsg !== '' ? '#FFb4ab' : '#4edea3'}
                  strokeWidth="1"
                />

                {/* Right Side: Shoulder(12) -> Hip(24) -> Knee(26) -> Ankle(28) */}
                <Line
                  x1={landmarks[12].x * 100}
                  y1={landmarks[12].y * 100}
                  x2={landmarks[24].x * 100}
                  y2={landmarks[24].y * 100}
                  stroke={warningMsg !== '' ? '#FFb4ab' : '#4edea3'}
                  strokeWidth="1"
                />
                <Line
                  x1={landmarks[24].x * 100}
                  y1={landmarks[24].y * 100}
                  x2={landmarks[26].x * 100}
                  y2={landmarks[26].y * 100}
                  stroke={warningMsg !== '' ? '#FFb4ab' : '#4edea3'}
                  strokeWidth="1"
                />
                <Line
                  x1={landmarks[26].x * 100}
                  y1={landmarks[26].y * 100}
                  x2={landmarks[28].x * 100}
                  y2={landmarks[28].y * 100}
                  stroke={warningMsg !== '' ? '#FFb4ab' : '#4edea3'}
                  strokeWidth="1"
                />

                {/* Connecting lines */}
                <Line
                  x1={landmarks[11].x * 100}
                  y1={landmarks[11].y * 100}
                  x2={landmarks[12].x * 100}
                  y2={landmarks[12].y * 100}
                  stroke={warningMsg !== '' ? '#FFb4ab' : '#4edea3'}
                  strokeWidth="1"
                />
                <Line
                  x1={landmarks[23].x * 100}
                  y1={landmarks[23].y * 100}
                  x2={landmarks[24].x * 100}
                  y2={landmarks[24].y * 100}
                  stroke={warningMsg !== '' ? '#FFb4ab' : '#4edea3'}
                  strokeWidth="1"
                />

                {/* Arms and exercise-specific additions */}
                {exercise === 'pushup' && (
                  <>
                    <Line
                      x1={landmarks[11].x * 100}
                      y1={landmarks[11].y * 100}
                      x2={landmarks[13].x * 100}
                      y2={landmarks[13].y * 100}
                      stroke={warningMsg !== '' ? '#FFb4ab' : '#4edea3'}
                      strokeWidth="1"
                    />
                    <Line
                      x1={landmarks[13].x * 100}
                      y1={landmarks[13].y * 100}
                      x2={landmarks[15].x * 100}
                      y2={landmarks[15].y * 100}
                      stroke={warningMsg !== '' ? '#FFb4ab' : '#4edea3'}
                      strokeWidth="1"
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
                      stroke={warningMsg !== '' ? '#FFb4ab' : '#4edea3'}
                      strokeWidth="1"
                    />
                  </>
                )}

                {/* Joints Markers */}
                <Circle cx={landmarks[11].x * 100} cy={landmarks[11].y * 100} r="2" fill="#FFFFFF" />
                <Circle cx={landmarks[12].x * 100} cy={landmarks[12].y * 100} r="2" fill="#FFFFFF" />
                <Circle cx={landmarks[23].x * 100} cy={landmarks[23].y * 100} r="2" fill="#FFFFFF" />
                <Circle cx={landmarks[24].x * 100} cy={landmarks[24].y * 100} r="2" fill="#FFFFFF" />
                {exercise === 'squat' && (
                  <>
                    <Circle cx={landmarks[25].x * 100} cy={landmarks[25].y * 100} r="2" fill={warningMsg !== '' ? '#ffb4ab' : '#4edea3'} />
                    <Circle cx={landmarks[26].x * 100} cy={landmarks[26].y * 100} r="2" fill="#FFFFFF" />
                  </>
                )}
                {exercise === 'pushup' && (
                  <>
                    <Circle cx={landmarks[13].x * 100} cy={landmarks[13].y * 100} r="2" fill="#FFFFFF" />
                    <Circle cx={landmarks[15].x * 100} cy={landmarks[15].y * 100} r="2" fill="#FFFFFF" />
                  </>
                )}
                {exercise === 'dumbbell_fly' && (
                  <>
                    <Circle cx={landmarks[13].x * 100} cy={landmarks[13].y * 100} r="2" fill="#FFFFFF" />
                  </>
                )}
              </Svg>
            )}

            {/* Top HUD Elements Overlay */}
            <View style={styles.hudTopRow}>
              {/* Reps Widget */}
              <View style={styles.hudGlassCard}>
                <Text style={styles.hudLabel}>REPS</Text>
                <Text style={styles.hudValueReps}>{reps}</Text>
                <Text style={styles.hudSubLabel}>/ 15</Text>
              </View>

              {/* Form/Accuracy Dial Widget */}
              <View style={styles.hudGlassCard}>
                <Text style={styles.hudLabel}>FORM</Text>
                <View style={styles.hudAccuracyDialContainer}>
                  <Svg width="48" height="48" viewBox="0 0 36 36">
                    <Circle
                      cx="18"
                      cy="18"
                      r="16"
                      fill="none"
                      stroke="#201f1f"
                      strokeWidth="3"
                    />
                    <Circle
                      cx="18"
                      cy="18"
                      r="16"
                      fill="none"
                      stroke="#4edea3"
                      strokeWidth="3"
                      strokeDasharray={`${accuracy}, 100`}
                      strokeLinecap="round"
                      transform="rotate(-90 18 18)"
                    />
                  </Svg>
                  <View style={styles.hudDialTextContainer}>
                    <Text style={styles.hudDialText}>{accuracy}%</Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Center Warning Banner */}
            {warningMsg !== '' && (
              <View style={styles.hudWarningBannerContainer}>
                <View style={styles.hudWarningBanner}>
                  <Text style={styles.hudWarningIcon}>⚠️</Text>
                  <Text style={styles.hudWarningText}>{warningMsg.toUpperCase()}</Text>
                </View>
              </View>
            )}

            {/* Bottom Controls Row */}
            <View style={styles.hudBottomRow}>
              {/* Timer Capsule */}
              <View style={styles.hudTimerCapsule}>
                <View style={[styles.hudTimerDot, isPaused && styles.hudTimerDotPaused]} />
                <Text style={styles.hudTimerText}>{formatTimer(duration)}</Text>
              </View>

              {/* Stop & Pause Buttons */}
              <View style={styles.hudButtonContainer}>
                <TouchableOpacity
                  style={styles.hudStopButton}
                  onPress={() => setShowExitModal(true)}
                >
                  <Text style={styles.hudStopIcon}>⏹</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.hudPauseButton}
                  onPress={togglePause}
                >
                  <Text style={styles.hudPauseIcon}>{isPaused ? '▶' : '⏸'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* HISTORY WORKOUT LOGS SCENE */}
      {screenMode === 'HISTORY' && (
        <ScrollView contentContainerStyle={styles.setupScrollContainer}>
          <Text style={styles.sectionTitle}>WORKOUT HISTORY LOGS</Text>
          
          {/* Bento Grid summary metrics at top of history */}
          <View style={styles.bentoGrid}>
            <View style={styles.bentoCard}>
              <Text style={styles.bentoLabel}>Workouts</Text>
              <Text style={styles.bentoValue}>{historyMetrics.totalWorkouts}</Text>
            </View>
            <View style={styles.bentoCard}>
              <Text style={styles.bentoLabel}>Total Reps</Text>
              <Text style={styles.bentoValue}>{historyMetrics.totalReps}</Text>
            </View>
            <View style={[styles.bentoCard, styles.bentoCardFeatured]}>
              <Text style={[styles.bentoLabel, styles.bentoLabelFeatured]}>Avg Accuracy 📈</Text>
              <Text style={[styles.bentoValue, styles.bentoValueFeatured]}>{historyMetrics.avgAccuracy}%</Text>
            </View>
          </View>

          <Text style={styles.recentActivityTitle}>RECENT ACTIVITY</Text>

          {/* Stitch history activity listings */}
          <View style={styles.historyListStitch}>
            {history.map((log) => {
              const isSquat = log.exercise_key === 'squat';
              const isPushup = log.exercise_key === 'pushup';
              const exIcon = isSquat ? '🏋' : isPushup ? '🤸' : '💪';
              const exName = isSquat ? 'Bodyweight Squats' : isPushup ? 'Push-ups' : 'Dumbbell Chest Flyes';
              const exDate = new Date(log.started_at * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
              
              const scoreVal = log.avg_accuracy ? Math.round(log.avg_accuracy) : 100;
              const isGoodScore = scoreVal >= 80;

              return (
                <TouchableOpacity
                  key={log.session_id}
                  style={[
                    styles.historyCardStitch,
                    selectedSessionId === log.session_id && styles.historyCardStitchSelected
                  ]}
                  onPress={() => handleSelectHistoryLog(log.session_id)}
                >
                  <View style={styles.historyLeft}>
                    <View style={styles.historyIconContainer}>
                      <Text style={{ fontSize: 20 }}>{exIcon}</Text>
                    </View>
                    <View>
                      <Text style={styles.historyExerciseNameStitch}>{exName}</Text>
                      <Text style={styles.historyTimeStitch}>
                        {exDate} • {Math.ceil(log.active_duration_seconds / 60)} min
                      </Text>
                    </View>
                  </View>
                  <View style={styles.historyRight}>
                    <View style={[
                      styles.historyAccuracyBadge,
                      isGoodScore ? styles.historyAccuracyBadgeGreen : styles.historyAccuracyBadgeRed
                    ]}>
                      <Text style={isGoodScore ? styles.historyAccuracyTextGreen : styles.historyAccuracyTextRed}>
                        {isGoodScore ? '✓ ' : '⚠ '}{scoreVal}%
                      </Text>
                    </View>
                    <Text style={styles.historyRepsTextStitch}>
                      {log.total_reps_logged} Reps
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
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
                      Faults: 
                      {rep.fault_knee_shear === 1 ? ' Knee Shear ' : ''}
                      {rep.fault_spine_rounded === 1 ? ' Spine Rounded ' : ''}
                      {rep.fault_shallow_depth === 1 ? ' Shallow Depth ' : ''}
                      {rep.fault_spine_rounded === 0 && rep.fault_knee_shear === 0 && rep.fault_shallow_depth === 0 ? 'None' : ''}
                    </Text>
                  </View>
                ))
              )}
            </View>
          )}

          {/* Sync local db to cloud moved to bottom of content scroll */}
          <Text style={styles.syncStatusText}>Status: {syncStatus}</Text>
          <TouchableOpacity
            style={styles.syncButton}
            onPress={triggerBackgroundSync}
          >
            <Text style={styles.syncButtonText}>SYNC LOGS TO CLOUD</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
        </>
      )}

      {/* Bottom navigation bar for mobile */}
      {currentUser && screenMode !== 'WORKOUT' && (
        <View style={styles.bottomTabBar}>
          <TouchableOpacity 
            style={[styles.tabItem, screenMode === 'SETUP' && styles.tabItemActive]}
            onPress={() => setScreenMode('SETUP')}
          >
            <Text style={styles.tabIcon}>🏠</Text>
            <Text style={[styles.tabLabel, screenMode === 'SETUP' && styles.tabLabelActive]}>HOME</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.tabItem, screenMode === 'HISTORY' && styles.tabItemActive]}
            onPress={() => setScreenMode('HISTORY')}
          >
            <Text style={styles.tabIcon}>📜</Text>
            <Text style={[styles.tabLabel, screenMode === 'HISTORY' && styles.tabLabelActive]}>HISTORY</Text>
          </TouchableOpacity>
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

      {/* NOTIFICATION PANEL MODAL */}
      {showNotificationPanel && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>AURA COACH ALERTS</Text>
            <ScrollView style={{ maxHeight: 200, marginVertical: 8 }}>
              <View style={{ gap: 12 }}>
                <Text style={{ color: '#E5E2E1', fontSize: 13, lineHeight: 18 }}>
                  💡 <Text style={{ fontWeight: '700' }}>Form Tip:</Text> Keep your back straight and core engaged during push-ups to protect the spine.
                </Text>
                <Text style={{ color: '#E5E2E1', fontSize: 13, lineHeight: 18 }}>
                  ✅ <Text style={{ fontWeight: '700' }}>Sync Status:</Text> Local workout logs are fully synchronized with the cloud database.
                </Text>
                <Text style={{ color: '#E5E2E1', fontSize: 13, lineHeight: 18 }}>
                  🔥 <Text style={{ fontWeight: '700' }}>Streak Alert:</Text> Great job! You have logged workouts for 3 consecutive days. Keep it up!
                </Text>
              </View>
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonNo]}
                onPress={() => setShowNotificationPanel(false)}
              >
                <Text style={styles.modalButtonText}>Close</Text>
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
  leftHeader: {
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  dropdownContainer: {
    position: 'relative',
    marginTop: 4,
    zIndex: 1000,
  },
  headerUserDropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
  },
  headerSubtitle: {
    color: '#00E5FF',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'Inter',
  },
  userDropdownMenu: {
    position: 'absolute',
    top: 75,
    left: 24,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    zIndex: 2000,
    minWidth: 120,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  userDropdownItem: {
    paddingVertical: 4,
    width: '100%',
  },
  userDropdownItemText: {
    color: '#FF3366',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'Inter',
    textAlign: 'left',
  },
  // Premium Auth/Login Design Styles
  authScrollContainer: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
    backgroundColor: '#070A0F',
  },
  authHeaderContainer: {
    alignItems: 'center',
    marginBottom: 32,
    marginTop: 20,
  },
  authTitle: {
    color: '#00FF88',
    fontSize: 32,
    fontWeight: '900',
    fontFamily: 'Montserrat',
    letterSpacing: -1,
  },
  authSubtitle: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
    marginTop: 4,
    fontFamily: 'Inter',
  },
  authCard: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1F2937',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 420,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 15,
    elevation: 8,
  },
  authTabsContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
    marginBottom: 24,
  },
  authTabButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  authTabButtonActive: {
    borderBottomColor: '#00FF88',
  },
  authTabButtonText: {
    color: '#6B7280',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'Montserrat',
  },
  authTabButtonTextActive: {
    color: '#00FF88',
  },
  authForm: {
    width: '100%',
  },
  authInputWrapper: {
    marginBottom: 16,
  },
  authInputLabel: {
    color: '#9CA3AF',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'Inter',
    letterSpacing: 1,
    marginBottom: 8,
  },
  authInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 48,
  },
  authInputIcon: {
    fontSize: 16,
    color: '#64748B',
    marginRight: 10,
  },
  authTextInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Inter',
  },
  authActions: {
    marginTop: 24,
    gap: 12,
  },
  authPrimaryButton: {
    backgroundColor: '#00FF88',
    borderRadius: 10,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authPrimaryButtonDisabled: {
    backgroundColor: '#1E293B',
  },
  authPrimaryButtonText: {
    color: '#070A0F',
    fontSize: 14,
    fontWeight: '800',
    fontFamily: 'Montserrat',
  },
  authGuestButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#1F2937',
    borderRadius: 10,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authGuestButtonText: {
    color: '#00E5FF',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'Montserrat',
    letterSpacing: 1,
  },

  // Category and Exercises bento layout styles
  categoryScroll: {
    marginVertical: 16,
    width: '100%',
  },
  categoryScrollContent: {
    paddingHorizontal: 8,
    gap: 12,
  },
  categoryPill: {
    backgroundColor: '#131D31',
    borderWidth: 1,
    borderColor: '#1E293B',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 30,
  },
  categoryPillActive: {
    backgroundColor: '#00FF88',
    borderColor: '#00FF88',
  },
  categoryPillText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'Montserrat',
  },
  categoryPillTextActive: {
    color: '#0A0E17',
  },
  exerciseCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  exerciseIconContainer: {
    backgroundColor: '#1E293B',
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  exerciseIcon: {
    fontSize: 22,
  },
  chipContainer: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  chip: {
    backgroundColor: '#1E293B',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  chipText: {
    color: '#00E5FF',
    fontSize: 9,
    fontWeight: '700',
    fontFamily: 'Inter',
  },
  exerciseCardFooter: {
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    paddingTop: 12,
    marginTop: 4,
  },
  cardActionButton: {
    backgroundColor: '#00FF88',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  cardActionButtonDownload: {
    backgroundColor: '#FF4500',
  },
  cardActionButtonDisabled: {
    backgroundColor: '#1E293B',
  },
  cardActionButtonText: {
    color: '#0A0E17',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'Montserrat',
  },
  cardActionButtonTextDisabled: {
    color: '#64748B',
  },

  // Desktop nav tabs
  desktopNavLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
  },
  desktopNavLink: {
    paddingVertical: 8,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  desktopNavLinkActive: {
    borderBottomColor: '#00FF88',
  },
  desktopNavLinkText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'Montserrat',
  },
  desktopNavLinkTextActive: {
    color: '#00FF88',
  },

  // Premium bottom navigation bar
  bottomTabBar: {
    flexDirection: 'row',
    backgroundColor: '#111827',
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
    paddingVertical: 8,
    paddingHorizontal: 16,
    width: '100%',
    justifyContent: 'space-around',
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    flex: 1,
  },
  tabItemActive: {
    opacity: 1,
  },
  tabIcon: {
    fontSize: 20,
    marginBottom: 2,
  },
  tabLabel: {
    color: '#6B7280',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'Montserrat',
  },
  tabLabelActive: {
    color: '#00FF88',
  },

  // Premium History Bento layout styles
  bentoGrid: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
    marginBottom: 24,
  },
  bentoCard: {
    flex: 1,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1F2937',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bentoCardFeatured: {
    borderColor: '#00FF88',
    backgroundColor: '#0F1F18',
  },
  bentoLabel: {
    color: '#6B7280',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'Inter',
    marginBottom: 4,
  },
  bentoLabelFeatured: {
    color: '#00FF88',
  },
  bentoValue: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    fontFamily: 'Montserrat',
  },
  bentoValueFeatured: {
    color: '#00FF88',
  },
  recentActivityTitle: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'Montserrat',
    letterSpacing: 1,
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  historyListStitch: {
    width: '100%',
    gap: 8,
    marginBottom: 20,
  },
  historyCardStitch: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1F2937',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  historyCardStitchSelected: {
    borderColor: '#00FF88',
  },
  historyLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  historyIconContainer: {
    backgroundColor: '#1F2937',
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyExerciseNameStitch: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'Montserrat',
  },
  historyTimeStitch: {
    color: '#6B7280',
    fontSize: 11,
    fontFamily: 'Inter',
  },
  historyRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  historyAccuracyBadge: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 20,
  },
  historyAccuracyBadgeGreen: {
    backgroundColor: '#0F1F18',
  },
  historyAccuracyBadgeRed: {
    backgroundColor: '#2F151B',
  },
  historyAccuracyTextGreen: {
    color: '#00FF88',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'Inter',
  },
  historyAccuracyTextRed: {
    color: '#FF3366',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'Inter',
  },
  historyRepsTextStitch: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'Montserrat',
  },
  // Stitch Live Workout HUD Layout Styles
  hudTopRow: {
    position: 'absolute',
    top: 40,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    zIndex: 20,
  },
  hudGlassCard: {
    backgroundColor: 'rgba(26, 26, 28, 0.65)',
    borderRadius: 14,
    padding: 14,
    minWidth: 90,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  hudLabel: {
    color: '#919094',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'Inter',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  hudValueReps: {
    color: '#4edea3',
    fontSize: 32,
    fontWeight: '800',
    fontFamily: 'JetBrains Mono',
  },
  hudSubLabel: {
    color: '#46464a',
    fontSize: 11,
    fontFamily: 'Inter',
    marginTop: 2,
  },
  hudAccuracyDialContainer: {
    position: 'relative',
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hudDialTextContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hudDialText: {
    color: '#e5e2e1',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'JetBrains Mono',
  },
  hudWarningBannerContainer: {
    position: 'absolute',
    bottom: 120,
    left: 20,
    right: 20,
    alignItems: 'center',
    zIndex: 20,
  },
  hudWarningBanner: {
    backgroundColor: 'rgba(32, 31, 31, 0.9)',
    borderWidth: 2,
    borderColor: '#ffb4ab',
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hudWarningIcon: {
    fontSize: 16,
  },
  hudWarningText: {
    color: '#ffb4ab',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'Inter',
    letterSpacing: 1.5,
  },
  hudBottomRow: {
    position: 'absolute',
    bottom: 30,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 20,
  },
  hudTimerCapsule: {
    backgroundColor: 'rgba(26, 26, 28, 0.65)',
    borderRadius: 30,
    paddingHorizontal: 20,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  hudTimerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ffb4ab',
  },
  hudTimerDotPaused: {
    backgroundColor: '#919094',
  },
  hudTimerText: {
    color: '#e5e2e1',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'JetBrains Mono',
    letterSpacing: 1,
  },
  hudButtonContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  hudStopButton: {
    backgroundColor: 'rgba(32, 31, 31, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255, 180, 171, 0.5)',
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hudStopIcon: {
    color: '#ffb4ab',
    fontSize: 20,
  },
  hudPauseButton: {
    backgroundColor: 'rgba(26, 26, 28, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hudPauseIcon: {
    color: '#e5e2e1',
    fontSize: 20,
  }
});
