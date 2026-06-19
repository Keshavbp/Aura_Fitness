# **Product Requirements Document (PRD)**

## **Project Name: Aura Fitness (AI-Powered Open-Space Functional Training Coach)**

### **1\. Executive Summary & Core Value Proposition**

Aura Fitness is an enterprise-tier, low-latency, native cross-platform connected fitness application built using React Native and Expo. Operating as a smart biometric mirror, the platform provides real-time computer vision coaching without expensive, specialized depth-sensing hardware. By utilizing standard mobile device cameras and connected Smart TV cameras, the platform delivers on-device skeletal landmark tracking, interactive muscle activation heatmaps, and a zero-clutter dashboard layout tailored specifically for both close-up mobile screens and distant 16:9 TV monitors.  
To eliminate the tracking errors caused by physical equipment blocking the camera's sightlines (the computer vision occlusion problem), Aura Fitness focuses strictly on **Zero-Occlusion Open-Space Movements**. The application supports an extensive library of calisthenics, functional bodyweight routines, floor-based movements (such as dumbbell push-ups), and standing free-weight or resistance band exercises where the athlete's entire skeletal frame remains completely visible in open, unobstructed space.

### **2\. Target User Personas & Device Contexts**

* **The Mobile Gym Floor Athlete:** Trains in open spaces at the gym or outdoors. Uses a smartphone propped vertically in portrait mode. Requires clean visual layout and quick glanceability when standing several feet back from the phone screen.  
* **The Smart TV Living Room Lifter:** Connects their application to an Android TV or Google TV setup with a mounted webcam. Trains in a wide landscape layout. Requires high-contrast, bold indicators and complete user interface navigation via a D-pad remote control without touch input.  
* **The Competitive Community Athlete:** Seeks interactive gamification. Relies on offline local training capability when in remote settings or basement gyms, but leverages internet connectivity to sync metrics and compete on global form accuracy leaderboards.  
* **The Remote Trainer / Admin:** Requires a consolidated overview of community milestones, user registration metrics, workspace activity trends, and uploaded athletic history.

### **3\. Functional Requirements & Core Feature Set**

#### **A. Native Cross-Platform Computer Vision Pipeline**

* **On-Device Machine Learning Inference:** The app must execute Google MediaPipe Tasks Native SDKs locally on the host hardware (iOS, Android, and Android TV) rather than streaming frames across external network sockets. This approach ensures maximum privacy and zero network latency.  
* **Anti-Jitter Keypoint Smoothing:** Raw landmark coordinate streams must be stabilized frame-to-frame using a localized Savitzky-Golay filter running a 7-frame window to prevent distracting overlay line vibrations.  
* **Responsive Digital Overlay:** Render a horizontal mirror image of the camera viewport containing a glowing, real-time synchronized 33-point skeletal landmark overlay. Lines must transition dynamically from green (perfect execution) to flashing red upon active form fault detection.

#### **B. Dual-State Connectivity Architecture (Offline/Online Hybrid Engine)**

* **Offline Mode (Local-First Operation):**  
  * 100% of motion capture, biometric geometry calculations, the four-phase rep state machine, and real-time audio coaching loops must process fully on-device with zero network dependency.  
  * Workout logs, sets, cumulative repetitions, and calculated accuracy ratings must be written instantly to a local file-based database schema (SQLite / WatermelonDB).  
* **Online Mode (Cloud Synchronization & Gamification):**  
  * **Background Conflict Synchronization:** Upon detecting a stable internet connection, an automated background worker must seamlessly sync cached offline logs up to the centralized cloud database backend.  
  * **Gamified Community Leaderboards:** Real-time transmission of a user's aggregate Form Accuracy Score to global rankings, allowing users to actively compete against the community based on execution precision.  
  * **Admin Dashboard Integration:** Authenticated administrators can securely access a remote web panel to audit user histories, monitor athletic data logs, and evaluate community trends.

#### **C. Open-Space Exercise Tracking Library & Heuristics**

The application engine rules are built around high-fidelity trigonometric calculations analyzing joint vertices, tracking movement ranges, and protecting against joint-shearing stresses:

* **Calisthenics (MVP: Bodyweight Squat):** Monitors the interior Hip-Knee-Ankle vertex angle. Tracks the transitions through UP, DOWN, and ASCENDING states, requiring the athlete to reach an explicit parallel depth threshold of 95 degrees or less to secure a valid repetition. Intercepts spinal rounding (Shoulder-Hip-Knee angle below 138 degrees) and forward knee shear past toe X-axis boundaries.  
* **Floor Exercises (MVP: Dumbbell Push-Ups):** Measures elbow flexion/extension angles to enforce deep chest transitions and absolute top lockouts. Concurrently evaluates the structural alignment line between the Shoulder, Hip, and Ankle to identify and flag sagging hips or high-piking postures.  
* **Standing Weight Movements (MVP: Standing Upward Chest / Dumbbell Flyes):** Tracks shoulder abduction mechanics and elbow angles relative to the vertical trunk axis. Enforces steady range-of-motion metrics to eliminate momentum-cheating while monitoring core stability to prevent dangerous lower back hyperextension.

#### **D. Multi-Platform UI/UX Layout Rules**

* **Mobile Portrait View:** Features a vertically stacked interface configuration. The camera viewport commands the top layout section, while immediate real-time telemetry variables (rep count, active set tracker, current form warning string) stack tightly below for enhanced readability on compact displays.  
* **Widescreen TV View (16:9 Landscape Layout):** The display organizes into a broad grid layout tailored for distant viewing. The live camera mirror viewport occupies 60-70% of the screen width, while the remaining 30-40% sidebar displays a responsive 2D anatomical SVG muscle map.  
* **D-Pad Input Focus System:** To accommodate TV setups, all interactive items, settings pages, and exercise selections must manage native remote control focus states (Up, Down, Left, Right, Select) instead of relying on tactile touch events.

#### **E. Interactive Visual & Vocal Interface Feedback**

* **Dynamic Muscle Shading:** A responsive vector illustration shifts primary and secondary target paths (e.g., Quads/Glutes for squats, Chest/Triceps for push-ups) from a neutral resting tone to a vibrant, glowing red proportional to mechanical muscular extension and depth.  
* **Throttled Vocal Voice Coach:** Employs native browser and platform level SpeechSynthesis engines to stream auditory instructions ("STRAIGHTEN YOUR BACK\!", "GO DEEPER\!"). Voice commands must be throttled via systematic timestamp checkpoints to implement a strict 4.5-second cooldown safety window, avoiding audio overlap.  
* **Rep Progression Audio Synthesizer:** Fires a zero-file-dependency native oscillator chord frequency chime (resolving at a crisp D5 chord frequency) at the precise millisecond a rep transition cycle successfully hits the completion state hook.

### **4\. Non-Functional Requirements (Performance & Scalability)**

* **Edge-Computing Pacing:** The native frame-processing pipeline must sustain a steady, lag-free 30 to 60 FPS on mobile processors and standard media TV boxes to prevent spatial synchronization drift.  
* **Battery and Thermal Optimization:** Hardware acceleration optimization (CPU/GPU thread isolation) must be leveraged within the MediaPipe execution context to ensure steady on-device tracking without excessive thermal throttling or drainage.  
* **Data Storage Resilience:** Background data synchronization routines must utilize robust local transaction queue caches, ensuring zero data loss during sudden network dropouts or intermittent internet handshakes.