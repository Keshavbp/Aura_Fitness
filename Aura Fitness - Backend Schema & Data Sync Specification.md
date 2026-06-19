# **Backend Schema & Data Sync Specification**

## **Project Name: Aura Fitness (AI-Powered Open-Space Functional Training Coach)**

### **1\. Architectural Overview & Context Strategy**

This document serves as the declarative data contract for Aura Fitness. It bridges the high-fidelity component interfaces generated in **Google Stitch** (passed via Model Context Protocol) with the automated code execution models running inside the **Google Antigravity IDE**.  
To support the application's hybrid dual-state connectivity requirements, the storage topology implements a split architecture:

* **Edge Client Layer (Offline Core):** Employs an on-device, lightweight file-backed **SQLite / WatermelonDB** database. This layer captures millisecond-level telemetry tracking flags during calisthenics or free-weight movement routines, completely independent of an active internet handshake.  
* **Cloud Backend Layer (Online Sync Platform):** Employs a centralized, concurrent **PostgreSQL** instance. This engine acts as the absolute source of truth for global group matching, community ranking aggregates, and administrative monitoring utilities.

### **2\. Edge Database Engine Specification (SQLite / Local Persistence)**

Local data records use simple table indexes optimized for fast transactional writes at the exact instant a repetition triggers an execution complete lifecycle hook.

#### **A. Users Ledger Table (local\_users)**

| Column Field Name | SQLite Data Type | Constraint Property | Functional Intent / System Mapping   |
| :---- | :---- | :---- | :---- |
| id | TEXT | PRIMARY KEY | Universally Unique Identifier (UUIDv4) generated on-device. |
| username | TEXT | UNIQUE, NOT NULL | User identity string captured via the authentication view component. |
| auth\_token | TEXT | NULLABLE | Cryptographic storage string verifying background authorization access. |
| role\_profile | TEXT | DEFAULT 'athlete' | Limits administrative controls. Standard options: 'athlete' or 'admin'. |
| created\_at | INTEGER | NOT NULL | Unix timestamp tracks when account records initially execute. |

#### **B. Workout Sessions Ledger Table (workout\_sessions)**

| Column Field Name | SQLite Data Type | Constraint Property | Functional Intent / System Mapping   |
| :---- | :---- | :---- | :---- |
| session\_id | TEXT | PRIMARY KEY | UUIDv4 generated whenever an exercise setup card is clicked. |
| user\_id | TEXT | FOREIGN KEY | References local\_users(id) to map history constraints. |
| exercise\_key | TEXT | NOT NULL | Exercise system code token identifier: 'squat', 'pushup', or 'dumbbell\_fly'. |
| total\_reps\_logged | INTEGER | DEFAULT 0 | Cumulative counter advanced dynamically by state machine completions. |
| active\_duration\_seconds | INTEGER | DEFAULT 0 | Continuous chronometer delta updating when video capture processes. |
| is\_synced | INTEGER | DEFAULT 0 | Binary sync state flag tracking variable: 0 \= Local Only, 1 \= Synced to Cloud. |
| started\_at | INTEGER | NOT NULL | Timestamp used to chronologically organize list metrics in UI components. |

#### **C. Granular Repetition Telemetry Details Table (rep\_telemetry)**

| Column Field Name | SQLite Data Type | Constraint Property | Functional Intent / System Mapping   |
| :---- | :---- | :---- | :---- |
| rep\_id | TEXT | PRIMARY KEY | UUIDv4 generated at the immediate completion boundary of each single repetition. |
| session\_id | TEXT | FOREIGN KEY | References workout\_sessions(session\_id) via cascading deletes. |
| rep\_index | INTEGER | NOT NULL | Sequential integer count of the rep within the individual tracking set. |
| min\_joint\_angle | REAL | NOT NULL | Peak structural deflection achieved inside concentric motion checkpoints. |
| form\_accuracy\_score | REAL | NOT NULL | Calculated performance value bounded strictly between 30.0 and 100.0. |
| fault\_spine\_rounded | INTEGER | DEFAULT 0 | Boolean bit indicating a spine flexion deviation drop below 138 degrees. |
| fault\_knee\_shear | INTEGER | DEFAULT 0 | Boolean bit indicating knee path alignment crossed past toe planar zones. |
| fault\_shallow\_depth | INTEGER | DEFAULT 0 | Boolean bit indicating failure to cross parallel geometric criteria. |
| timestamp\_recorded | INTEGER | NOT NULL | Provides high-resolution telemetry sorting capability across metrics. |

