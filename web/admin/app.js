// State Management
const state = {
  records: [],
  leaderboard: [],
  currentSection: 'overview',
  searchQuery: '',
  selectedExerciseFilter: 'all',
  apiKey: localStorage.getItem('admin_login_pin') || ''
};

// DOM Elements
const elements = {
  // Navigation
  navOverview: document.getElementById('nav-overview'),
  navLeaderboard: document.getElementById('nav-leaderboard'),
  navRecords: document.getElementById('nav-records'),
  navBroadcasts: document.getElementById('nav-broadcasts'),
  currentSectionTitle: document.getElementById('current-section-title'),
  btnRefreshData: document.getElementById('btn-refresh-data'),
  
  // Sections
  sectionOverview: document.getElementById('section-overview'),
  sectionLeaderboard: document.getElementById('section-leaderboard'),
  sectionRecords: document.getElementById('section-records'),
  sectionBroadcasts: document.getElementById('section-broadcasts'),
  
  // Stats Counters
  statTotalUsers: document.getElementById('stat-total-users'),
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
  btnExportCsv: document.getElementById('btn-export-csv'),
  
  // Modal Telemetry
  telemetryModal: document.getElementById('telemetry-modal'),
  btnCloseModal: document.getElementById('btn-close-modal'),
  modalSessionTitle: document.getElementById('modal-session-title'),
  modalSessionSubtitle: document.getElementById('modal-session-subtitle'),
  modalSummaryExercise: document.getElementById('modal-summary-exercise'),
  modalSummaryReps: document.getElementById('modal-summary-reps'),
  modalSummaryAccuracy: document.getElementById('modal-summary-accuracy'),
  modalTelemetryTbody: document.getElementById('modal-telemetry-tbody'),

  // Auth Elements
  authModal: document.getElementById('auth-modal'),
  btnSubmitAuth: document.getElementById('btn-submit-auth'),
  authApiKeyInput: document.getElementById('auth-api-key-input'),
  authErrorMsg: document.getElementById('auth-error-msg'),
  btnLogout: document.getElementById('btn-logout'),

  // Broadcasts
  broadcastMessageInput: document.getElementById('broadcast-message-input'),
  btnSendBroadcast: document.getElementById('btn-send-broadcast'),
  broadcastStatus: document.getElementById('broadcast-status'),
  broadcastsList: document.getElementById('broadcasts-list'),
  btnRefreshBroadcasts: document.getElementById('btn-refresh-broadcasts'),

  // Users Management
  navUsers: document.getElementById('nav-users'),
  sectionUsers: document.getElementById('section-users'),
  usersTbody: document.getElementById('users-tbody'),
  btnRefreshUsers: document.getElementById('btn-refresh-users')
};

