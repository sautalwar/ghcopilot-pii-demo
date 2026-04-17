(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants & Config
  // ---------------------------------------------------------------------------

  const API_BASE = '';
  const FETCH_TIMEOUT = 30000;
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
  // 1. Scan Button Click Handler
  // ---------------------------------------------------------------------------

  if (scanBtn) {
    scanBtn.addEventListener('click', async () => {
      scanBtn.disabled = true;
      showLoading('Scanning repository…');
      if (scanStatus) scanStatus.textContent = 'Scanning…';

      try {
        const [repoData, depData, recData] = await Promise.all([
          fetchJSON('/api/scan/repo'),
          fetchJSON('/api/scan/dependencies'),
          fetchJSON('/api/scan/recommendations'),
        ]);

        // Render all panels
        renderFileTree(repoData.tree);
        collectFindings(repoData.issues || repoData.tree);
        renderFindings(allFindings);
        renderDepTree(depData);
        renderRecommendations(recData);
        updateSummary(repoData.summary, repoData);

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
