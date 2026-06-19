# **Technical Requirements Document (TRD)**

## **Project Name: Aura Fitness (AI-Powered Open-Space Functional Training Coach)**

### **1\. System Topology & Edge-Computing Engine Architecture**

Aura Fitness shifts entirely away from centralized client-server streaming architectures to a decentralized edge-computing topology. To achieve deterministic real-time processing and enforce maximum data privacy, 100% of camera frames, coordinate extraction, biomechanical tracking mathematics, and voice optimization loops execute directly on the user's local device hardware (smartphones, tablets, and Android/Google TV boxes).  
The application is written as a native cross-platform solution utilizing **React Native and Expo**, augmented by specialized compilation ecosystems to target widescreen media players:

* **Mobile Bundle Target:** Generates optimized iOS and Android mobile binaries. Uses standard touch-gestures and a fluid portrait UI layout.  
* **Smart TV Bundle Target:** Generates high-definition Android TV and Google TV binaries using the react-native-tvos package fork. It strips touch-event listener trees and replaces them with a custom D-Pad focus interaction matrix.  
* **On-Device Machine Learning Pipeline:** Rather than offloading frame rendering to an external web-server via network WebSockets, the app hooks directly into the local camera device thread using **Google MediaPipe Tasks Native SDK** bindings (packaged within low-level C++ layer integrations). Frames captured by the native camera hardware interface directly with MediaPipe's on-device model files through a JavaScript Interface (JSI) bridge, keeping landmark inference speeds between 16ms and 33ms (sustaining a fluid 30 to 60 FPS profile).

### **2\. Multi-Platform View Layout & Remote Focus Specifications**

#### **A. Adaptive UI Presentation Layouts**

The layout adapts dynamically upon initialization depending on the detected platform context variables:

* **Mobile Portrait Layout:** The view splits vertically. The camera viewfinder box controls the top 55% of the viewport matrix, while contextual telemetry panels (live rep count dials, workout state progress bars, active warnings) populate the lower 45% matrix.  
* **Smart TV Landscape Layout (16:9 Grid):** The interface locks horizontally. The live camera overlay stream maps to a prominent 65% width container on the left edge. The remaining 35% horizontal layout maps out a deep performance dashboard and an interactive vector SVG anatomy heatmap on a persistent right sidebar.

#### **B. TV Remote D-Pad Navigation Engine**

Since TV systems omit pointer indicators and touch overlays, navigation is managed deterministically via sequential item tracking states. Interactive components utilize React Native's native TouchableHighlight or specialized Focusable wrappers, executing specific spatial alignment checks:

| UI Navigation Core Metric | Technical Implementation Mechanism | Expected Operational Behavior   |
| :---- | :---- | :---- |
| Focus Highlighting | Dynamic active opacity hooks coupled with CSS scale(1.05) transforms and glowing borders. | Gives immediate clear confirmation to users sitting several feet away which layout button is currently selected. |
| Spatial Intercept Routing | Platform native focus search patterns computing nearest 2D geometric vector distances. | Ensures pressing D-pad directions routes focus accurately to the closest physical interface element on screen. |
| Modal State Overrides | Intercepts parent layout focus routing listeners when an active modal dialogue opens up. | Traps remote button navigation strictly inside the modal options box, preventing blind navigation behind the popup screen. |

### **3\. Biomechanical Mathematics & Multi-Exercise Heuristics**

Raw 33 skeletal joint coordinate coordinates are normalized across image resolution bounds before processing. To eradicate physical coordinate jitter caused by lighting or minor pixel noise, the application applies an on-device rolling **Savitzky-Golay signal filter** across the last 7 captured coordinate packets using a local array buffer.  
Angles are calculated continuously across isolated 2D joint paths using a quadrant-robust arc tangent (atan2) vertex equation, processing strictly between 0 and 180 degrees:  
**Angle \= |atan2(y3 \- y2, x3 \- x2) \- atan2(y1 \- y2, x1 \- x2)| \* (180 / pi)**  
Aura Fitness tracks three distinct multi-exercise libraries in open space with absolute zero-occlusion safeguards:

#### **A. Calisthenics Module (Example: Bodyweight Squat)**

* **Joint Target Vertices:** Point 1 \= Hip (Skeletal Landmark 23 or 24), Point 2 \= Knee (25 or 26), Point 3 \= Ankle (27 or 28).  
* **Parallel Depth Threshold:** Valid range check confirms knee flexion dips less than or equal to 95 degrees.  
* **Form Fault Intercepts:**  
  * *Spine Rounding:* Monitored at the Hip vertex bounding the Shoulder, Hip, and Knee joints. A violation is declared if the tracking vector drops below a tight 138-degree floor constraint.  
  * *Knee Shear:* Evaluates profile planar limits. If Knee\_X drifts past Toe\_X by more than a 0.04 spatial coefficient, it flags an immediate structural warning.

#### **B. Floor Exercises Module (Example: Dumbbell Push-Ups)**

* **Joint Target Vertices:** Point 1 \= Shoulder (11 or 12), Point 2 \= Elbow (13 or 14), Point 3 \= Wrist (15 or 16).  
* **Depth Verification:** Enforces elbow expansion angle to drop below 75 degrees for an authentic deep push transition, requiring return expansion to pass 165 degrees to satisfy full top lockout.  
* **Core Structural Alignment Vector:** Tracks a long linear path connecting the Shoulder, Hip, and Ankle keypoints. If hip alignment sag coordinates deviate from the direct shoulder-ankle vector by more than 12% in either vertical direction, the app flags "SAGGING HIPS" or "HIGH PIKING" form violations.

