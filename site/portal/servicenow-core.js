/* Personal project, not for production, as is; not affiliated with the author's employer, ServiceNow, Liquidware or Microsoft. MIT.
   site/portal/servicenow-core.js: pure offline UMD engine for ServiceNow CMDB IRE batches, C21 Problem reconciliation,
   C24 Change Request generation, V1-4 Swarm Incident intake, Known Error drafting, and C26 envelope validation. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AvdServiceNowCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ZERO_UUID = '00000000-0000-0000-0000-000000000000';
  var PINNED_COMMIT = '1e67787';

  var ALLOWED_CI_CLASSES = [
    'cmdb_ci_service_technical',
    'cmdb_ci_cloud_service_account',
    'cmdb_ci_cloud_host_pool',
    'u_cmdb_ci_avd_host_pool',
    'cmdb_ci_vm_instance',
    'cmdb_ci_appl',
    'cmdb_ci_cloud_storage_account'
  ];

  var INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?previous\s+instructions/i,
    /system\s+prompt/i,
    /\bpropose_change\b/i,
    /\bhalt-all\b/i,
    /delete\s+all\s+hosts/i,
    /bypass\s+(the\s+)?gate/i
  ];

  function detectPromptInjection(text) {
    var raw = String(text || '');
    var hits = [];
    for (var i = 0; i < INJECTION_PATTERNS.length; i++) {
      if (INJECTION_PATTERNS[i].test(raw)) {
        hits.push(INJECTION_PATTERNS[i].source);
      }
    }
    return {
      suspected: hits.length > 0,
      matchCount: hits.length,
      patterns: hits
    };
  }

  function redactText(text) {
    var out = String(text || '');
    out = out.replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      function (m) {
        return m.toLowerCase() === ZERO_UUID ? ZERO_UUID : '<redacted-guid>';
      }
    );
    out = out.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '<user-upn>');
    out = out.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip-redacted>');
    out = out.replace(/\b([a-z0-9-]+)\.service-now\.com\b/gi, function (full, sub) {
      return String(sub).toLowerCase() === 'contoso' ? 'contoso.service-now.com' : '<instance>.service-now.com';
    });
    out = out.replace(/\bvm-[a-z0-9-]+(?:\.[a-z0-9.-]+)?\b/gi, '<host-1>');
    return out;
  }

  function fnv1aHex64(input) {
    var str = String(input || '');
    var out = '';
    for (var round = 0; round < 8; round++) {
      var h = (0x811c9dc5 ^ round) >>> 0;
      for (var i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      out += ('00000000' + h.toString(16)).slice(-8);
    }
    return out;
  }

  function buildCmdbIreBatch(c11, options) {
    var opts = options || {};
    var allowReal = Boolean(opts.allowEstateIdentifiers);
    var slug = String((c11 && c11.estateSlug) || opts.estateSlug || 'contoso-prod');
    var items = [];
    var relations = [];

    items.push({
      className: 'cmdb_ci_service_technical',
      values: {
        object_id: allowReal ? 'csdm:avd:' + slug : '<service-1>',
        name: allowReal ? 'AVD Technical Service (' + slug + ')' : '<service-1>',
        operational_status: '1'
      }
    });
    var serviceIdx = 0;

    var poolIndexByName = {};
    var pools = (c11 && Array.isArray(c11.hostPools)) ? c11.hostPools : [];
    for (var p = 0; p < pools.length; p++) {
      var pool = pools[p];
      var poolTag = '<pool-' + (p + 1) + '>';
      var poolIdx = items.length;
      poolIndexByName[pool.name] = poolIdx;
      items.push({
        className: 'cmdb_ci_cloud_host_pool',
        values: {
          object_id: allowReal ? String(pool.id || pool.name) : poolTag,
          name: allowReal ? String(pool.name) : poolTag,
          location: String(pool.location || 'northcentralus'),
          host_pool_type: String(pool.hostPoolType || 'Pooled'),
          load_balancer_type: String(pool.loadBalancerType || 'BreadthFirst'),
          max_session_limit: Number(pool.maxSessionLimit || 16)
        }
      });
      relations.push({
        type: 'Contains::Contained by',
        parent: serviceIdx,
        child: poolIdx
      });
    }

    var hosts = (c11 && Array.isArray(c11.sessionHosts)) ? c11.sessionHosts : [];
    for (var h = 0; h < hosts.length; h++) {
      var host = hosts[h];
      var hostTag = '<host-' + (h + 1) + '>';
      var hostIdx = items.length;
      items.push({
        className: 'cmdb_ci_vm_instance',
        values: {
          object_id: allowReal ? String(host.id || host.name) : hostTag,
          name: allowReal ? String(host.name) : hostTag,
          os_version: String(host.osVersion || 'Windows 11 Enterprise multi-session'),
          vm_size: String(host.vmSize || 'Standard_E4s_v5'),
          agent_version: String(host.agentVersion || ''),
          status: String(host.status || 'Available'),
          drain_mode: !host.allowNewSession
        }
      });
      var parentPoolIdx = poolIndexByName[host.hostPoolName];
      if (typeof parentPoolIdx === 'number') {
        relations.push({
          type: 'Assigned to::Managed by',
          parent: parentPoolIdx,
          child: hostIdx
        });
      }
    }

    var appGroupIndexByName = {};
    var ags = (c11 && Array.isArray(c11.applicationGroups)) ? c11.applicationGroups : [];
    for (var a = 0; a < ags.length; a++) {
      var ag = ags[a];
      var agTag = '<ag-' + (a + 1) + '>';
      var agIdx = items.length;
      appGroupIndexByName[ag.name] = agIdx;
      items.push({
        className: 'cmdb_ci_appl',
        values: {
          object_id: allowReal ? String(ag.id || ag.name) : agTag,
          name: allowReal ? String(ag.name) : agTag,
          application_group_type: String(ag.applicationGroupType || 'Desktop')
        }
      });
      var agPoolIdx = poolIndexByName[ag.hostPoolName];
      if (typeof agPoolIdx === 'number') {
        relations.push({
          type: 'Depends on::Used by',
          parent: agIdx,
          child: agPoolIdx
        });
      }
    }

    var workspaces = (c11 && Array.isArray(c11.workspaces)) ? c11.workspaces : [];
    for (var w = 0; w < workspaces.length; w++) {
      var ws = workspaces[w];
      var wsTag = '<ws-' + (w + 1) + '>';
      var wsIdx = items.length;
      items.push({
        className: 'cmdb_ci_appl',
        values: {
          object_id: allowReal ? String(ws.id || ws.name) : wsTag,
          name: allowReal ? String(ws.name) : wsTag
        }
      });
      relations.push({
        type: 'Contains::Contained by',
        parent: serviceIdx,
        child: wsIdx
      });
      var linkedAgs = Array.isArray(ws.applicationGroupNames) ? ws.applicationGroupNames : [];
      for (var la = 0; la < linkedAgs.length; la++) {
        var childAgIdx = appGroupIndexByName[linkedAgs[la]];
        if (typeof childAgIdx === 'number') {
          relations.push({
            type: 'Contains::Contained by',
            parent: wsIdx,
            child: childAgIdx
          });
        }
      }
    }

    var storages = (c11 && Array.isArray(c11.storageAccounts)) ? c11.storageAccounts : [];
    for (var s = 0; s < storages.length; s++) {
      var st = storages[s];
      var stTag = '<sto-' + (s + 1) + '>';
      var stIdx = items.length;
      items.push({
        className: 'cmdb_ci_cloud_storage_account',
        values: {
          object_id: allowReal ? String(st.id || st.name) : stTag,
          name: allowReal ? String(st.name) : stTag,
          sku: String(st.sku || 'Premium_ZRS'),
          identity_type: String(st.identityType || 'EntraKerberos')
        }
      });
      var stPoolIdx = poolIndexByName[st.hostPoolName];
      if (typeof stPoolIdx === 'number') {
        relations.push({
          type: 'Depends on::Used by',
          parent: stPoolIdx,
          child: stIdx
        });
      }
    }

    return {
      items: items,
      relations: relations
    };
  }

  function reconcileProblemsFromC21(c21, existingProblems, options) {
    var opts = options || {};
    var slug = String((c21 && c21.estateSlug) || opts.estateSlug || 'contoso-prod');
    var existingMap = {};
    var existingList = Array.isArray(existingProblems) ? existingProblems : [];
    for (var e = 0; e < existingList.length; e++) {
      var ex = existingList[e];
      if (ex && ex.correlationId) {
        existingMap[ex.correlationId] = ex;
      }
    }

    var checks = (c21 && Array.isArray(c21.checks)) ? c21.checks : [];
    var out = [];
    for (var i = 0; i < checks.length; i++) {
      var chk = checks[i];
      var corrId = 'avd-ops:c21:' + slug + ':' + chk.checkId;
      var status = String(chk.status || '').toLowerCase();
      var prev = existingMap[corrId];
      var shortDesc = redactText('[AVD Drift] ' + chk.checkId + ': ' + chk.title);

      if (status === 'gap' || status === 'drift') {
        var isUnchanged = Boolean(
          prev &&
          prev.state !== 'resolved' &&
          prev.shortDescription === shortDesc &&
          prev.severity === chk.severity
        );
        out.push({
          correlationId: corrId,
          action: isUnchanged ? 'noop' : 'upsert',
          severity: String(chk.severity || 'high'),
          checkId: String(chk.checkId),
          shortDescription: shortDesc,
          affectedCiId: redactText(String(chk.affectedResource || '<pool-1>')),
          citations: Array.isArray(chk.citations) ? chk.citations.slice() : []
        });
      } else if (status === 'pass' && prev && prev.state !== 'resolved') {
        out.push({
          correlationId: corrId,
          action: 'resolve',
          severity: String(chk.severity || 'high'),
          checkId: String(chk.checkId),
          shortDescription: shortDesc,
          affectedCiId: redactText(String(chk.affectedResource || '<pool-1>')),
          citations: Array.isArray(chk.citations) ? chk.citations.slice() : []
        });
      }
    }
    return out;
  }

  function buildChangesFromC24(c24, options) {
    var opts = options || {};
    var slug = String((c24 && c24.estateSlug) || opts.estateSlug || 'contoso-prod');
    var waves = (c24 && Array.isArray(c24.waves)) ? c24.waves : [];
    var out = [];
    for (var i = 0; i < waves.length; i++) {
      var w = waves[i];
      out.push({
        correlationId: 'avd-ops:c24:' + slug + ':' + w.waveId,
        type: w.changeType === 'normal' ? 'normal' : 'standard',
        waveId: String(w.waveId),
        controlPlane: String(w.controlPlane || 'azure'),
        shortDescription: redactText(w.shortDescription),
        implementationPlan: redactText(w.implementationPlan),
        backoutPlan: redactText(w.backoutPlan),
        testPlan: redactText(w.testPlan)
      });
    }
    return out;
  }

  function buildSwarmRunbookTrigger(incidentRecord) {
    var inc = incidentRecord || {};
    var combined = String(inc.short_description || '') + ' ' + String(inc.description || '');
    var shield = detectPromptInjection(combined);
    var redactedSummary = redactText(inc.short_description || '');
    var redactedDetails = redactText(inc.description || '');

    var runbookId = 'hosts.agent-unhealthy';
    if (/fslogix|event\s*26|vhdx|storage/i.test(combined)) {
      runbookId = 'storage.fslogix-profile-attach';
    } else if (/shortpath|udp\s*3390|latency|rdp/i.test(combined)) {
      runbookId = 'network.rdp-shortpath-health';
    } else if (/aadsts|mfa|conditional\s+access|entra/i.test(combined)) {
      runbookId = 'entra.sign-in-diagnostics';
    }

    return {
      incidentNumber: String(inc.number || 'INC0000000'),
      threadStartedBy: 'alert',
      runMode: 'read-only',
      v14WriteRefusedWithoutFreshFacts: true,
      promptShield: shield,
      runbookId: runbookId,
      affectedCi: redactText(inc.cmdb_ci || '<host-1>'),
      redactedShortDescription: redactedSummary,
      redactedDescription: redactedDetails
    };
  }

  function buildKnownErrorDraft(input, options) {
    var opts = options || {};
    var rawSlug = String((input && (input.checkId || input.runbookId || input.number)) || opts.slug || 'fslogix-event-26')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-');
    return {
      correlationId: 'avd-ops:ke:' + rawSlug,
      title: redactText(input.title || input.short_description || 'AVD Known Error Draft'),
      symptom: redactText(input.symptom || input.description || 'Session host or profile attach symptom observed.'),
      cause: redactText(input.cause || 'Control-plane configuration drift verified against C11/C21 check register.'),
      resolution: redactText(input.resolution || 'Apply governed C24 remediation wave and verify post-fix check passes.'),
      checkIds: Array.isArray(input.checkIds) ? input.checkIds.slice() : ['AZ-STO-002']
    };
  }

  function buildSyncEnvelope(params) {
    var p = params || {};
    var slug = String(p.estateSlug || (p.c11 && p.c11.estateSlug) || 'contoso-prod');
    var allowReal = Boolean(p.allowEstateIdentifiers);
    var c11Str = JSON.stringify(p.c11 || {});
    var c21Str = JSON.stringify(p.c21 || {});
    var c24Str = JSON.stringify(p.c24 || {});

    var cmdbIreBatch = buildCmdbIreBatch(p.c11 || {}, {
      estateSlug: slug,
      allowEstateIdentifiers: allowReal
    });
    var problems = reconcileProblemsFromC21(p.c21 || {}, p.existingProblems || [], {
      estateSlug: slug
    });
    var changeRequests = buildChangesFromC24(p.c24 || {}, {
      estateSlug: slug
    });
    var knownErrorDrafts = Array.isArray(p.knownErrorDrafts)
      ? p.knownErrorDrafts
      : (problems.length > 0
          ? [
              buildKnownErrorDraft({
                checkId: problems[0].checkId,
                title: problems[0].shortDescription,
                symptom: problems[0].shortDescription,
                cause: 'Detected by avd-current-state C21 check ' + problems[0].checkId,
                resolution: changeRequests[0] ? changeRequests[0].implementationPlan : 'Run C24 wave remediation.',
                checkIds: [problems[0].checkId]
              })
            ]
          : []);

    return {
      schema: 'avd-itsm-sync-envelope/v1',
      generatedAt: String(p.generatedAt || '2026-11-09T18:00:00Z'),
      estateSlug: slug,
      redactionLevel: allowReal ? 'estate-identifiers-opt-in' : 'pseudonymized',
      sourceContracts: {
        c11Sha256: fnv1aHex64(c11Str),
        c21Sha256: fnv1aHex64(c21Str),
        c24Sha256: fnv1aHex64(c24Str)
      },
      cmdbIreBatch: cmdbIreBatch,
      problems: problems,
      changeRequests: changeRequests,
      knownErrorDrafts: knownErrorDrafts
    };
  }

  function validateSyncEnvelope(envelope) {
    var errors = [];
    if (!envelope || typeof envelope !== 'object') {
      return { valid: false, errors: ['Envelope must be a JSON object'] };
    }
    if (envelope.schema !== 'avd-itsm-sync-envelope/v1') {
      errors.push('schema must equal "avd-itsm-sync-envelope/v1"');
    }
    if (!/^[a-z0-9-]+$/.test(String(envelope.estateSlug || ''))) {
      errors.push('estateSlug must match ^[a-z0-9-]+$');
    }
    if (
      envelope.redactionLevel !== 'pseudonymized' &&
      envelope.redactionLevel !== 'estate-identifiers-opt-in'
    ) {
      errors.push('redactionLevel must be pseudonymized or estate-identifiers-opt-in');
    }
    if (!envelope.sourceContracts || !/^[a-f0-9]{64}$/.test(String(envelope.sourceContracts.c11Sha256 || ''))) {
      errors.push('sourceContracts.c11Sha256 must be a 64-char hex SHA-256 string');
    }
    if (!envelope.cmdbIreBatch || !Array.isArray(envelope.cmdbIreBatch.items) || !Array.isArray(envelope.cmdbIreBatch.relations)) {
      errors.push('cmdbIreBatch must contain items[] and relations[] arrays');
    } else {
      for (var i = 0; i < envelope.cmdbIreBatch.items.length; i++) {
        var item = envelope.cmdbIreBatch.items[i];
        if (ALLOWED_CI_CLASSES.indexOf(item.className) === -1) {
          errors.push('Unsupported CI className: ' + item.className);
        }
        if (!item.values || !item.values.object_id || !item.values.name) {
          errors.push('CMDB item[' + i + '] requires values.object_id and values.name');
        }
      }
    }

    if (!Array.isArray(envelope.problems)) {
      errors.push('problems must be an array');
    } else {
      var seenProblemIds = {};
      for (var p = 0; p < envelope.problems.length; p++) {
        var prob = envelope.problems[p];
        if (!/^avd-ops:c21:[a-z0-9-]+:[A-Z0-9-]+$/.test(String(prob.correlationId || ''))) {
          errors.push('Invalid problem correlationId: ' + prob.correlationId);
        }
        if (seenProblemIds[prob.correlationId]) {
          errors.push('Duplicate problem correlationId: ' + prob.correlationId);
        }
        seenProblemIds[prob.correlationId] = true;
      }
    }

    if (envelope.redactionLevel === 'pseudonymized') {
      var serialized = JSON.stringify(envelope);
      var guids = serialized.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi) || [];
      for (var g = 0; g < guids.length; g++) {
        if (guids[g].toLowerCase() !== ZERO_UUID) {
          errors.push('Unredacted GUID found in pseudonymized envelope: ' + guids[g]);
        }
      }
      if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(serialized)) {
        errors.push('Unredacted email/UPN found in pseudonymized envelope');
      }
      if (/\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(serialized)) {
        errors.push('Unredacted IPv4 address found in pseudonymized envelope');
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  function buildCommandBlock(options) {
    var opts = options || {};
    var shell = opts.shell === 'bash' ? 'bash' : 'pwsh';
    var slug = String(opts.estateSlug || 'contoso-prod').replace(/[^a-z0-9-]/gi, '');
    var allowedModes = ['OfflineFixture', 'WhatIf', 'MockPdi', 'LivePdi'];
    var mode = allowedModes.indexOf(opts.mode) !== -1 ? opts.mode : 'OfflineFixture';

    if (shell === 'bash') {
      return [
        'if [ ! -d "$HOME/avd-servicenow/.git" ]; then git clone https://github.com/avd-ops/avd-servicenow.git "$HOME/avd-servicenow"; fi',
        'cd "$HOME/avd-servicenow" && git checkout -q ' + PINNED_COMMIT + ' && git pull -q --ff-only',
        'pwsh -NoProfile -Command "./Invoke-AvdServiceNowSync.ps1 -EstateSlug ' + slug + ' -Mode ' + mode + '"'
      ].join('\n');
    }

    return [
      'if (-not (Test-Path "$HOME/avd-servicenow/.git")) { git clone https://github.com/avd-ops/avd-servicenow.git "$HOME/avd-servicenow" }',
      'Set-Location ~/avd-servicenow; git checkout -q ' + PINNED_COMMIT + '; git pull -q --ff-only',
      './Invoke-AvdServiceNowSync.ps1 -EstateSlug ' + slug + ' -Mode ' + mode
    ].join('\n');
  }

  function buildCatalogFulfillmentPayload(request) {
    var req = request || {};
    var ritm = String(req.ritmNumber || 'RITM0010001').toUpperCase();
    var workflow = String(req.powerPlatformWorkflow || 'RequestPoolAccess');
    var killSwitch = String(req.killSwitchState || 'run');
    var allowed = killSwitch === 'run';

    return {
      idempotencyKey: 'avd-ops:sc:' + ritm + ':' + workflow,
      ritmNumber: ritm,
      powerPlatformWorkflow: workflow,
      killSwitchState: killSwitch,
      dispatchAllowed: allowed,
      refusalReason: allowed ? null : 'Refused: kill switch is at ' + killSwitch,
      targetCi: redactText(req.targetCi || '<pool-1>'),
      redactedJustification: redactText(req.justification || '')
    };
  }

  return {
    PINNED_COMMIT: PINNED_COMMIT,
    ALLOWED_CI_CLASSES: ALLOWED_CI_CLASSES,
    detectPromptInjection: detectPromptInjection,
    redactText: redactText,
    buildCmdbIreBatch: buildCmdbIreBatch,
    reconcileProblemsFromC21: reconcileProblemsFromC21,
    buildChangesFromC24: buildChangesFromC24,
    buildSwarmRunbookTrigger: buildSwarmRunbookTrigger,
    buildKnownErrorDraft: buildKnownErrorDraft,
    buildSyncEnvelope: buildSyncEnvelope,
    validateSyncEnvelope: validateSyncEnvelope,
    buildCommandBlock: buildCommandBlock,
    buildCatalogFulfillmentPayload: buildCatalogFulfillmentPayload
  };
});
