(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants & Config
  // ---------------------------------------------------------------------------

  const API_BASE = '';
  const FETCH_TIMEOUT = 120000; // 2 min — content scanning fetches many files
  const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const SEVERITY_LABELS = { critical: 'CRITICAL', high: 'HIGH', medium: 'MEDIUM', low: 'LOW', info: 'INFO' };

  // ---------------------------------------------------------------------------
  // DOM References
  // ---------------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);
  const scanBtn = $('scan-btn');
  const scanStatus = $('scan-status');
  const summaryBar = $('summary-bar');
  const fileTreeContainer = $('file-tree');
  const treeSearch = $('tree-search');
  const findingsList = $('findings-list');
  const depTreeView = $('dep-tree-view');
  const recommendationsView = $('recommendations-view');
  const loadingOverlay = $('loading-overlay');
  const loadingText = $('loading-text');

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let allFindings = [];
  let activeFilter = 'all';
  let selectedFilePath = null;
  let currentRepoMode = 'local'; // 'local' or 'owner/repo'
  let ghasAlerts = [];           // GHAS alerts for the selected repo

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  function fetchWithTimeout(url, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  async function fetchJSON(url) {
    const res = await fetchWithTimeout(`${API_BASE}${url}`, FETCH_TIMEOUT);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json();
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function highestSeverity(issues) {
    if (!issues || issues.length === 0) return null;
    return issues.reduce((worst, issue) => {
      const s = (issue.severity || 'info').toLowerCase();
      return (SEVERITY_ORDER[s] ?? 4) < (SEVERITY_ORDER[worst] ?? 4) ? s : worst;
    }, 'info');
  }

  function showLoading(text) {
    if (loadingText) loadingText.textContent = text || 'Loading…';
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');
  }

  function hideLoading() {
    if (loadingOverlay) loadingOverlay.classList.add('hidden');
  }

  function showError(container, message) {
    if (!container) return;
    container.innerHTML = `<div class="error-message">${escapeHTML(message)}</div>`;
  }

  // ---------------------------------------------------------------------------
  // Multi-Repo: DOM References
  // ---------------------------------------------------------------------------

  const repoSelect = $('repo-select');
  const repoUrlInput = $('repo-url-input');
  const loadReposBtn = $('load-repos-btn');
  const repoCount = $('repo-count');
  const scanAllBtn = $('scan-all-btn');
  const fixModal = $('fix-modal');
  const fixModalTitle = $('fix-modal-title');
  const fixModalBody = $('fix-modal-body');
  const fixModalClose = $('fix-modal-close');
  const fixModalAutoFix = $('fix-modal-auto-fix');
  const fixModalDismiss = $('fix-modal-dismiss');

  // ---------------------------------------------------------------------------
  // Multi-Repo: Load Repos
  // ---------------------------------------------------------------------------

  async function loadRepos() {
    if (!loadReposBtn || !repoSelect) return;
    try {
      loadReposBtn.disabled = true;
      loadReposBtn.textContent = '↻ Loading...';
      const data = await fetchJSON('/api/multi/repos');
      const repos = data.data || [];
      while (repoSelect.options.length > 2) repoSelect.remove(2); // keep Local + Custom
      repos.forEach(function (repo) {
        var opt = document.createElement('option');
        opt.value = repo.fullName;
        opt.textContent = (repo.isPrivate ? '🔒 ' : '🌐 ') + repo.name + ' (' + (repo.language || 'unknown') + ')';
        repoSelect.appendChild(opt);
      });
      if (repoCount) repoCount.textContent = repos.length + ' repos';
    } catch (err) {
      if (repoCount) repoCount.textContent = 'Failed to load repos';
    } finally {
      loadReposBtn.disabled = false;
      loadReposBtn.textContent = '↻ Load Repos';
    }
  }

  if (loadReposBtn) {
    loadReposBtn.addEventListener('click', loadRepos);
  }

  // Parse GitHub URL or owner/repo string into owner/repo format
  function parseRepoInput(input) {
    if (!input) return null;
    input = input.trim();
    // Handle full URLs: https://github.com/owner/repo or github.com/owner/repo
    var urlMatch = input.match(/(?:https?:\/\/)?github\.com\/([^\/\s]+)\/([^\/\s#?]+)/);
    if (urlMatch) return urlMatch[1] + '/' + urlMatch[2].replace(/\.git$/, '');
    // Handle owner/repo format directly
    var slashMatch = input.match(/^([^\/\s]+)\/([^\/\s]+)$/);
    if (slashMatch) return slashMatch[1] + '/' + slashMatch[2];
    return null;
  }

  if (repoSelect) {
    repoSelect.addEventListener('change', function () {
      var val = repoSelect.value;
      if (val === 'custom') {
        // Show URL input
        if (repoUrlInput) {
          repoUrlInput.classList.remove('hidden');
          repoUrlInput.focus();
        }
        currentRepoMode = 'local'; // don't scan until URL entered
      } else {
        if (repoUrlInput) repoUrlInput.classList.add('hidden');
        currentRepoMode = val;
      }
    });
  }

  if (repoUrlInput) {
    repoUrlInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var parsed = parseRepoInput(repoUrlInput.value);
        if (parsed) {
          currentRepoMode = parsed;
          if (scanStatus) scanStatus.textContent = 'Repo: ' + parsed;
          // Auto-trigger scan
          if (scanBtn) scanBtn.click();
        } else {
          if (scanStatus) scanStatus.textContent = 'Invalid repo URL';
        }
      }
    });
    repoUrlInput.addEventListener('blur', function () {
      var parsed = parseRepoInput(repoUrlInput.value);
      if (parsed) {
        currentRepoMode = parsed;
        if (scanStatus) scanStatus.textContent = 'Repo: ' + parsed;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Multi-Repo: Scan All Repos
  // ---------------------------------------------------------------------------

  if (scanAllBtn) {
    scanAllBtn.addEventListener('click', async function () {
      scanAllBtn.disabled = true;
      showLoading('Scanning all repositories…');
      if (scanStatus) scanStatus.textContent = 'Scanning all…';
      try {
        var data = await fetchJSON('/api/multi/repos/scan');
        var results = data.data || [];
        // Aggregate all findings across repos
        ghasAlerts = [];
        results.forEach(function (repoResult) {
          if (repoResult.alerts) {
            var allAlerts = [].concat(
              repoResult.alerts.critical || [],
              repoResult.alerts.high || [],
              repoResult.alerts.medium || [],
              repoResult.alerts.low || []
            );
            allAlerts.forEach(function (a) { a._repo = repoResult.repo; });
            ghasAlerts = ghasAlerts.concat(allAlerts);
          }
        });
        renderGHASFindings(ghasAlerts);
        updateGHASSummary(ghasAlerts, results.length);
        if (scanStatus) scanStatus.textContent = 'Multi-repo scan complete';
      } catch (err) {
        if (scanStatus) scanStatus.textContent = 'Scan failed';
        showError(findingsList, err.message);
      } finally {
        hideLoading();
        scanAllBtn.disabled = false;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Multi-Repo: GHAS Findings Rendering
  // ---------------------------------------------------------------------------

  function renderGHASFindings(alerts) {
    if (!findingsList) return;
    if (!alerts || alerts.length === 0) {
      findingsList.innerHTML = '<p class="empty-state">No GHAS findings</p>';
      return;
    }
    findingsList.innerHTML = '';

    // Sort by severity
    var sorted = alerts.slice().sort(function (a, b) {
      return (SEVERITY_ORDER[(a.severity || 'info').toLowerCase()] || 4)
           - (SEVERITY_ORDER[(b.severity || 'info').toLowerCase()] || 4);
    });

    sorted.forEach(function (alert, i) {
      var sev = (alert.severity || 'info').toLowerCase();
      var card = document.createElement('div');
      card.className = 'finding-card severity-' + sev;
      card.style.animationDelay = (i * 60) + 'ms';

      // Header row
      var headerDiv = document.createElement('div');
      headerDiv.className = 'finding-card-header';

      var sevBadge = document.createElement('span');
      sevBadge.className = 'severity-badge ' + sev;
      sevBadge.textContent = SEVERITY_LABELS[sev] || sev.toUpperCase();
      headerDiv.appendChild(sevBadge);

      if (alert.type) {
        var typeBadge = document.createElement('span');
        typeBadge.className = 'finding-type-badge';
        typeBadge.textContent = alert.type.replace(/-/g, ' ');
        headerDiv.appendChild(typeBadge);
      }

      if (alert._repo) {
        var repoSpan = document.createElement('span');
        repoSpan.className = 'finding-file';
        repoSpan.textContent = alert._repo;
        headerDiv.appendChild(repoSpan);
      }

      card.appendChild(headerDiv);

      // Title
      var titleDiv = document.createElement('div');
      titleDiv.className = 'finding-rule';
      titleDiv.textContent = alert.title || alert.rule || alert.description || 'Untitled finding';
      card.appendChild(titleDiv);

      // Description / message
      if (alert.description || alert.message) {
        var msgDiv = document.createElement('div');
        msgDiv.className = 'finding-message';
        msgDiv.textContent = alert.description || alert.message;
        card.appendChild(msgDiv);
      }

      // File / package meta
      var meta = document.createElement('div');
      meta.className = 'finding-meta';
      if (alert.file || alert.path) {
        var filePath = document.createElement('span');
        filePath.className = 'file-path';
        filePath.textContent = alert.file || alert.path;
        meta.appendChild(filePath);
      }
      if (alert.package) {
        var pkgSpan = document.createElement('span');
        pkgSpan.className = 'file-path';
        pkgSpan.textContent = '📦 ' + alert.package;
        meta.appendChild(pkgSpan);
      }
      card.appendChild(meta);

      // Action buttons
      var actions = document.createElement('div');
      actions.className = 'finding-card-actions';

      var fixBtn = document.createElement('button');
      fixBtn.className = 'fix-btn';
      fixBtn.textContent = '🔧 Show Fix';
      fixBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        showFixModal(alert);
      });
      actions.appendChild(fixBtn);

      var autoFixBtn = document.createElement('button');
      autoFixBtn.className = 'auto-fix-btn';
      autoFixBtn.textContent = '🤖 Auto-Fix';
      autoFixBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        triggerAutoFix(alert, autoFixBtn);
      });
      actions.appendChild(autoFixBtn);

      // PR status placeholder
      var prStatusSpan = document.createElement('span');
      prStatusSpan.className = 'pr-status hidden';
      prStatusSpan.setAttribute('data-finding-id', alert.id || alert.number || '');
      actions.appendChild(prStatusSpan);

      card.appendChild(actions);
      findingsList.appendChild(card);
    });
  }

  function updateGHASSummary(alerts, repoCountNum) {
    if (!summaryBar) return;
    summaryBar.classList.remove('hidden');
    var counts = { critical: 0, high: 0, medium: 0, low: 0 };
    (alerts || []).forEach(function (a) {
      var s = (a.severity || 'info').toLowerCase();
      if (counts[s] !== undefined) counts[s]++;
    });
    setStat('stat-critical', counts.critical);
    setStat('stat-high', counts.high);
    setStat('stat-medium', counts.medium);
    setStat('stat-low', counts.low);
    setStat('stat-total', (repoCountNum || '—') + ' repos');
    setStat('stat-duration', alerts.length + ' findings');
  }

  // ---------------------------------------------------------------------------
  // Multi-Repo: Fix Description Modal
  // ---------------------------------------------------------------------------

  var currentFixAlert = null;

  function showFixModal(alert) {
    if (!fixModal) return;
    currentFixAlert = alert;
    if (fixModalTitle) fixModalTitle.textContent = alert.title || alert.rule || 'Fix Description';
    if (fixModalBody) fixModalBody.innerHTML = '<p>Loading fix description…</p>';
    fixModal.classList.remove('hidden');

    var repoFullName = alert._repo || currentRepoMode;
    if (!repoFullName || repoFullName === 'local') {
      if (fixModalBody) fixModalBody.innerHTML = '<p>Fix descriptions are only available for GitHub repos.</p>';
      return;
    }

    var parts = repoFullName.split('/');
    var owner = parts[0];
    var repo = parts[1];
    var findingId = alert.id || alert.number || 0;

    fetchJSON('/api/multi/repos/' + owner + '/' + repo + '/fix/' + findingId)
      .then(function (data) {
        var fix = data.data || data;
        var html = '';
        if (fix.whatIsWrong) html += '<h4>⚠️ What is Wrong</h4><p>' + escapeHTML(fix.whatIsWrong) + '</p>';
        if (fix.whyItMatters) html += '<h4>💡 Why It Matters</h4><p>' + escapeHTML(fix.whyItMatters) + '</p>';
        if (fix.howToFix) html += '<h4>🔧 How to Fix</h4><p>' + escapeHTML(fix.howToFix) + '</p>';
        if (fix.codeExample) html += '<h4>📝 Code Example</h4><pre>' + escapeHTML(fix.codeExample) + '</pre>';
        if (!html) html = '<p>' + escapeHTML(fix.description || fix.message || 'No fix details available.') + '</p>';
        if (fixModalBody) fixModalBody.innerHTML = html;
      })
      .catch(function (err) {
        if (fixModalBody) fixModalBody.innerHTML = '<p class="error-message">Failed to load fix: ' + escapeHTML(err.message) + '</p>';
      });
  }

  function closeFixModal() {
    if (fixModal) fixModal.classList.add('hidden');
    currentFixAlert = null;
  }

  if (fixModalClose) fixModalClose.addEventListener('click', closeFixModal);
  if (fixModalDismiss) fixModalDismiss.addEventListener('click', closeFixModal);

  // Close modal on Escape key or clicking outside
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && fixModal && !fixModal.classList.contains('hidden')) {
      closeFixModal();
    }
  });

  if (fixModal) {
    fixModal.addEventListener('click', function (e) {
      if (e.target === fixModal) closeFixModal();
    });
  }

  // Auto-Fix from modal
  if (fixModalAutoFix) {
    fixModalAutoFix.addEventListener('click', function () {
      if (currentFixAlert) triggerAutoFix(currentFixAlert, fixModalAutoFix);
    });
  }

  // ---------------------------------------------------------------------------
  // Multi-Repo: Auto-Fix (Remediation PR)
  // ---------------------------------------------------------------------------

  function triggerAutoFix(alert, btn) {
    var repoFullName = alert._repo || currentRepoMode;
    if (!repoFullName || repoFullName === 'local') {
      showError(findingsList, 'Auto-fix is only available for GitHub repos.');
      return;
    }
    var parts = repoFullName.split('/');
    var owner = parts[0];
    var repo = parts[1];
    var findingId = alert.id || alert.number || 0;

    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Creating PR…';
    }

    // Show PR status as "creating"
    var prSpan = findingsList.querySelector('[data-finding-id="' + findingId + '"]');
    if (prSpan) {
      prSpan.className = 'pr-status creating';
      prSpan.textContent = '⏳ Creating PR…';
    }

    fetch(API_BASE + '/api/multi/repos/' + owner + '/' + repo + '/remediate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ findingId: findingId })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success && data.data && data.data.prNumber) {
          if (prSpan) {
            prSpan.className = 'pr-status open';
            prSpan.textContent = '🔗 PR #' + data.data.prNumber;
          }
          if (btn) {
            btn.textContent = '✅ PR Created';
            btn.disabled = true;
          }
          // Start polling PR status
          pollPRStatus(owner, repo, data.data.prNumber, prSpan);
        } else {
          if (prSpan) {
            prSpan.className = 'pr-status failed';
            prSpan.textContent = '❌ ' + (data.error || 'Failed');
          }
          if (btn) {
            btn.textContent = '🤖 Auto-Fix';
            btn.disabled = false;
          }
        }
      })
      .catch(function (err) {
        if (prSpan) {
          prSpan.className = 'pr-status failed';
          prSpan.textContent = '❌ Error';
        }
        if (btn) {
          btn.textContent = '🤖 Auto-Fix';
          btn.disabled = false;
        }
      });
  }

  // ---------------------------------------------------------------------------
  // Multi-Repo: PR Status Polling
  // ---------------------------------------------------------------------------

  function pollPRStatus(owner, repo, prNumber, statusEl) {
    if (!statusEl) return;
    var pollInterval = setInterval(function () {
      fetchJSON('/api/multi/repos/' + owner + '/' + repo + '/pr/' + prNumber)
        .then(function (data) {
          var pr = data.data || data;
          var state = (pr.state || 'open').toLowerCase();
          if (pr.merged || state === 'merged') {
            statusEl.className = 'pr-status merged';
            statusEl.textContent = '✅ PR #' + prNumber + ' merged';
            clearInterval(pollInterval);
          } else if (state === 'closed') {
            statusEl.className = 'pr-status failed';
            statusEl.textContent = '🚫 PR #' + prNumber + ' closed';
            clearInterval(pollInterval);
          } else {
            statusEl.className = 'pr-status open';
            statusEl.textContent = '🔗 PR #' + prNumber + ' (' + state + ')';
          }
        })
        .catch(function () {
          clearInterval(pollInterval);
        });
    }, 10000); // Poll every 10 seconds
  }

  // ---------------------------------------------------------------------------
  // 1. Scan Button Click Handler
  // ---------------------------------------------------------------------------

  if (scanBtn) {
    scanBtn.addEventListener('click', async () => {
      scanBtn.disabled = true;
      showLoading('Scanning repository…');
      if (scanStatus) scanStatus.textContent = 'Scanning…';

      try {
        if (currentRepoMode === 'local') {
          // Existing local scan
          const [repoData, depData, recData] = await Promise.all([
            fetchJSON('/api/scan/repo'),
            fetchJSON('/api/scan/dependencies'),
            fetchJSON('/api/scan/recommendations'),
          ]);

          renderFileTree(repoData.tree);
          collectFindings(repoData.issues || repoData.tree);
          renderFindings(allFindings);
          renderDepTree(depData);
          renderRecommendations(recData);
          updateSummary(repoData.summary, repoData);
        } else {
          // Content-based scan for remote GitHub repos (GHAS + file scanning)
          var parts = currentRepoMode.split('/');
          var owner = parts[0];
          var repo = parts[1];
          showLoading('Scanning ' + currentRepoMode + ' (fetching files)…');

          // Run content-based scan AND GHAS scan in parallel
          const [contentData, alertsData] = await Promise.all([
            fetchJSON('/api/multi/repos/' + owner + '/' + repo + '/content-scan'),
            fetchJSON('/api/multi/repos/' + owner + '/' + repo + '/alerts').catch(function () { return { data: {} }; }),
          ]);

          var content = contentData.data || contentData;
          var alerts = alertsData.data || alertsData;

          // Render file tree from content scan
          if (content.tree) {
            renderFileTree(content.tree);
          }

          // Merge GHAS alerts + content findings into a unified list
          var ghasAlertsList = [];
          if (alerts.bySeverity) {
            var grouped = alerts.bySeverity || alerts;
            ghasAlertsList = [].concat(
              (grouped.critical || []),
              (grouped.high || []),
              (grouped.medium || []),
              (grouped.low || [])
            );
          }

          // Content scan findings are already SecurityFinding objects
          var contentFindings = (content.findings || []).map(function (f) {
            f._repo = currentRepoMode;
            f._source = f.type === 'secret-pattern' ? 'content-scan' : 'content-scan';
            return f;
          });

          // Tag GHAS alerts with source
          ghasAlertsList.forEach(function (a) {
            a._repo = currentRepoMode;
            a._source = 'ghas';
          });

          // Combine and deduplicate (prefer GHAS findings if same file+line)
          var seen = new Set();
          var mergedFindings = [];
          ghasAlertsList.forEach(function (a) {
            var key = (a.file || '') + ':' + (a.line || 0);
            seen.add(key);
            mergedFindings.push(a);
          });
          contentFindings.forEach(function (f) {
            var key = (f.file || '') + ':' + (f.line || 0);
            if (!seen.has(key)) {
              mergedFindings.push(f);
            }
          });

          ghasAlerts = mergedFindings;
          renderGHASFindings(ghasAlerts);

          // Update summary with content scan stats
          var summary = content.summary || {};
          if (summaryBar) summaryBar.classList.remove('hidden');
          setStat('stat-critical', summary.bySeverity ? summary.bySeverity.critical : 0);
          setStat('stat-high', summary.bySeverity ? summary.bySeverity.high : 0);
          setStat('stat-medium', summary.bySeverity ? summary.bySeverity.medium : 0);
          setStat('stat-low', summary.bySeverity ? summary.bySeverity.low : 0);
          setStat('stat-total', (summary.scannedFiles || 0) + '/' + (summary.totalFiles || 0) + ' files');
          setStat('stat-duration', (summary.scanDurationMs || 0) + ' ms Scan Time');

          // Render dependencies from content scan
          if (content.dependencies && content.dependencies.length > 0) {
            renderRemoteDeps(content.dependencies);
          } else {
            if (depTreeView) depTreeView.innerHTML = '<p class="placeholder">No package.json found in repo</p>';
          }

          if (recommendationsView) {
            var recHtml = '<div class="rec-list">';
            if (mergedFindings.length > 0) {
              var critCount = mergedFindings.filter(function (f) { return f.severity === 'critical'; }).length;
              var highCount = mergedFindings.filter(function (f) { return f.severity === 'high'; }).length;
              if (critCount > 0) recHtml += '<div class="rec-item severity-critical"><strong>🚨 ' + critCount + ' critical findings</strong> — address immediately</div>';
              if (highCount > 0) recHtml += '<div class="rec-item severity-high"><strong>⚠️ ' + highCount + ' high findings</strong> — fix before next release</div>';
              recHtml += '<div class="rec-item"><strong>💡 Tip:</strong> Click "Fix" on any finding to see remediation guidance</div>';
            } else {
              recHtml += '<div class="rec-item">✅ No security findings detected in scanned files</div>';
            }
            recHtml += '</div>';
            recommendationsView.innerHTML = recHtml;
          }
        }

        if (scanStatus) scanStatus.textContent = 'Scan complete';
      } catch (err) {
        const msg = err.name === 'AbortError' ? 'Scan timed out after 30 s' : err.message;
        if (scanStatus) scanStatus.textContent = 'Scan failed';
        showError(findingsList, msg);
        showError(fileTreeContainer, msg);
      } finally {
        hideLoading();
        scanBtn.disabled = false;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Helper: Collect all findings from a tree or flat issues array
  // ---------------------------------------------------------------------------

  function collectFindings(source) {
    allFindings = [];
    if (Array.isArray(source)) {
      // Flat issues array
      allFindings = source.slice();
    } else if (source && typeof source === 'object') {
      // Recursive tree
      flattenIssues(source);
    }
    allFindings.sort(
      (a, b) => (SEVERITY_ORDER[(a.severity || 'info').toLowerCase()] ?? 4)
              - (SEVERITY_ORDER[(b.severity || 'info').toLowerCase()] ?? 4)
    );
  }

  function flattenIssues(node) {
    if (node.securityIssues) {
      node.securityIssues.forEach((issue) => {
        allFindings.push({ ...issue, file: issue.file || node.path });
      });
    }
    if (node.children) node.children.forEach(flattenIssues);
  }

  // ---------------------------------------------------------------------------
  // 2. File Tree Rendering
  // ---------------------------------------------------------------------------

  function renderFileTree(tree) {
    if (!fileTreeContainer) return;
    if (!tree) {
      fileTreeContainer.innerHTML = '<p class="empty-state">No file tree data</p>';
      return;
    }
    fileTreeContainer.innerHTML = '';
    fileTreeContainer.appendChild(buildTreeNode(tree));
  }

  function buildTreeNode(node) {
    const isFolder = node.type === 'directory' || (node.children && node.children.length > 0);
    const el = document.createElement('div');
    el.className = 'tree-item' + (isFolder ? ' folder' : ' file') + (node.issueCount > 0 ? ' has-issues' : '');
    el.setAttribute('data-path', node.path || node.name);
    el.setAttribute('data-name', (node.name || '').toLowerCase());

    // Header row
    const header = document.createElement('div');
    header.className = 'tree-item-header';

    if (isFolder) {
      const toggle = document.createElement('span');
      toggle.className = 'tree-toggle';
      toggle.textContent = '▶';
      header.appendChild(toggle);
    }

    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    icon.textContent = isFolder ? '📁' : '📄';
    header.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = node.name;
    header.appendChild(name);

    if (node.issueCount > 0) {
      const badge = document.createElement('span');
      const sev = highestSeverity(node.securityIssues) || 'medium';
      badge.className = `tree-badge severity-${sev}`;
      badge.textContent = node.issueCount;
      header.appendChild(badge);
    }

    el.appendChild(header);

    // Children container
    if (isFolder && node.children && node.children.length > 0) {
      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'tree-children';

      // Sort: directories first, then alphabetically
      const sorted = [...node.children].sort((a, b) => {
        const aDir = a.type === 'directory' || (a.children && a.children.length > 0) ? 0 : 1;
        const bDir = b.type === 'directory' || (b.children && b.children.length > 0) ? 0 : 1;
        if (aDir !== bDir) return aDir - bDir;
        return (a.name || '').localeCompare(b.name || '');
      });

      sorted.forEach((child) => childrenContainer.appendChild(buildTreeNode(child)));
      el.appendChild(childrenContainer);

      // Collapse / expand
      header.addEventListener('click', (e) => {
        e.stopPropagation();
        const isExpanded = el.classList.toggle('expanded');
        const tog = header.querySelector('.tree-toggle');
        if (tog) tog.textContent = isExpanded ? '▼' : '▶';
      });
    } else {
      // File click → highlight and filter findings
      header.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.tree-item.selected').forEach((s) => s.classList.remove('selected'));
        el.classList.add('selected');
        selectedFilePath = node.path || node.name;
        applyFindingsFilter();
      });
    }

    return el;
  }

  // ---------------------------------------------------------------------------
  // 3. Findings List Rendering
  // ---------------------------------------------------------------------------

  function renderFindings(findings) {
    if (!findingsList) return;
    if (!findings || findings.length === 0) {
      findingsList.innerHTML = '<p class="empty-state">No findings</p>';
      return;
    }
    findingsList.innerHTML = '';

    findings.forEach((f, i) => {
      const sev = (f.severity || 'info').toLowerCase();
      const card = document.createElement('div');
      card.className = 'finding-card';
      card.setAttribute('data-type', f.type || '');
      card.setAttribute('data-file', f.file || '');
      card.style.animationDelay = `${i * 60}ms`;

      const headerDiv = document.createElement('div');
      headerDiv.className = 'finding-header';

      const sevBadge = document.createElement('span');
      sevBadge.className = `severity-badge ${sev}`;
      sevBadge.textContent = SEVERITY_LABELS[sev] || sev.toUpperCase();
      headerDiv.appendChild(sevBadge);

      if (f.file) {
        const fileSpan = document.createElement('span');
        fileSpan.className = 'finding-file';
        fileSpan.textContent = f.file;
        headerDiv.appendChild(fileSpan);
      }

      if (f.line != null) {
        const lineSpan = document.createElement('span');
        lineSpan.className = 'finding-line';
        lineSpan.textContent = `Line ${f.line}`;
        headerDiv.appendChild(lineSpan);
      }

      card.appendChild(headerDiv);

      if (f.message) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'finding-message';
        msgDiv.textContent = f.message;
        card.appendChild(msgDiv);
      }

      if (f.pattern) {
        const patDiv = document.createElement('div');
        patDiv.className = 'finding-pattern';
        patDiv.textContent = `Pattern: ${f.pattern}`;
        card.appendChild(patDiv);
      }

      findingsList.appendChild(card);
    });
  }

  function applyFindingsFilter() {
    let filtered = allFindings;

    if (activeFilter !== 'all') {
      filtered = filtered.filter((f) => f.type === activeFilter);
    }
    if (selectedFilePath) {
      filtered = filtered.filter((f) => f.file === selectedFilePath);
    }

    renderFindings(filtered);
  }

  // ---------------------------------------------------------------------------
  // 4. Filter Pills
  // ---------------------------------------------------------------------------

  document.querySelectorAll('[data-filter]').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('[data-filter]').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      activeFilter = pill.getAttribute('data-filter');
      applyFindingsFilter();
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Dependency Tree Rendering
  // ---------------------------------------------------------------------------

  function renderRemoteDeps(deps) {
    if (!depTreeView) return;
    if (!deps || deps.length === 0) {
      depTreeView.innerHTML = '<p class="empty-state">No dependencies found</p>';
      return;
    }
    depTreeView.innerHTML = '';
    var header = document.createElement('div');
    header.className = 'dep-tree-header';
    var directCount = deps.filter(function (d) { return d.type === 'direct'; }).length;
    var devCount = deps.filter(function (d) { return d.type === 'dev'; }).length;
    header.innerHTML =
      '<span class="dep-stat">Direct: <strong>' + directCount + '</strong></span>' +
      '<span class="dep-stat">Dev: <strong>' + devCount + '</strong></span>' +
      '<span class="dep-stat">Total: <strong>' + deps.length + '</strong></span>';
    depTreeView.appendChild(header);

    deps.forEach(function (dep) {
      var el = document.createElement('div');
      el.className = 'dep-node' + (dep.type === 'direct' ? ' direct' : '');
      var nameSpan = '<span class="dep-name">' + escapeHTML(dep.name) + '</span>';
      var verSpan = '<span class="dep-version">@' + escapeHTML(dep.version) + '</span>';
      var typeTag = dep.type === 'dev' ? '<span class="dep-license license-warning">dev</span>' : '<span class="dep-license license-allowed">prod</span>';
      el.innerHTML = '<div class="dep-node-header">' + nameSpan + verSpan + typeTag + '</div>';
      depTreeView.appendChild(el);
    });
  }

  function renderDepTree(data) {
    if (!depTreeView) return;
    if (!data || !data.tree || data.tree.length === 0) {
      depTreeView.innerHTML = '<p class="empty-state">No dependency data</p>';
      return;
    }

    depTreeView.innerHTML = '';

    // Header with stats
    const header = document.createElement('div');
    header.className = 'dep-tree-header';
    header.innerHTML =
      `<span class="dep-stat">Total: <strong>${escapeHTML(String(data.totalCount ?? data.tree.length))}</strong></span>` +
      `<span class="dep-stat">Max depth: <strong>${escapeHTML(String(data.maxDepth ?? '—'))}</strong></span>`;
    depTreeView.appendChild(header);

    data.tree.forEach((node) => depTreeView.appendChild(buildDepNode(node, 0)));
  }

  function buildDepNode(node, currentDepth) {
    const hasChildren = node.dependencies && node.dependencies.length > 0;
    const el = document.createElement('div');
    el.className =
      'dep-node' +
      (node.vulnerable ? ' vulnerable' : '') +
      (node.isDirect ? ' direct' : '');
    el.setAttribute('data-pkg', node.name || '');

    const header = document.createElement('div');
    header.className = 'dep-node-header';

    if (hasChildren) {
      const toggle = document.createElement('span');
      toggle.className = 'dep-toggle';
      toggle.textContent = currentDepth < 2 ? '▼' : '▶';
      header.appendChild(toggle);
    }

    const nameSpan = document.createElement('span');
    nameSpan.className = 'dep-name';
    nameSpan.textContent = node.name;
    header.appendChild(nameSpan);

    if (node.version) {
      const verSpan = document.createElement('span');
      verSpan.className = 'dep-version';
      verSpan.textContent = `@${node.version}`;
      header.appendChild(verSpan);
    }

    if (node.license) {
      const licSpan = document.createElement('span');
      const allowed = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD'];
      licSpan.className = 'dep-license ' + (allowed.includes(node.license) ? 'license-allowed' : 'license-warning');
      licSpan.textContent = node.license;
      header.appendChild(licSpan);
    }

    if (hasChildren) {
      const countBadge = document.createElement('span');
      countBadge.className = 'dep-badge';
      countBadge.textContent = `${node.dependencies.length} deps`;
      header.appendChild(countBadge);
    }

    el.appendChild(header);

    if (hasChildren) {
      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'dep-children';
      // Collapse deeper nodes by default
      if (currentDepth >= 2) childrenContainer.classList.add('collapsed');

      node.dependencies.forEach((child) => {
        childrenContainer.appendChild(buildDepNode(child, currentDepth + 1));
      });
      el.appendChild(childrenContainer);

      // Start expanded if depth < 2
      if (currentDepth < 2) el.classList.add('expanded');

      header.addEventListener('click', (e) => {
        e.stopPropagation();
        const isExpanded = el.classList.toggle('expanded');
        childrenContainer.classList.toggle('collapsed', !isExpanded);
        const tog = header.querySelector('.dep-toggle');
        if (tog) tog.textContent = isExpanded ? '▼' : '▶';
      });
    }

    return el;
  }

  // ---------------------------------------------------------------------------
  // 6. Recommendations Rendering
  // ---------------------------------------------------------------------------

  function renderRecommendations(data) {
    if (!recommendationsView) return;
    const recs = Array.isArray(data) ? data : (data && data.recommendations) || [];
    if (recs.length === 0) {
      recommendationsView.innerHTML = '<p class="empty-state">No recommendations</p>';
      return;
    }

    recommendationsView.innerHTML = '';

    recs.forEach((rec, i) => {
      const card = document.createElement('div');
      card.className = 'recommendation-card';

      const priority = document.createElement('div');
      priority.className = 'rec-priority';
      priority.textContent = `#${rec.priority ?? i + 1}`;
      card.appendChild(priority);

      const content = document.createElement('div');
      content.className = 'rec-content';

      const title = document.createElement('div');
      title.className = 'rec-title';
      title.textContent = rec.title;
      content.appendChild(title);

      if (rec.description) {
        const desc = document.createElement('div');
        desc.className = 'rec-description';
        desc.textContent = rec.description;
        content.appendChild(desc);
      }

      if (rec.action) {
        const action = document.createElement('div');
        action.className = 'rec-action';
        action.textContent = `Action: ${rec.action}`;
        content.appendChild(action);
      }

      if (rec.affectedFiles && rec.affectedFiles.length > 0) {
        const files = document.createElement('div');
        files.className = 'rec-files';
        files.textContent = `Affected: ${rec.affectedFiles.join(', ')}`;
        content.appendChild(files);
      }

      card.appendChild(content);

      if (rec.severity) {
        const sev = (rec.severity || 'info').toLowerCase();
        const badge = document.createElement('span');
        badge.className = `severity-badge ${sev}`;
        badge.textContent = SEVERITY_LABELS[sev] || sev.toUpperCase();
        card.appendChild(badge);
      }

      recommendationsView.appendChild(card);
    });
  }

  // ---------------------------------------------------------------------------
  // 7. Tab Switching
  // ---------------------------------------------------------------------------

  document.querySelectorAll('[data-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-tab');

      // Toggle active class on tab buttons
      document.querySelectorAll('[data-tab]').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      // Show/hide views
      if (depTreeView) depTreeView.classList.toggle('hidden', target !== 'dep-tree');
      if (recommendationsView) recommendationsView.classList.toggle('hidden', target !== 'recommendations');
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Tree Search Filter
  // ---------------------------------------------------------------------------

  if (treeSearch) {
    treeSearch.addEventListener('input', () => {
      const query = treeSearch.value.trim().toLowerCase();
      if (!query) {
        // Show all
        fileTreeContainer.querySelectorAll('.tree-item').forEach((item) => {
          item.classList.remove('search-hidden');
        });
        return;
      }

      // Hide everything first, then reveal matches and their ancestors
      const allItems = fileTreeContainer.querySelectorAll('.tree-item');
      allItems.forEach((item) => item.classList.add('search-hidden'));

      allItems.forEach((item) => {
        const name = item.getAttribute('data-name') || '';
        if (name.includes(query)) {
          revealWithAncestors(item);
        }
      });
    });
  }

  function revealWithAncestors(el) {
    el.classList.remove('search-hidden');
    // Also expand ancestor folders so the match is visible
    let parent = el.parentElement;
    while (parent && parent !== fileTreeContainer) {
      if (parent.classList.contains('tree-item')) {
        parent.classList.remove('search-hidden');
        parent.classList.add('expanded');
        const tog = parent.querySelector(':scope > .tree-item-header > .tree-toggle');
        if (tog) tog.textContent = '▼';
      }
      parent = parent.parentElement;
    }
  }

  // ---------------------------------------------------------------------------
  // 9. Summary Bar Update
  // ---------------------------------------------------------------------------

  function updateSummary(summary, repoData) {
    if (!summaryBar) return;
    summaryBar.classList.remove('hidden');

    const s = summary || {};
    const counts = s.severityCounts || s.counts || {};

    setStat('stat-critical', counts.critical ?? 0);
    setStat('stat-high', counts.high ?? 0);
    setStat('stat-medium', counts.medium ?? 0);
    setStat('stat-low', counts.low ?? 0);
    setStat('stat-total', s.totalFiles ?? s.filesScanned ?? (repoData && repoData.totalFiles) ?? '—');
    setStat('stat-duration', s.duration != null ? `${s.duration}ms` : '—');
  }

  function setStat(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  // ---------------------------------------------------------------------------
  // 10. Clear selected file (click outside tree)
  // ---------------------------------------------------------------------------

  if (fileTreeContainer) {
    fileTreeContainer.addEventListener('click', (e) => {
      if (e.target === fileTreeContainer) {
        selectedFilePath = null;
        document.querySelectorAll('.tree-item.selected').forEach((s) => s.classList.remove('selected'));
        applyFindingsFilter();
      }
    });
  }
})();
