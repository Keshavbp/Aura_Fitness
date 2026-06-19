# **UI/UX Design Brief**

## **Project Name: Aura Fitness (AI-Powered Open-Space Functional Training Coach)**

### **1\. Design Language & Visual System Foundations**

Aura Fitness adopts a premium, hyper-focused "digital gym mirror" aesthetic. The overarching interface philosophy mandates ultra-high contrast, generous structural negative space, and absolute zero-clutter. Every visual asset must optimize for glanceability from a standard athletic training distance of several feet back from the glass.

#### **A. Core Color Tokens & Chromatic Gamut Optimization**

Colors are engineered specifically to maintain consistency across standard mobile displays and consumer television matrices. Because TV display panels naturally elevate saturation contrast, the visual system uses deliberate color scales to preserve readability under varying ambient room exposures:

* **Background Midnight Core (Dark Mode Dominant):** \#0A0E17. A solid, deep low-luminescence base color. Light text on dark canvases reduces eye strain during heavy workouts and forms a clean backdrop for overlay lines.  
* **Skeletal Safe Overlay (Optimal Trajectory):** \#00FF88 (Neon Emerald). Represents active perfect joint geometry alignment. This shade passes strict accessibility luminosity standards against the midnight base.  
* **Biomechanical Fault Warning (Active Deviation):** \#FF3366 (Vibrant Crimson). Triggers instantly upon joint boundary violations. A slightly desaturated shade is chosen intentionally to prevent neon clipping artifacts on older Smart TV panels.  
* **Muscular Shading Rest Base:** \#1E293B (Slate Charcoal with a 20 percent alpha channel overlay).  
* **Muscular Shading Contraction Max:** \#FF4500 (Flame Neon Orange) shifting smoothly through dynamic opacity matrices.

#### **B. Typographic Scaling & Legibility Benchmarks**

To adhere strictly to the 10-foot legibility rule required for connected fitness hardware setups, the application restricts font usage to highly legible, clean, sans-serif typefaces (e.g., Inter or system native equivalents). Font weight is used to establish clear hierarchy:

* **Massive Telemetry Display (TV Rep Dials):** 96pt to 120pt, Extra Bold, Monospace tracking configuration (prevents tabular layout shifts or shaking text as numbers change rapidly mid-set).  
* **Section Title Headers:** 32pt to 40pt, Bold, Uppercase transformation applied for strong layout visual anchors.  
* **Granular Body Readouts:** 14pt to 16pt, Medium weight, restricted to short structural sentences to prevent reading fatigue during exhausting functional sets.

### **2\. Platform-Specific Interface Layout Blueprints**

#### **A. Mobile Device Experience Layout (Vertical Portrait 9:16 Context)**

The layout configuration accounts for situations where an athlete props up their smartphone on a water bottle or floor tripod. Elements stack vertically using fluid flexbox rows:

* **The Camera Viewport Container (Top 55 percent Matrix):** Implements a vertically pinned front-camera mirror layout. Draws the live 33 landmarker skeletal vector canvas directly above the viewport layer.  
* **The Telemetry Panel Block (Lower 45 percent Matrix):** Grouped into card blocks featuring oversized tactile tap points (minimum interactive boundaries of 48dp x 48dp) to support sweat-slicked hand interactions. Prominent widgets showcase the cumulative Rep counter and the dynamic Form Accuracy indicator dial side-by-side.

#### **B. Connected Smart TV Experience Layout (Widescreen Landscape 16:9 Context)**

Optimized for Google TV and Android TV players mounted above or below a wide-view peripheral camera. The interface locks horizontally to leverage the expansive spatial widescreen grid:

* **Overscan Safe Margins:** All interactive content layers are constrained inside a strict 5 percent outer boundary safe zone (minimum padding cushion of 48 pixels from left and right edges, and 27 pixels from top and bottom edges) to prevent layout clipping caused by legacy television hardware aspect scaling.  
* **The Live Stage Canvas (Left 65 percent Section):** Renders the wide-angle camera mirror feed alongside real-time coordinate filter vectors. This container features a glowing outer bounding box shadow that flashes crimson when a posture violation occurs.  
* **The Performance Dashboard Sidebar (Right 35 percent Section):** Displays a detailed split panel arrangement. The top section houses the massive tabular session metrics, while the lower section accommodates the interactive, responsive 2D SVG Anatomical Muscle Heatmap illustration.

### **3\. TV Remote Control D-Pad Focus Interaction Matrix**

Because TV boxes lack touchscreen inputs and pointing devices, navigation is managed deterministically via sequential keyboard focus indices powered by the react-native-tvos ecosystem:

| Interactive Element State | Visual Design Response Properties | Focus Engine Engineering Mechanism   |
| :---- | :---- | :---- |
| Unfocused / Rest | Flat appearance, standard slate bounding outlines, 1.0 item scale factor. | Standard state ledger tracking. Components maintain listener structures but do not intercept clicks. |
| Focused Active State | Scale factor increases smoothly to scale(1.05) via an animated 150ms transition. Outlines switch to a vibrant emerald glow with a clear, distinct border width boost. | Uses low-level React Native TVOS JSI listeners. Custom layout attributes (such as nextFocusRight or nextFocusDown) are added to override default proximity engines, preventing unexpected focus behavior. |
| Pressed Selection Hook | Brief, immediate highlight color flash followed by a clean layout slide animation to signify entry transition. | The native TV remote "Select" center button maps directly to the component's onPress handler loop, preventing tap interaction delay. |
| Modal Intercept Overlay | Background elements are obscured with a heavy dark overlay filter blur layer. Popups use high-contrast text containers centered on the screen. | Employs specialized TVFocusGuideView containers running the trapFocus boolean flag configuration. This prevents focus execution parameters from escaping to elements behind the modal layout window. |

### **4\. Biomechanical Motion Feedback Visual Mechanics**

#### **A. Real-Time Posture Violation HUD Alerts**

* When the state logic catches a form fault (e.g., spinal bending below 138 degrees during dumbbell push-ups), the app triggers an immediate full-screen border animation flash. A 4px wide perimeter border strokes the layout in vibrant crimson.  
* The active joint segments on the skeletal canvas layer switch from thin emerald tracks to thick, double-weighted flashing lines, providing immediate spatial awareness to help the athlete correct their posture.

#### **B. Responsive 2D SVG Muscle Heatmap Shading**

* The sidebar anatomy model is rendered using individual vector path layers. Targeted muscle groupings pull decimal indices directly from the real-time trigonometric calculation channels.  
* The color assignment utilizes fluid inline dynamic style updates mapping to HSL thresholds where muscle paths color shift dynamically from a warm rest orange to an active, intense red baseline.  
* When an athlete passes deep exertion limits, the DOM node dynamically applies an integrated SVG pulseGlow drop-shadow filter to animate physical mind-muscle engagement seamlessly.