### **3\. Cloud Master Database Specification (PostgreSQL Engine Core)**

The online schema duplicates the relational structure of the local ledger targets but supplements them with central optimization variables to power secure multi-tenant ranking engines and analytical dashboard charts.

* **Cloud Users Profile Mapping:** The system stores global profiles linking email vectors, regional group IDs, and aggregate historical training milestones.  
* **Global Leaderboard Cache Views (Materialized Views):** To allow instant population of cross-user gamification elements without hitting calculation blocks, the PostgreSQL backend builds automated daily materialized updates tracking performance metrics:  
  CREATE MATERIALIZED VIEW global\_accuracy\_rankings AS SELECT user\_id, AVG(form\_accuracy\_score) as mean\_accuracy, SUM(total\_reps\_logged) as aggregate\_reps FROM rep\_telemetry JOIN workout\_sessions USING(session\_id) GROUP BY user\_id ORDER BY mean\_accuracy DESC;  
* **Admin Auditing Logs:** Features additional logging structures monitoring client system connection spikes, workspace active registration counts, and local sync transaction conflict records.

### **4\. Background Synchronization API Payload Schemas**

When the background NetInfo listener state signals network restoration, Antigravity's batch upload manager gathers unsynced entities and fires a serialized multi-part network request payload.

#### **A. Outbound Bulk Synchronization Payload (POST /api/sync/batch)**

{  
  "sync\_meta": {  
    "device\_timestamp": 1780913418,  
    "local\_user\_id": "usr\_9f8d2b7a-4c1e-432d-8b0a-3f5e1c7b9a2d"  
  },  
  "payload\_queue": {  
    "sessions": \[  
      {  
        "session\_id": "sess\_01bc3d4e-5f6a-7b8c-9d0e-1f2a3b4c5d6e",  
        "exercise\_key": "squat",  
        "total\_reps\_logged": 12,  
        "active\_duration\_seconds": 45,  
        "started\_at": 1780913000  
      }  
    \],  
    "telemetry": \[  
      {  
        "rep\_id": "rep\_a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",  
        "session\_id": "sess\_01bc3d4e-5f6a-7b8c-9d0e-1f2a3b4c5d6e",  
        "rep\_index": 1,  
        "min\_joint\_angle": 92.4,  
        "form\_accuracy\_score": 96.5,  
        "fault\_spine\_rounded": 0,  
        "fault\_knee\_shear": 0,  
        "fault\_shallow\_depth": 0,  
        "timestamp\_recorded": 1780913015  
      }  
    \]  
  }  
}

#### **B. Cloud Acknowledgment Inbound Data Payload (HTTP 200 Success Response)**

{  
  "status": "sync\_complete",  
  "processed\_counts": {  
    "sessions": 1,  
    "telemetry": 1  
  },  
  "synced\_session\_ids": \[  
    "sess\_01bc3d4e-5f6a-7b8c-9d0e-1f2a3b4c5d6e"  
  \],  
  "server\_epoch": 1780913420  
}

### **5\. Google Stitch Data Interaction Mapping**

To establish clean component pipelines, the properties exposed by **Google Stitch components** are bound directly to database schema elements via MCP attributes:

* **Stitch \<RepCounterDial /\> Component:** Listens directly to structural updates changing the value of workout\_sessions.total\_reps\_logged inside local context hooks.  
* **Stitch \<AnatomyHeatmapGrouping /\> Component:** Pulls dynamic color array bounds by analyzing the min\_joint\_angle field emitted inside the live database frame buffer schema.  
* **Stitch \<WarningToast /\> Component:** Mounts visibility flags when local database insert parameters evaluate true values for any of the boolean error bits (fault\_spine\_rounded, etc.).