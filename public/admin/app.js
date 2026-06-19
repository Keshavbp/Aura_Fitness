// State Management
const state = {
  records: [],
  leaderboard: [],
  currentSection: 'overview',
  searchQuery: '',
  selectedExerciseFilter: 'all'
};

// DOM Elements
const elements = {
  // Navigation
  navOverview: document.getElementById('nav-overview'),
  navLeaderboard: document.getElementById('nav-leaderboard'),
  navRecords: document.getElementById('nav-records'),
  currentSectionTitle: document.getElementById('current-section-title'),
  btnRefreshData: document.getElementById('btn-refresh-data'),
  
  // Sections
  sectionOverview: document.getElementById('section-overview'),
  sectionLeaderboard: document.getElementById('section-leaderboard'),
  sectionRecords: document.getElementById('section-records'),
  
  // Stats Counters
  statTotalUsers: document.getElementById('stat-total-users'),
  statTotalReps: document.getElementById('stat-total-reps'),
  statAvgAccuracy: document.getElementById('stat-avg-accuracy'),
  statTotalDuration: document.getElementById('stat-total-duration'),
  
  // Lists and Charts
  exerciseBreakdownBars: document.getElementById('exercise-breakdown-bars'),
  recentActivityList: document.getElementById('recent-activity-list'),
  
  // Leaderboard
  leaderboardTbody: document.getElementById('leaderboard-tbody'),
  
  // Records & Filters
  filterSearchUser: document.getElementById('filter-search-user'),
  filterExerciseSelect: document.getElementById('filter-exercise-select'),
  recordsTbody: document.getElementById('records-tbody'),
  
  // Modal Telemetry
  telemetryModal: document.getElementById('telemetry-modal'),
  btnCloseModal: document.getElementById('btn-close-modal'),
  modalSessionTitle: document.getElementById('modal-session-title'),
  modalSessionSubtitle: document.getElementById('modal-session-subtitle'),
  modalSummaryExercise: document.getElementById('modal-summary-exercise'),
  modalSummaryReps: document.getElementById('modal-summary-reps'),
  modalSummaryAccuracy: document.getElementById('modal-summary-accuracy'),
  modalTelemetryTbody: document.getElementById('modal-telemetry-tbody')
};

// Navigation Tab Trigger
function switchSection(sectionId) {
  state.currentSection = sectionId;
  
  // Reset active classes
  const menuItems = [elements.navOverview, elements.navLeaderboard, elements.navRecords];
  menuItems.forEach(item => item.classList.remove('active'));
  
  const sections = [elements.sectionOverview, elements.sectionLeaderboard, elements.sectionRecords];
  sections.forEach(sec => sec.classList.remove('active'));
  
  // Set active tab & section
  if (sectionId === 'overview') {
    elements.navOverview.classList.add('active');
    elements.sectionOverview.classList.add('active');
    elements.currentSectionTitle.innerText = 'Telemetry Overview';
  } else if (sectionId === 'leaderboard') {
    elements.navLeaderboard.classList.add('active');
    elements.sectionLeaderboard.classList.add('active');
    elements.currentSectionTitle.innerText = 'Leaderboard Standings';
  } else if (sectionId === 'records') {
    elements.navRecords.classList.add('active');
    elements.sectionRecords.classList.add('active');
    elements.currentSectionTitle.innerText = 'Workout Record Logs';
  }
}