// Navigation Tab Trigger
function switchSection(sectionId) {
  state.currentSection = sectionId;
  
  // Reset active classes
  const menuItems = [elements.navOverview, elements.navLeaderboard, elements.navRecords, elements.navBroadcasts, elements.navUsers];
  menuItems.forEach(item => item.classList.remove('active'));
  
  const sections = [elements.sectionOverview, elements.sectionLeaderboard, elements.sectionRecords, elements.sectionBroadcasts, elements.sectionUsers];
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
  } else if (sectionId === 'broadcasts') {
    elements.navBroadcasts.classList.add('active');
    elements.sectionBroadcasts.classList.add('active');
    elements.currentSectionTitle.innerText = 'Broadcast Notifications';
    fetchBroadcasts();
  } else if (sectionId === 'users') {
    elements.navUsers.classList.add('active');
    elements.sectionUsers.classList.add('active');
    elements.currentSectionTitle.innerText = 'Registered Users';
    fetchUsers();
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

// Show/Hide Auth modal
function triggerLoginPrompt(showError = false) {
  elements.authErrorMsg.style.display = showError ? 'block' : 'none';
  elements.authModal.classList.add('active');
  elements.authApiKeyInput.focus();
}

// Fetch APIs
async function fetchServerData() {
  if (!state.apiKey) {
    triggerLoginPrompt(false);
    return;
  }

  elements.btnRefreshData.disabled = true;
  elements.btnRefreshData.innerHTML = `<span class="refresh-icon">🔄</span> Syncing...`;
  
  try {
    const headers = {
      'x-admin-login-pin': state.apiKey
    };

    const [leaderboardRes, recordsRes] = await Promise.all([
      fetch('/api/admin/leaderboard', { headers }),
      fetch('/api/admin/records', { headers })
    ]);

    if (leaderboardRes.status === 401 || recordsRes.status === 401) {
      localStorage.removeItem('admin_login_pin');
      state.apiKey = '';
      triggerLoginPrompt(true);
      return;
    }
    
    if (leaderboardRes.ok) {
      state.leaderboard = await leaderboardRes.json();
    } else {
      console.warn("Failed to fetch leaderboard from API");
    }
    
    if (recordsRes.ok) {
      state.records = await recordsRes.json();
    } else {
      console.warn("Failed to fetch workout records from API");
    }
    
    elements.authModal.classList.remove('active');
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

// Animation Helpers for stats counters
function animateCounter(element, targetValue, isPercentage = false, duration = 800) {
  const startValue = 0;
  const startTime = performance.now();
  
  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Ease-out quad
    const easeProgress = progress * (2 - progress);
    const currentValue = startValue + easeProgress * (targetValue - startValue);
    
    if (isPercentage) {
      element.innerText = `${currentValue.toFixed(1)}%`;
    } else {
      element.innerText = Math.floor(currentValue).toLocaleString();
    }
    
    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }
  
  requestAnimationFrame(update);
}

function animateDurationCounter(element, targetSeconds, duration = 800) {
  const startTime = performance.now();
  
  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeProgress = progress * (2 - progress);
    const currentSeconds = Math.floor(easeProgress * targetSeconds);
    
    const hrs = Math.floor(currentSeconds / 3600);
    const remainingMins = Math.floor((currentSeconds % 3600) / 60);
    const remainingSecs = currentSeconds % 60;
    
    element.innerText = hrs > 0 
      ? `${hrs}h ${remainingMins}m` 
      : `${remainingMins}m ${remainingSecs}s`;
      
    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }
  
  requestAnimationFrame(update);
}

function renderOverview() {
  // 1. Calculate KPI totals
  const totalUsers = state.leaderboard.length;
  
  let totalDuration = 0;
  let accuracySum = 0;
  let accuracyCount = 0;
  
  const exerciseCounts = { squat: 0, pushup: 0, dumbbell_fly: 0 };
  
  state.records.forEach(rec => {
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

  // Apply animations to stat cards
  animateCounter(elements.statTotalUsers, totalUsers);
  animateCounter(elements.statAvgAccuracy, parseFloat(averageAccuracy), true);
  animateDurationCounter(elements.statTotalDuration, totalDuration);

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

// CSV Exporter
function exportRecordsToCSV() {
  if (state.records.length === 0) return;
  
  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "Session ID,Athlete Name,Exercise,Total Reps,Duration (sec),Avg Accuracy %,Date\n";
  
  state.records.forEach(rec => {
    const row = [
      rec.session_id,
      `"${rec.username.replace(/"/g, '""')}"`,
      getExerciseLabel(rec.exercise_key),
      rec.total_reps_logged,
      rec.active_duration_seconds,
      rec.avg_accuracy,
      `"${new Date(rec.started_at).toISOString()}"`
    ].join(",");
    csvContent += row + "\n";
  });
  
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `aura_fitness_workout_records_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Dynamic SVG curve generator inside the modal
function renderModalChart(telemetry, exerciseKey) {
  const container = document.getElementById('modal-chart-container');
  if (!container) return;
  
  // Extract or recreate tooltip to preserve it
  let tooltip = document.getElementById('chart-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'chart-tooltip';
    tooltip.className = 'absolute pointer-events-none opacity-0 bg-[#06090F] px-2.5 py-1.5 rounded-lg text-[11px] font-sans text-on-surface shadow-xl z-20 transition-opacity duration-200 flex flex-col gap-0.5';
    tooltip.style.border = '1px solid rgba(0, 229, 255, 0.2)';
  } else {
    tooltip.remove(); // Remove from DOM temporarily to avoid overwrite
  }
  
  container.innerHTML = '';
  
  if (!telemetry || telemetry.length === 0) {
    container.innerHTML = `<span style="color: var(--text-secondary); font-size: 0.85rem;">No telemetry data available for chart.</span>`;
    return;
  }
  
  const width = container.clientWidth || 700;
  const height = 120;
  const padding = 20;
  
  // Extract data points
  const points = telemetry.map(t => ({
    x: t.rep_index,
    y: t.min_joint_angle
  }));
  
  const minX = 1;
  const maxX = Math.max(...points.map(p => p.x), 1);
  const minY = Math.min(...points.map(p => p.y), 0);
  const maxY = Math.max(...points.map(p => p.y), 180);
  
  // Coordinate mapping functions
  const mapX = (x) => {
    if (maxX === minX) return width / 2;
    return padding + ((x - minX) / (maxX - minX)) * (width - 2 * padding);
  };
  
  const mapY = (y) => {
    return height - padding - ((y - minY) / (maxY - minY)) * (height - 2 * padding);
  };
  
  // Create SVG path
  let pathD = '';
  let dots = '';
  
  points.forEach((p, idx) => {
    const sx = mapX(p.x);
    const sy = mapY(p.y);
    
    if (idx === 0) {
      pathD += `M ${sx} ${sy}`;
    } else {
      pathD += ` L ${sx} ${sy}`;
    }
    
    // Glowing dots
    dots += `<circle cx="${sx}" cy="${sy}" r="4" fill="var(--neon-blue)" filter="drop-shadow(0 0 3px rgba(0, 229, 255, 0.8))" />`;
    dots += `<text x="${sx}" y="${sy - 8}" fill="#FFFFFF" font-family="monospace" font-size="8" text-anchor="middle">${p.y.toFixed(0)}°</text>`;
  });
  
  const labelText = exerciseKey === 'dumbbell_fly' ? 'Abduction Angle' : 'Min Joint Angle';
  
  const svgHtml = `
    <svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow: visible; position: relative;">
      <!-- Grid Lines -->
      <line x1="${padding}" y1="${mapY(90)}" x2="${width - padding}" y2="${mapY(90)}" stroke="rgba(255,255,255,0.05)" stroke-dasharray="3,3" />
      <line x1="${padding}" y1="${mapY(170)}" x2="${width - padding}" y2="${mapY(170)}" stroke="rgba(255,255,255,0.05)" stroke-dasharray="3,3" />
      
      <text x="${padding}" y="${mapY(90) + 12}" fill="var(--text-secondary)" font-size="8" font-family="monospace">90° parallel</text>
      <text x="${padding}" y="${mapY(170) + 12}" fill="var(--text-secondary)" font-size="8" font-family="monospace">170° rest</text>

      <!-- Curve Path -->
      <path d="${pathD}" fill="none" stroke="var(--neon-blue)" stroke-width="2" filter="drop-shadow(0 0 4px rgba(0, 229, 255, 0.4))" />
      
      <!-- Dots -->
      ${dots}

      <!-- Interactive Tracker Guide Line -->
      <line id="chart-tracker-line" x1="0" y1="0" x2="0" y2="${height - padding}" stroke="rgba(0, 229, 255, 0.4)" stroke-width="1.5" stroke-dasharray="3,3" style="display: none;" />
      
      <!-- Interactive Active Hover Dot -->
      <circle id="chart-active-dot" cx="0" cy="0" r="6" fill="var(--neon-blue)" filter="drop-shadow(0 0 8px var(--neon-blue))" style="display: none;" />
      
      <!-- Invisible Overlay Rect for Hover Coordinates -->
      <rect width="${width}" height="${height}" fill="transparent" class="chart-overlay-rect" style="cursor: crosshair;" />
    </svg>
  `;
  
  container.innerHTML = svgHtml;
  container.appendChild(tooltip);

  // Setup interactivity listeners
  const svg = container.querySelector('svg');
  const overlay = container.querySelector('.chart-overlay-rect');
  const trackerLine = container.querySelector('#chart-tracker-line');
  const activeDot = container.querySelector('#chart-active-dot');

  if (svg && overlay && trackerLine && activeDot) {
    overlay.addEventListener('mousemove', (e) => {
      const rect = svg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const svgMouseX = (mouseX / rect.width) * width;
      
      let closestPoint = null;
      let minDistance = Infinity;
      let closestIdx = -1;
      
      points.forEach((p, idx) => {
        const sx = mapX(p.x);
        const dist = Math.abs(svgMouseX - sx);
        if (dist < minDistance) {
          minDistance = dist;
          closestPoint = p;
          closestIdx = idx;
        }
      });
      
      if (closestPoint) {
        const sx = mapX(closestPoint.x);
        const sy = mapY(closestPoint.y);
        
        // Show and place tracker guide
        trackerLine.setAttribute('x1', sx);
        trackerLine.setAttribute('x2', sx);
        trackerLine.style.display = 'block';
        
        // Show and place active indicator dot
        activeDot.setAttribute('cx', sx);
        activeDot.setAttribute('cy', sy);
        activeDot.style.display = 'block';
        
        // Build tooltip content
        const repData = telemetry[closestIdx];
        const errors = [];
        if (repData.fault_spine_rounded) errors.push('Spine');
        if (repData.fault_knee_shear) errors.push('Knee');
        if (repData.fault_shallow_depth) errors.push('Shallow');
        const errorText = errors.length > 0 ? `Errors: ${errors.join(', ')}` : 'Perfect Form';
        
        tooltip.innerHTML = `
          <div style="font-family: var(--font-display); font-weight: bold; color: var(--neon-blue);">Rep #${repData.rep_index}</div>
          <div style="font-size: 10px; color: #fff;">Score: <span style="font-weight: bold; color: ${repData.form_accuracy_score >= 90 ? 'var(--neon-green)' : repData.form_accuracy_score >= 80 ? 'var(--neon-yellow)' : 'var(--neon-red)'}">${repData.form_accuracy_score}%</span></div>
          <div style="font-size: 10px; color: var(--text-secondary);">Angle: ${repData.min_joint_angle}°</div>
          <div style="font-size: 9px; margin-top: 2px; color: ${errors.length > 0 ? 'var(--neon-red)' : 'var(--neon-green)'}">${errorText}</div>
        `;
        
        // Calculate tooltip positioning
        const containerRect = container.getBoundingClientRect();
        const tooltipWidth = tooltip.offsetWidth || 110;
        const tooltipHeight = tooltip.offsetHeight || 70;
        
        let tooltipX = mouseX - tooltipWidth / 2;
        let tooltipY = (sy / height) * containerRect.height - tooltipHeight - 10;
        
        // Boundaries
        if (tooltipX < 5) tooltipX = 5;
        if (tooltipX + tooltipWidth > containerRect.width - 5) {
          tooltipX = containerRect.width - tooltipWidth - 5;
        }
        if (tooltipY < 5) {
          tooltipY = (sy / height) * containerRect.height + 15; // flip below
        }
        
        tooltip.style.left = `${tooltipX}px`;
        tooltip.style.top = `${tooltipY}px`;
        tooltip.style.opacity = '1';
        
        // Highlight corresponding row in table
        document.querySelectorAll('#modal-telemetry-tbody tr').forEach(row => {
          row.style.background = '';
          row.style.boxShadow = '';
        });
        const matchedRow = document.querySelector(`#modal-telemetry-tbody tr[data-rep-index="${repData.rep_index}"]`);
        if (matchedRow) {
          matchedRow.style.background = 'rgba(0, 229, 255, 0.15)';
          matchedRow.style.boxShadow = 'inset 3px 0 0 var(--neon-blue)';
          matchedRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    });
    
    overlay.addEventListener('mouseleave', () => {
      trackerLine.style.display = 'none';
      activeDot.style.display = 'none';
      tooltip.style.opacity = '0';
      
      document.querySelectorAll('#modal-telemetry-tbody tr').forEach(row => {
        row.style.background = '';
        row.style.boxShadow = '';
      });
    });
  }
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
  
  // Render joint angle curve chart
  renderModalChart(session.telemetry, session.exercise_key);
  
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
      row.setAttribute('data-rep-index', rep.rep_index);
      row.innerHTML = `
        <td style="font-family: var(--font-display); font-weight: bold; text-align: center;">#${rep.rep_index}</td>
        <td class="${repScoreClass}" style="font-family: var(--font-display); font-weight: bold;">${rep.form_accuracy_score}%</td>
        <td style="font-family: monospace;">${angleDisplay}</td>
        <td>${errorsDisplay}</td>
      `;

      // Hover row -> Highlight SVG chart point
      row.addEventListener('mouseenter', () => {
        row.style.background = 'rgba(0, 229, 255, 0.15)';
        row.style.boxShadow = 'inset 3px 0 0 var(--neon-blue)';
        
        const trackerLine = document.getElementById('chart-tracker-line');
        const activeDot = document.getElementById('chart-active-dot');
        const container = document.getElementById('modal-chart-container');
        
        if (trackerLine && activeDot && container) {
          const width = container.clientWidth || 700;
          const height = 120;
          const padding = 20;
          
          const minX = 1;
          const maxX = Math.max(...telemetry.map(t => t.rep_index), 1);
          const minY = Math.min(...telemetry.map(t => t.min_joint_angle), 0);
          const maxY = Math.max(...telemetry.map(t => t.min_joint_angle), 180);
          
          const mapX = (x) => {
            if (maxX === minX) return width / 2;
            return padding + ((x - minX) / (maxX - minX)) * (width - 2 * padding);
          };
          const mapY = (y) => {
            return height - padding - ((y - minY) / (maxY - minY)) * (height - 2 * padding);
          };
          
          const sx = mapX(rep.rep_index);
          const sy = mapY(rep.min_joint_angle);
          
          trackerLine.setAttribute('x1', sx);
          trackerLine.setAttribute('x2', sx);
          trackerLine.style.display = 'block';
          
          activeDot.setAttribute('cx', sx);
          activeDot.setAttribute('cy', sy);
          activeDot.style.display = 'block';
        }
      });

      row.addEventListener('mouseleave', () => {
        row.style.background = '';
        row.style.boxShadow = '';
        
        const trackerLine = document.getElementById('chart-tracker-line');
        const activeDot = document.getElementById('chart-active-dot');
        if (trackerLine) trackerLine.style.display = 'none';
        if (activeDot) activeDot.style.display = 'none';
      });

      elements.modalTelemetryTbody.appendChild(row);
    });
  }

  // Open Modal
  elements.telemetryModal.classList.add('active');
}

