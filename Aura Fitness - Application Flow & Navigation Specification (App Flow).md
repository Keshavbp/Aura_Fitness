# **Application Flow & Navigation Specification**

## **Project Name: Aura Fitness (AI-Powered Open-Space Functional Training Coach)**

### **1\. Global Navigation Architecture & Router Control Topology**

Aura Fitness leverages a unified multi-platform router utilizing React Navigation. The navigation tree is constructed out of decoupled navigator nesting zones to handle strict platform-specific layout configurations dynamically.

* **Authentication Gateway Guard:** Global authorization state check wrapper. If an active validation token or local authentication signature exists, the user routes straight into the Application Shell. Otherwise, focus is restricted tightly to the Authentication Screen stack.  
* **Mobile UI Shell Stack:** Implements a fluid React Navigation Bottom Tab Navigator system. Users interact via touch gestures to navigate across tabs (Dashboard, Train, Leaderboards, History, Profile).  
* **Smart TV UI Shell Stack:** Implements a responsive left-side Drawer Navigator paired with custom TV focus listeners. The left navigation bar collapses or expands using remote control D-pad focus triggers. Bottom tabs are strictly stripped to prevent focus traps, replacing interaction pathways with full-screen, horizontal grid selections.

### **2\. Cross-Platform Screen Lifecycle Graph**

The screen lifecycle transitions deterministically based on structural user interaction and edge hardware verification flags. The structural system operates according to the sequence below:

| Active Screen View | Mobile Interaction Route | Smart TV Remote Focus Target | System Router Operational Result   |
| :---- | :---- | :---- | :---- |
| 1\. Boot Splash Screen | Automated initialize scripts. Checks local hardware. | Automated initialize scripts. Checks mounted TV camera. | Verifies local database schemas, pre-loads internal MediaPipe model files, and routes to Authentication Guard. |
| 2\. Authentication View | Tactile touch keyboard entry for login / auto-register. | D-pad focus loop routing across an integrated on-screen virtual matrix keyboard. | Validates credentials locally or via cloud, stores active user parameter profile, and shifts layout to Main Menu. |
| 3\. Main Menu Dashboard | Vertical scroll through quick cards. Tap triggers workout selection. | Horizontal grid layout navigation. Focus state outlines elements with high-contrast glowing scales. | Instantiates active network check tasks, reads localized workout history lists, and displays the metric interface. |
| 4\. Workout Setup Panel | Picker select lists for Exercise Library selection (Squat, Push-up, Flyes). | D-pad Left/Right cards to switch target routines. Large confirmation action button. | Spawns internal exercise config metadata, sets mathematical calibration targets, and opens Live Session Controller. |
| 5\. Live Session Controller | Camera view switches to mobile front camera portrait box. Touch buttons for pause. | Locks workspace layout into a 16:9 landscape box. Remote 'Select' key acts as fallback emergency freeze option. | Binds native video device feed to MediaPipe engine, initiates rolling Savitzky-Golay filter buffers, and mounts state loops. |
| 6\. Post-Workout Summary | Touch buttons to exit or sync history instantly. | Auto-focused highlighted card block reading "Return to Main Menu". | Processes accumulated performance parameters, calculates aggregate session scores, logs database entries, and clears memory. |

### **3\. Dual-State Connectivity Routing & Network Lifecycle Paths**

The application layout structure splits dynamically across independent processing streams dependent upon realtime hardware connectivity queries provided by NetInfo event listeners.

#### **A. Offline Mode Route (Local-First Framework)**

1. If NetInfo returns a connection loss or baseline timeout error flag, the app injects an interactive warning notice saying "Offline Mode Active \- Performance Logs Protected Locally".  
2. The navigation stack locks out all views mapped to cloud servers, including the Global Competition Leaderboards tab and the Remote Admin Sync settings dashboard.  
3. The Workout selection screen dynamically switches tracking models to pull metadata structures directly from the local compiled repository asset tree.  
4. Upon rep completion inside the Live Session Controller screen, data metrics bypass network APIs completely and perform an immediate transactional write directly down into the device's local file storage partition via local SQLite drivers.

#### **B. Online Mode Route (Central Cloud Integration)**

1. When a network connection is verified, the app framework removes the offline notification alert layout and connects to the centralized cloud endpoint structures.  
2. An asynchronous background sync worker instantly kicks off, querying all local database records containing the flag condition is\_synced \= false.  
3. The system executes a safe batch POST network command pushing JSON metrics up to the remote database. Upon processing a successful response confirmation code, the application updates individual record sync tracking variables instantly to prevent double-upload issues.  
4. The Router un-guards and renders the interactive Global Competition Leaderboard view, sending out an instant API fetch request to present global accuracy rankings.

### **4\. Live Training Pipeline Interaction Sequence**

The operational logic cascade during active biometric tracking maps sequentially across hardware layers, view states, and audio synthesis triggers to eliminate synchronization drift:

\`\`\` \[User Selects Exercise Card\] │ ▼ \[Mount Live Session Screen View\] ──► (Instantiate Hardware Camera Access Thread) │ ▼ \[Render Horizontal View Mirror Viewport\] ──► (Inject Blank Layer Canvas Skeleton) │ ▼ \[Execute MediaPipe Core Initialization Loop\] │ ▼ ┌─────────────────── Local Frame Processing Pipeline (Steady 30-60 FPS Window) ──────────────────┐ │ │ │ \[Capture Live Camera Buffer Image\] ──► \[On-Device Pose Landmark Coordinate Prediction Engine\] │ │ │ │ │ ▼ │ │ \[Execute 7-Frame Savitzky-Golay Filter\] │ │ │ │ │ ▼ │ │ \[Compute Biomechanical Joint Trigonometry\] │ │ │ │ │ ▼ │ │ \[Pass Cleaned Values down to State Machine\] │ │ │ └──────────────────────────────────────────────────┬──────────────────────────────────────────────┘ │ ▼ ┌─────────────────────────────┴─────────────────────────────┐ ▼ ▼ \[Fault Evaluation Engine\] \[Phase State Transitions\] │ │ ▼ ▼ Did joint angles cross breach constraints? Did athlete execute full reps? │ │ │ │ (YES) (NO) (YES) (NO) │ │ │ │ ▼ ▼ ▼ ▼ \[Flash Dashboard Overlay Red\] \[Keep Lines Green\] \[Advance Counters\] \[Maintain Stack\] \[Fire Throttled TTS Alerts\] \[Synthesize D5 Audio Chime\] \[Update local SVG Muscle Map\] \`\`\`

**Phase I: Initialization & Hardware Handshake**

1. **Trigger Action:** User taps an exercise selection card (e.g., *Bodyweight Squats*).  
2. **Screen Mounting:** The LiveSession view controller mounts to the application screen container.  
3. **Hardware Activation:** The app spawns an isolated background hardware thread to open the device's camera capture stream.  
4. **Viewport Mirroring:** The native viewport renders the live camera frame inverted horizontally on the screen to create a perfect digital "gym mirror" experience.  
5. **Canvas Injection:** A transparent HTML5 Canvas/SVG layer is overlaid perfectly on top of the video container to prepare for drawing the skeletal joints.  
6. **Inference Boot:** The local native **Google MediaPipe Tasks SDK** initializes and loads the pose landmarker .task binary file directly into memory.

### **Phase II: Local Edge Processing Loop (Runs Continuously at 30–60 FPS)**

*Every individual camera frame goes through this lightning-fast on-device processing cycle:*

* **Step A (Capture):** Grab the raw pixel buffer of the active camera frame.  
* **Step B (Inference):** Pass the frame array straight to the local MediaPipe engine via the JavaScript Interface (JSI) bridge to detect the 33 coordinate points ($x, y$).  
* **Step C (Filter):** Feed the raw keypoints into a rolling **7-frame Savitzky-Golay filter buffer** to strip away camera signal noise and prevent erratic coordinate jitter.  
* **Step D (Trigonometry):** Calculate the exact joint vertex paths using the quadratic 2D atan2 formula (e.g., tracking the Knee angle using the Hip, Knee, and Ankle keypoints).  
* **Step E (Distribution):** Pass these stable, clean biomechanical values simultaneously down into the dual evaluation engines.

### **Phase III: The Dual-Engine Evaluation Matrix**

*Once the clean joint angles hit the logic layer, they execute two operations at the exact same millisecond:*

#### **Stream 1: Fault Evaluation Engine (Safety First)**

* **The Check:** Do active tracking coordinates cross any form restriction boundaries?  
  * ❌ **YES (Form Fault Caught):** \* The interface overlay and canvas skeletal lines immediately flash vibrant neon red.  
    * The app checks the timestamp loop. If the **4.5-second cooldown** has passed, it triggers the native Text-to-Speech API to say a voice cue (e.g., *"GO DEEPER\!"* or *"STRAIGHTEN YOUR BACK\!"*).  
  * **NO (Form Execution Perfect):**  
    * The overlay grid remains a calm neon green. No audio warnings disrupt the athlete's concentration.

#### **Stream 2: Repetition State Machine (The Progress Tracker)**

* **The Check:** Did the movement complete a valid repetition cycle based on the active state machine checks (UP $\\rightarrow$ DOWN $\\rightarrow$ ASCENDING $\\rightarrow$ UP)?  
  * ❌ **NO (Rep Incomplete):** \* The current phase flags stay locked. The user keeps moving through the sequence window.  
  * **YES (Rep Successfully Completed):**  
    * The cumulative session rep counter increments by $1$.  
    * The engine processes any form deductions logged during the active window to output the final **Form Accuracy Score** for that specific repetition.  
    * The native audio chip synthesizes a clean **D5 chord frequency chime (587.33 Hz)** that exponentially decays over 0.15 seconds to signify an official rep.  
    * The persistent 2D anatomical SVG muscle map updates its shading opacity instantly to match the rep's intensity metrics.  
    * The data object writes straight down to the on-device **SQLite** file layer.

### **5\. Android/Google TV Remote Interaction & Focus Management**

To avoid dead navigation states on TV displays lacking finger-touch input, the layout follows strict operational criteria to preserve D-pad routing clarity:

* **Focus Tracking System:** Elements use native hasTVPreferredFocus parameters on initialization targets to ensure the primary left navigation link anchors remote interactions the moment a screen mounts.  
* **Spatial 2D Focus Index Alignment:** Layout cards are placed along strict mathematical linear rows and columns. This grid organization prevents direction navigation mix-ups when users try to shift focus using remote control arrows.  
* **Modal Dialog Interaction Capture:** When confirmation popups appear (such as an overlay query asking "Confirm Workout Session End?"), a temporary modal intercept container captures the navigation routing focus block. This arrangement forces remote button inputs to move strictly between the "Yes" and "No" choices, blocking background dashboard navigation until the prompt is resolved.