#### **C. Standing Weight Movements Module (Example: Dumbbell Flyes / Standing Chest Opening)**

* **Joint Target Vertices:** Tracks Shoulder Abduction angle bounds (measuring the lateral intersection line between the upper arm bone and the outer torso baseline vectors).  
* **Execution Constraints:** Enforces smooth movement bounds between 30 degrees and 110 degrees relative to the chest centerline plane.  
* **Trunk Stability Metrics:** Evaluates the linear vertical path of the spine relative to the vertical orientation of the room. If the shoulder joint positions drift backward over the heel anchor points by an angle exceeding 15 degrees, it catches dangerous back hyperextension risks and flags posture alerts.

### **4\. Algorithmic Multi-Phase Repetition State Machine**

Repetition cycles use highly accurate hysteresis tracking algorithms to manage user workout transitions across four separate hardware flags, ensuring high accuracy regardless of physical execution speeds:

1. **State 1 \- UP (Resting Benchmark):** Initial baseline lock. The target joint angle stays above 155 degrees (e.g., standing upright for squats, or full lockouts for push-ups). Resets current individual rep parameter states.  
2. **State 2 \- DOWN (Active Concentric Transition):** Joint tracking angles pass below 145 degrees. The app initiates depth metrics. If the movement successfully breaches the minimum exercise standard (e.g., 95 degrees for squats), a local boolean parameter flag depth\_secured switches to True.  
3. **State 3 \- ASCENDING (Eccentric Recovery Phase):** Joint extension moves upward, exceeding the lowest tracked valley angle by more than 10 degrees. The system locks out descending checks and actively evaluates recovery trajectory paths.  
4. **State 4 \- COMPLETION (Cycle Validation & Save Hook):** Seamless transition occurs as the target joint angle moves cleanly past the 155-degree mark, returning back to State 1\. If depth\_secured is verified as True, the session rep counter increments by 1, accuracy score penalty matrix checks execute, platform voice coaching cooldown arrays update, and metrics write instantly to the local data layer.

### **5\. Dual-State Data Architecture & Background Synchronization**

#### **A. Local Persistence Storage Layer (Offline Mode)**

When internet connectivity is absent or drops inside basement gym structures, Aura Fitness functions entirely in a local-first operational format. Relational tracking variables map down into a compact SQLite / WatermelonDB mobile file array:

* users\_table: Tracks localized registration settings, username string variables, hashed password tokens, and custom role parameters.  
* workout\_sessions\_table: Logs active timestamps, cumulative sets completed, target exercise string IDs, and total repetitions counted.  
* rep\_telemetry\_table: Stores granular rep histories, containing the individual timestamp, the calculated minimum joint angle achieved, specific error booleans captured, and the final **Form Accuracy Score** decimal rating.

#### **B. Background Online Sync Engine & Competitive Leaderboards**

The application implements an automated network observer engine powered by the React Native NetInfo API framework. The operational state engine routes data logs along a dual channel layout:

| App Connectivity State | On-Device Storage Operation | Cloud Sync & Network Protocol Actions   |
| :---- | :---- | :---- |
| **Offline Status** | All data records write instantly to the local SQLite database. Sync tracking columns are flagged as is\_synced \= false. | All remote API requests are paused. Outbound payload queues are securely held in local memory buffers to prevent app blocking or crashes. |
| **Online Status** | An automated background worker task queries all local database rows where is\_synced \= false. | The data payload is compressed into standard JSON packages and transmitted via secure HTTPS POST protocols to the cloud API endpoint. Upon a successful HTTP 200 response code, the local database table column flags instantly update to is\_synced \= true. |

When online connectivity is verified, the system establishes a fast connection to an external cloud backend (e.g., Node.js / FastAPI web servers hooked to a high-capacity PostgreSQL instance):

* **Global Accuracy Leaderboard Sync:** Upon rep completion, the system updates a global cloud database registry mapping user accuracy indices. This updates gamified leaderboards, showing how the user's execution metrics rank against the regional or global community in real-time.  
* **Admin Console Terminal:** Synced cloud records feed directly into a separate administrative web interface. Authenticated admins can run analytical audits, inspect workout data trends across groups, log client milestones, and track usage frequency across different workspaces.

### **6\. Audio Synthesis & Interface Feedback Loop Mechanics**

* **Vocal Correction Engine (TTS Throttling):** Real-time alerts deploy through the native platform text-to-speech API layer (SpeechSynthesis on web/Android TV systems). To prevent vocal audio streams from overlapping or clogging device speakers during rapid movement transitions, voice deployment logic runs across a strict timestamp check loop. It checks active system counters to enforce a minimum 4.5-second cooldown safety window between voice warning notifications.  
* **Rep Completed Oscillator Synthesizer:** To ensure instant audio feedback upon rep completion without the storage space and processing delay of loading external audio files, the application uses direct hardware frequency oscillators via the HTML5 Web Audio API. When the state machine triggers State 4, the native audio chip synthesizes a clean, dual-sine wave chime resolving at an absolute **D5 chord frequency (587.33 Hz)**, which decays exponentially to zero over a clean 0.15-second window.