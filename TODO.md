# Aura Fitness - System Roadmap & TODO Checklist

This file tracks the architecture milestones, completed security integrations, and future development roadmaps for the Aura Fitness ecosystem (Mobile Client, Serverless Backend, and Web Portal).

---

## 🚀 Phase 1: Core Decoupling & Security (Completed)
- [x] **Project Restructure**: Decoupled APIs into `/backend` and marketing/admin portal into `/web`.
- [x] **JWT Authentication**: Implemented login credentials flow, token rotation, and HttpOnly cookies.
- [x] **Secure Local Storage**: Integrated `expo-secure-store` to cache mobile user sessions.
- [x] **API Key Signature**: Hardcoded `EXPO_PUBLIC_API_KEY` header verification for sync and dynamic schema downloads.
- [x] **Database Safety**: Initialized PostgreSQL schema creation automatically across all sync and admin endpoints.
- [x] **CORS & CORS Preflights**: Configured cross-origin controls for custom security headers (`x-admin-login-pin`, `x-api-key`).

---

## 🎨 Phase 2: Mobile App Integrations (Completed)
- [x] **User Login UI**: Add a dedicated sign-in/sign-up interface for athletes to log in before workouts.
- [x] **Network Certificate Pinning**: Implement active SSL pinning on the native network configuration (using `react-native-ssl-pinning` or expo configuration) to harden connection against MitM attacks.
- [x] **Telemetry Offline Sync Policy**: Implement automatic retry backoffs in background workers when synchronization fails.

---

## ⚡ Phase 3: Backend & Telemetry Scaling (Todo)
- [ ] **WebSocket Deployment**: Host the standalone secure telemetry server (`backend/websocket-server.ts`) on a persistent host (e.g. Render, AWS EC2, or DigitalOcean) to handle active `wss://` telemetry.
- [ ] **User Registration API**: Create a `/api/auth/register` endpoint to allow new users to register and store hashed passwords safely in PostgreSQL.
- [ ] **Rate Limiting**: Enforce strict IP rate limiting (e.g. using `express-rate-limit` or Vercel Edge Middleware) on the `/api/auth/login` endpoint.

---

## 📱 Phase 4: Web Portal Polish & Enhancements (Todo)
- [ ] **Marketing Page Obfuscation**: Display the SHA-256 checksum of the downloadable APK in the Download Center.
- [ ] **Responsive Menu**: Build a sliding mobile navigation drawer for smaller screen sizes.
- [ ] **Interactive Telemetry Curves**: Build SVG charts in the Admin Dashboard modal to visualize real-time joint repetition curves dynamically.
- [ ] **Live Telemetry Stream**: Connect the admin dashboard to the persistent WebSocket server to monitor active athletes in real-time.