// Helpers
function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function formatDate(timestamp) {
  if (!timestamp) return '--';
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function getExerciseLabel(key) {
  const mapping = {
    'squat': 'Bodyweight Squats',
    'pushup': 'Dumbbell Push-Ups',
    'dumbbell_fly': 'Dumbbell Chest Flyes'
  };
  return mapping[key] || key.toUpperCase().replace('_', ' ');
}

// Fetch APIs
async function fetchServerData() {
  elements.btnRefreshData.disabled = true;
  elements.btnRefreshData.innerHTML = `<span class="refresh-icon">🔄</span> Syncing...`;
  
  try {
    const [leaderboardRes, recordsRes] = await Promise.all([
      fetch('/api/admin/leaderboard'),
      fetch('/api/admin/records')
    ]);
    
    if (leaderboardRes.ok) {
      state.leaderboard = await leaderboardRes.json();
    } else {
      console.warn("Failed to fetch leaderboard from API, fallback to offline calculations");
    }
    
    if (recordsRes.ok) {
      state.records = await recordsRes.json();
    } else {
      console.warn("Failed to fetch workout records from API");
    }
    
    updateDashboardUI();
  } catch (err) {
    console.error("Networking request failed, check connection config", err);
  } finally {
    elements.btnRefreshData.disabled = false;
    elements.btnRefreshData.innerHTML = `<span class="refresh-icon">🔄</span> Reload Server Data`;
  }
}

// Update UI Panels
function updateDashboardUI() {
  renderOverview();
  renderLeaderboard();
  renderRecords();
}

function renderOverview() {
  // 1. Calculate KPI totals
  const totalUsers = state.leaderboard.length;
  
  let totalReps = 0;
  let totalDuration = 0;
  let accuracySum = 0;
  let accuracyCount = 0;
  
  const exerciseCounts = { squat: 0, pushup: 0, dumbbell_fly: 0 };
  
  state.records.forEach(rec => {
    totalReps += rec.total_reps_logged;
    totalDuration += rec.active_duration_seconds;
    
    if (rec.avg_accuracy > 0) {
      accuracySum += rec.avg_accuracy;
      accuracyCount++;
    }
    
    if (rec.exercise_key in exerciseCounts) {
      exerciseCounts[rec.exercise_key] += rec.total_reps_logged;
    }
  });

  const averageAccuracy = accuracyCount > 0 ? (accuracySum / accuracyCount).toFixed(1) : '100';

  // Apply to text fields
  elements.statTotalUsers.innerText = totalUsers;
  elements.statTotalReps.innerText = totalReps.toLocaleString();
  elements.statAvgAccuracy.innerText = `${averageAccuracy}%`;
  
  // Format Duration hours/minutes
  const hrs = Math.floor(totalDuration / 3600);
  const remainingMins = Math.floor((totalDuration % 3600) / 60);
  const remainingSecs = totalDuration % 60;
  elements.statTotalDuration.innerText = hrs > 0 
    ? `${hrs}h ${remainingMins}m` 
    : `${remainingMins}m ${remainingSecs}s`;

  // 2. Render Workload breakdown chart
  const maxReps = Math.max(...Object.values(exerciseCounts), 1);
  elements.exerciseBreakdownBars.innerHTML = '';
  
  Object.keys(exerciseCounts).forEach(key => {
    const repsCount = exerciseCounts[key];
    const fillPercent = ((repsCount / maxReps) * 100).toFixed(0);
    
    const barHtml = `
      <div class="ex-bar-container">
        <div class="ex-bar-info">
          <span class="ex-bar-label">${getExerciseLabel(key)}</span>
          <span class="ex-bar-count">${repsCount.toLocaleString()} reps</span>
        </div>
        <div class="ex-bar-track">
          <div class="ex-bar-fill" style="width: ${fillPercent}%"></div>
        </div>
      </div>
    `;
    elements.exerciseBreakdownBars.innerHTML += barHtml;
  });

  // 3. Render Activity feed (recent 4 records)
  elements.recentActivityList.innerHTML = '';
  const recentRecords = state.records.slice(0, 4);
  
  if (recentRecords.length === 0) {
    elements.recentActivityList.innerHTML = `<p style="color: var(--text-secondary); text-align: center; margin-top: 40px;">No workout activity logged yet.</p>`;
    return;
  }
  
  recentRecords.forEach(rec => {
    const actHtml = `
      <div class="activity-item">
        <div class="act-info">
          <h4>${rec.username}</h4>
          <p>Completed ${getExerciseLabel(rec.exercise_key)}</p>
        </div>
        <div class="act-meta">
          <span class="act-badge">${rec.total_reps_logged} Reps</span>
          <span class="act-time">${formatDate(rec.started_at)}</span>
        </div>
      </div>
    `;
    elements.recentActivityList.innerHTML += actHtml;
  });
}

function renderLeaderboard() {
  elements.leaderboardTbody.innerHTML = '';
  
  if (state.leaderboard.length === 0) {
    elements.leaderboardTbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-secondary);">No ranked users.</td></tr>`;
    return;
  }
  
  state.leaderboard.forEach(entry => {
    // Add gold/silver/bronze icons
    let rankDisplay = entry.rank;
    let rankClass = '';
    
    if (entry.rank === 1) { rankDisplay = '🥇'; rankClass = 'rank-1'; }
    else if (entry.rank === 2) { rankDisplay = '🥈'; rankClass = 'rank-2'; }
    else if (entry.rank === 3) { rankDisplay = '🥉'; rankClass = 'rank-3'; }

    const accuracyClass = entry.avg_accuracy >= 90 ? 'text-glow-green' : entry.avg_accuracy >= 80 ? 'text-glow-yellow' : 'text-glow-red';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><div class="rank-badge ${rankClass}">${rankDisplay}</div></td>
      <td style="font-weight: 600;">${entry.username}</td>
      <td class="${accuracyClass}" style="font-family: var(--font-display); font-weight: bold;">${entry.avg_accuracy}%</td>
      <td style="font-family: var(--font-display);">${entry.total_reps.toLocaleString()}</td>
      <td>${entry.total_sessions}</td>
      <td style="color: var(--neon-blue); font-weight: 600;">${entry.primary_exercise}</td>
    `;
    elements.leaderboardTbody.appendChild(tr);
  });
}

function renderRecords() {
  elements.recordsTbody.innerHTML = '';
  
  // Filter rows
  const filtered = state.records.filter(rec => {
    const matchesSearch = rec.username.toLowerCase().includes(state.searchQuery.toLowerCase());
    const matchesFilter = state.selectedExerciseFilter === 'all' || rec.exercise_key === state.selectedExerciseFilter;
    return matchesSearch && matchesFilter;
  });

  if (filtered.length === 0) {
    elements.recordsTbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-secondary); padding: 40px 0;">No matching history logs found.</td></tr>`;
    return;
  }

  filtered.forEach(rec => {
    const tr = document.createElement('tr');
    
    const accClass = rec.avg_accuracy >= 90 ? 'text-glow-green' : rec.avg_accuracy >= 80 ? 'text-glow-yellow' : 'text-glow-red';

    tr.innerHTML = `
      <td style="color: var(--text-secondary);">${formatDate(rec.started_at)}</td>
      <td style="font-weight: 600;">${rec.username}</td>
      <td style="color: var(--neon-blue); font-weight: 600;">${getExerciseLabel(rec.exercise_key)}</td>
      <td style="font-family: var(--font-display); font-weight: 700;">${rec.total_reps_logged}</td>
      <td>${formatDuration(rec.active_duration_seconds)}</td>
      <td class="${accClass}" style="font-family: var(--font-display); font-weight: 700;">${rec.avg_accuracy}%</td>
      <td>
        <button class="btn-inspect" data-id="${rec.session_id}">Inspect</button>
      </td>
    `;
    
    // Attach listener to button
    const inspectBtn = tr.querySelector('.btn-inspect');
    inspectBtn.addEventListener('click', () => {
      inspectSessionTelemetry(rec.session_id);
    });

    elements.recordsTbody.appendChild(tr);
  });
}

// Modal inspection
function inspectSessionTelemetry(sessionId) {
  const session = state.records.find(r => r.session_id === sessionId);
  if (!session) return;
  
  elements.modalSessionTitle.innerText = `Workout Session: ${getExerciseLabel(session.exercise_key)}`;
  elements.modalSessionSubtitle.innerText = `Session ID: ${session.session_id}`;
  elements.modalSummaryExercise.innerText = getExerciseLabel(session.exercise_key);
  elements.modalSummaryReps.innerText = session.total_reps_logged;
  
  const accClass = session.avg_accuracy >= 90 ? 'text-glow-green' : session.avg_accuracy >= 80 ? 'text-glow-yellow' : 'text-glow-red';
  elements.modalSummaryAccuracy.className = `summary-value ${accClass}`;
  elements.modalSummaryAccuracy.innerText = `${session.avg_accuracy}%`;
  
  elements.modalTelemetryTbody.innerHTML = '';
  
  const telemetry = session.telemetry || [];
  if (telemetry.length === 0) {
    elements.modalTelemetryTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-secondary); padding: 20px 0;">No individual repetition telemetry stored for this session.</td></tr>`;
  } else {
    telemetry.forEach(rep => {
      // Build error tag list
      const errors = [];
      if (rep.fault_spine_rounded) errors.push('<span class="fault-badge badge-rounded-spine">Rounded Spine</span>');
      if (rep.fault_knee_shear) errors.push('<span class="fault-badge badge-knee-shear">Knee Shear</span>');
      if (rep.fault_shallow_depth) errors.push('<span class="fault-badge badge-shallow">Shallow Depth</span>');
      
      const errorsDisplay = errors.length > 0 ? errors.join('') : '<span class="fault-badge badge-perfect">Perfect Form</span>';
      
      const repScoreClass = rep.form_accuracy_score >= 90 ? 'text-glow-green' : rep.form_accuracy_score >= 80 ? 'text-glow-yellow' : 'text-glow-red';
      
      let angleDisplay = `${rep.min_joint_angle}°`;
      if (session.exercise_key === 'dumbbell_fly') {
        // Flyes are measured in abduction angle
        angleDisplay = `${rep.min_joint_angle}° Abduction`;
      } else {
        angleDisplay = `${rep.min_joint_angle}° Joint`;
      }

      const row = document.createElement('tr');
      row.innerHTML = `
        <td style="font-family: var(--font-display); font-weight: bold; text-align: center;">#${rep.rep_index}</td>
        <td class="${repScoreClass}" style="font-family: var(--font-display); font-weight: bold;">${rep.form_accuracy_score}%</td>
        <td style="font-family: monospace;">${angleDisplay}</td>
        <td>${errorsDisplay}</td>
      `;
      elements.modalTelemetryTbody.appendChild(row);
    });
  }

  // Open Modal
  elements.telemetryModal.classList.add('active');
}

// Event Listeners
function setupEventListeners() {
  // Navigation
  elements.navOverview.addEventListener('click', (e) => { e.preventDefault(); switchSection('overview'); });
  elements.navLeaderboard.addEventListener('click', (e) => { e.preventDefault(); switchSection('leaderboard'); });
  elements.navRecords.addEventListener('click', (e) => { e.preventDefault(); switchSection('records'); });
  
  // Reload Button
  elements.btnRefreshData.addEventListener('click', fetchServerData);
  
  // Filters
  elements.filterSearchUser.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderRecords();
  });
  
  elements.filterExerciseSelect.addEventListener('change', (e) => {
    state.selectedExerciseFilter = e.target.value;
    renderRecords();
  });
  
  // Modal Close
  elements.btnCloseModal.addEventListener('click', () => {
    elements.telemetryModal.classList.remove('active');
  });
  
  elements.telemetryModal.addEventListener('click', (e) => {
    if (e.target === elements.telemetryModal) {
      elements.telemetryModal.classList.remove('active');
    }
  });
}

// Initializing
function init() {
  setupEventListeners();
  switchSection('overview');
  fetchServerData();
}

window.addEventListener('DOMContentLoaded', init);