// Broadcasts Management
async function fetchBroadcasts() {
  try {
    const response = await fetch('/api/notifications');
    if (!response.ok) throw new Error('Failed to fetch');
    const data = await response.json();
    renderBroadcasts(data.notifications || []);
  } catch (err) {
    console.error('Failed to fetch broadcasts:', err);
    elements.broadcastsList.innerHTML = `
      <div class="flex flex-col items-center justify-center py-12 text-on-surface-variant">
        <span class="material-symbols-outlined text-[48px] opacity-30 mb-3">error</span>
        <p class="font-data-label text-data-label">Failed to load broadcasts.</p>
      </div>
    `;
  }
}

function renderBroadcasts(notifications) {
  if (notifications.length === 0) {
    elements.broadcastsList.innerHTML = `
      <div class="flex flex-col items-center justify-center py-12 text-on-surface-variant">
        <span class="material-symbols-outlined text-[48px] opacity-30 mb-3">campaign</span>
        <p class="font-data-label text-data-label">No broadcasts sent yet.</p>
      </div>
    `;
    return;
  }

  elements.broadcastsList.innerHTML = notifications.map(notif => {
    const date = new Date(notif.created_at).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
    });
    return `
      <div class="glass-card rounded-xl p-4 flex items-start gap-3 border border-white/5">
        <span class="material-symbols-outlined text-tertiary mt-0.5">campaign</span>
        <div class="flex-1">
          <p class="text-on-surface font-body-lg text-sm">${escapeHtml(notif.message)}</p>
          <p class="font-data-label text-[11px] text-on-surface-variant mt-1">${date}</p>
        </div>
      </div>
    `;
  }).join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function sendBroadcast() {
  const message = elements.broadcastMessageInput.value.trim();
  if (!message) {
    showBroadcastStatus('Please enter a message.', 'text-error');
    return;
  }

  elements.btnSendBroadcast.disabled = true;
  elements.btnSendBroadcast.style.opacity = '0.5';
  showBroadcastStatus('Sending...', 'text-on-surface-variant');

  try {
    const headers = {
      'Content-Type': 'application/json',
      'x-admin-login-pin': state.apiKey
    };

    const response = await fetch('/api/notifications', {
      method: 'POST',
      headers,
      body: JSON.stringify({ message })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to send broadcast');
    }

    elements.broadcastMessageInput.value = '';
    showBroadcastStatus('Broadcast sent successfully!', 'text-tertiary');
    fetchBroadcasts();
  } catch (err) {
    console.error('Failed to send broadcast:', err);
    showBroadcastStatus(`Error: ${err.message}`, 'text-error');
  } finally {
    elements.btnSendBroadcast.disabled = false;
    elements.btnSendBroadcast.style.opacity = '1';
  }
}

function showBroadcastStatus(msg, colorClass) {
  elements.broadcastStatus.textContent = msg;
  elements.broadcastStatus.className = `font-data-label text-data-label text-center ${colorClass}`;
  elements.broadcastStatus.classList.remove('hidden');
  setTimeout(() => {
    elements.broadcastStatus.classList.add('hidden');
  }, 4000);
}

// Registered Users Management
async function fetchUsers() {
  if (!state.apiKey) return;

  const tbody = elements.usersTbody;
  tbody.innerHTML = `
    <tr>
      <td colspan="2" class="py-12 text-center text-on-surface-variant">
        <div class="flex flex-col items-center justify-center gap-3">
          <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-secondary"></div>
          <p class="font-data-label text-data-label">Loading registered users...</p>
        </div>
      </td>
    </tr>
  `;

  try {
    const response = await fetch('/api/admin/users', {
      headers: {
        'x-admin-login-pin': state.apiKey
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        showAuthModal();
        return;
      }
      throw new Error(`Server returned status ${response.status}`);
    }

    const data = await response.json();
    renderUsers(data.users || []);
  } catch (err) {
    console.error('Failed to fetch registered users:', err);
    tbody.innerHTML = `
      <tr>
        <td colspan="2" class="py-12 text-center text-error">
          <span class="material-symbols-outlined text-[32px] mb-2">error</span>
          <p class="font-data-label text-data-label">Failed to load users: ${err.message}</p>
        </td>
      </tr>
    `;
  }
}

function renderUsers(users) {
  const tbody = elements.usersTbody;
  if (users.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="2" class="py-12 text-center text-on-surface-variant">
          <span class="material-symbols-outlined text-[48px] opacity-30 mb-3">group</span>
          <p class="font-data-label text-data-label">No registered users found.</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = users.map(user => `
    <tr class="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
      <td class="py-4 px-6 text-on-surface font-semibold">${escapeHtml(user.username)}</td>
      <td class="py-4 px-6 text-on-surface-variant">${user.email ? escapeHtml(user.email) : '<span class="opacity-30 italic">No email provided</span>'}</td>
    </tr>
  `).join('');
}

// Event Listeners
function setupEventListeners() {
  // Navigation
  elements.navOverview.addEventListener('click', (e) => { e.preventDefault(); switchSection('overview'); });
  elements.navLeaderboard.addEventListener('click', (e) => { e.preventDefault(); switchSection('leaderboard'); });
  elements.navRecords.addEventListener('click', (e) => { e.preventDefault(); switchSection('records'); });
  elements.navBroadcasts.addEventListener('click', (e) => { e.preventDefault(); switchSection('broadcasts'); });
  elements.navUsers.addEventListener('click', (e) => { e.preventDefault(); switchSection('users'); });
  
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

  // Auth Submit
  elements.btnSubmitAuth.addEventListener('click', () => {
    const inputVal = elements.authApiKeyInput.value.trim();
    if (inputVal) {
      state.apiKey = inputVal;
      localStorage.setItem('admin_login_pin', inputVal);
      elements.authApiKeyInput.value = '';
      fetchServerData();
    }
  });

  elements.authApiKeyInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      elements.btnSubmitAuth.click();
    }
  });

  // Logout/Lock
  elements.btnLogout.addEventListener('click', () => {
    localStorage.removeItem('admin_login_pin');
    state.apiKey = '';
    triggerLoginPrompt(false);
  });

  // CSV Export
  elements.btnExportCsv.addEventListener('click', exportRecordsToCSV);

  // Broadcasts
  elements.btnSendBroadcast.addEventListener('click', sendBroadcast);
  elements.btnRefreshBroadcasts.addEventListener('click', fetchBroadcasts);

  // Users
  elements.btnRefreshUsers.addEventListener('click', fetchUsers);
}

// Initializing
function init() {
  setupEventListeners();
  switchSection('overview');
  fetchServerData();
}

window.addEventListener('DOMContentLoaded', init);
