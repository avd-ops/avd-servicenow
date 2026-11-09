/* Personal project, not for production, as is; not affiliated with the author's employer, ServiceNow, Liquidware or Microsoft. MIT.
   site/portal/portal.js: client-side UI logic for the AVD ServiceNow Bridge & CSDM Workbench. */
(function () {
  'use strict';

  var core = window.AvdServiceNowCore;
  if (!core) return;

  var TABS = [
    { id: 'cmdb', label: '1. CMDB & CSDM' },
    { id: 'assess', label: '2. Drift & Change' },
    { id: 'swarm', label: '3. Swarm Intake' },
    { id: 'run', label: '4. Validate & Run' }
  ];

  var state = {
    activeTab: 'cmdb',
    sample: null
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === 'string') node.textContent = text;
    return node;
  }

  function clearNode(node) {
    while (node && node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function renderTabs() {
    var list = document.getElementById('steps');
    var bar = document.getElementById('steps-bar');
    clearNode(list);
    clearNode(bar);

    for (var i = 0; i < TABS.length; i++) {
      (function (tab) {
        var li = el('li', tab.id === state.activeTab ? 'active' : '');
        var btn = el('button', 'wz-tool', tab.label);
        btn.type = 'button';
        btn.setAttribute('aria-current', tab.id === state.activeTab ? 'step' : 'false');
        btn.addEventListener('click', function () {
          switchTab(tab.id);
        });
        li.appendChild(btn);
        if (list) list.appendChild(li);

        var bli = el('li', tab.id === state.activeTab ? 'active' : '');
        var bbtn = el('button', 'wz-tool', tab.label);
        bbtn.type = 'button';
        bbtn.addEventListener('click', function () {
          switchTab(tab.id);
        });
        bli.appendChild(bbtn);
        if (bar) bar.appendChild(bli);
      })(TABS[i]);
    }
  }

  function switchTab(tabId) {
    state.activeTab = tabId;
    renderTabs();
    for (var i = 0; i < TABS.length; i++) {
      var section = document.getElementById('stage-' + TABS[i].id);
      if (section) {
        if (TABS[i].id === tabId) {
          section.classList.remove('hidden');
        } else {
          section.classList.add('hidden');
        }
      }
    }
  }

  function getEnvelope() {
    var slugEl = document.getElementById('cmdb-slug');
    var redactEl = document.getElementById('cmdb-redaction');
    var slug = (slugEl && slugEl.value) ? slugEl.value.trim() : 'contoso-prod';
    var allowReal = redactEl && redactEl.value === 'estate-identifiers-opt-in';
    var sample = state.sample || {};
    return core.buildSyncEnvelope({
      estateSlug: slug,
      allowEstateIdentifiers: allowReal,
      c11: sample.c11 || {},
      c21: sample.c21 || {},
      c24: sample.c24 || {}
    });
  }

  function renderCmdbStage() {
    var env = getEnvelope();
    var grid = document.getElementById('cmdb-summary-grid');
    var outArea = document.getElementById('cmdb-ire-output');
    clearNode(grid);

    if (outArea) {
      outArea.value = JSON.stringify(env.cmdbIreBatch, null, 2);
    }

    if (!grid) return;
    var items = env.cmdbIreBatch.items || [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var card = el('article', 'compare-card');
      card.appendChild(el('h3', '', item.values.name));
      card.appendChild(el('div', 'compare-meta', 'Class: ' + item.className));
      card.appendChild(el('div', 'cite-box', 'object_id: ' + item.values.object_id));
      grid.appendChild(card);
    }
  }

  function renderAssessStage() {
    var env = getEnvelope();
    var probGrid = document.getElementById('assess-problem-grid');
    var chgGrid = document.getElementById('assess-change-grid');
    clearNode(probGrid);
    clearNode(chgGrid);

    if (probGrid) {
      for (var i = 0; i < env.problems.length; i++) {
        var prob = env.problems[i];
        var card = el('article', 'compare-card');
        card.appendChild(el('h3', '', prob.checkId + ' (' + prob.action.toUpperCase() + ')'));
        card.appendChild(el('div', 'compare-meta', 'Severity: ' + prob.severity + ' | Target CI: ' + prob.affectedCiId));
        card.appendChild(el('p', '', prob.shortDescription));
        card.appendChild(el('div', 'cite-box', prob.correlationId));
        probGrid.appendChild(card);
      }
    }

    if (chgGrid) {
      for (var c = 0; c < env.changeRequests.length; c++) {
        var chg = env.changeRequests[c];
        var ccard = el('article', 'compare-card');
        ccard.appendChild(el('h3', '', chg.waveId + ' [' + chg.type + ' RFC]'));
        ccard.appendChild(el('div', 'compare-meta', 'Control Plane: ' + chg.controlPlane));
        ccard.appendChild(el('p', '', chg.shortDescription));
        ccard.appendChild(el('div', 'cite-box', chg.correlationId));
        chgGrid.appendChild(ccard);
      }
    }
  }

  function renderSwarmStage() {
    var numEl = document.getElementById('inc-number');
    var ciEl = document.getElementById('inc-ci');
    var shortEl = document.getElementById('inc-short');
    var descEl = document.getElementById('inc-desc');
    var grid = document.getElementById('swarm-intake-grid');
    clearNode(grid);
    if (!grid) return;

    var trigger = core.buildSwarmRunbookTrigger({
      number: numEl ? numEl.value : 'INC0041920',
      cmdb_ci: ciEl ? ciEl.value : 'vm-avd-p-1.contoso.com',
      short_description: shortEl ? shortEl.value : '',
      description: descEl ? descEl.value : ''
    });

    var card1 = el('article', 'compare-card');
    card1.appendChild(el('h3', '', 'Swarm Runbook Dispatch'));
    card1.appendChild(
      el(
        'div',
        'compare-meta',
        'threadStartedBy: ' + trigger.threadStartedBy + ' | runMode: ' + trigger.runMode
      )
    );
    card1.appendChild(el('p', '', 'Matched Runbook: ' + trigger.runbookId));
    card1.appendChild(
      el(
        'div',
        'cite-box',
        'V1-4 Write Refused Without Fresh C15 Facts: ' + String(trigger.v14WriteRefusedWithoutFreshFacts)
      )
    );
    grid.appendChild(card1);

    var card2 = el('article', 'compare-card');
    card2.appendChild(el('h3', '', 'Redaction & Prompt Shields (SN2)'));
    card2.appendChild(
      el(
        'div',
        'compare-meta',
        'Prompt Injection Suspected: ' +
          String(trigger.promptShield.suspected) +
          ' (' +
          trigger.promptShield.matchCount +
          ' hits)'
      )
    );
    card2.appendChild(el('p', '', trigger.redactedShortDescription));
    card2.appendChild(el('div', 'cite-box', trigger.redactedDescription));
    grid.appendChild(card2);
  }

  function renderRunStage() {
    var slugEl = document.getElementById('cmdb-slug');
    var modeEl = document.getElementById('run-mode');
    var shellInput = document.querySelector('input[name="run-shell"]:checked');
    var pre = document.getElementById('run-cmd-pre');
    if (pre) {
      pre.textContent = core.buildCommandBlock({
        shell: shellInput ? shellInput.value : 'pwsh',
        estateSlug: slugEl ? slugEl.value : 'contoso-prod',
        mode: modeEl ? modeEl.value : 'OfflineFixture'
      });
    }
  }

  function resetSampleEnvelope() {
    var env = getEnvelope();
    var valArea = document.getElementById('validate-json');
    if (valArea) {
      valArea.value = JSON.stringify(env, null, 2);
    }
    runValidation();
  }

  function runValidation() {
    var valArea = document.getElementById('validate-json');
    var statusEl = document.getElementById('validate-status');
    if (!valArea || !statusEl) return;
    try {
      var parsed = JSON.parse(valArea.value);
      var res = core.validateSyncEnvelope(parsed);
      if (res.valid) {
        statusEl.className = 'prior-banner gap';
        statusEl.textContent =
          'Valid C26 candidate envelope (avd-itsm-sync-envelope/v1): ' +
          parsed.cmdbIreBatch.items.length +
          ' CMDB items, ' +
          parsed.problems.length +
          ' Problems, ' +
          parsed.changeRequests.length +
          ' Change Requests.';
      } else {
        statusEl.className = 'errors gap';
        statusEl.textContent = 'Validation failed: ' + res.errors.join('; ');
      }
    } catch (err) {
      statusEl.className = 'errors gap';
      statusEl.textContent = 'JSON parse error: ' + err.message;
    }
  }

  function renderAll() {
    renderCmdbStage();
    renderAssessStage();
    renderSwarmStage();
    renderRunStage();
    resetSampleEnvelope();
  }

  function bindEvents() {
    var ids = ['cmdb-slug', 'cmdb-redaction', 'inc-number', 'inc-ci', 'inc-short', 'inc-desc', 'run-mode'];
    for (var i = 0; i < ids.length; i++) {
      var elem = document.getElementById(ids[i]);
      if (elem) {
        elem.addEventListener('input', renderAll);
        elem.addEventListener('change', renderAll);
      }
    }
    var radios = document.querySelectorAll('input[name="run-shell"]');
    for (var r = 0; r < radios.length; r++) {
      radios[r].addEventListener('change', renderRunStage);
    }
    var btnVal = document.getElementById('btn-validate');
    if (btnVal) btnVal.addEventListener('click', runValidation);
    var btnSample = document.getElementById('btn-load-sample');
    if (btnSample) btnSample.addEventListener('click', resetSampleEnvelope);
    var btnCopy = document.getElementById('copy-cmd');
    if (btnCopy) {
      btnCopy.addEventListener('click', function () {
        var pre = document.getElementById('run-cmd-pre');
        if (pre && navigator.clipboard) {
          navigator.clipboard.writeText(pre.textContent || '');
          btnCopy.textContent = 'Copied';
          setTimeout(function () {
            btnCopy.textContent = 'Copy';
          }, 1500);
        }
      });
    }
  }

  renderTabs();
  bindEvents();

  fetch('sample-data.json')
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      state.sample = data;
      renderAll();
    })
    .catch(function () {
      state.sample = {};
      renderAll();
    });
})();
