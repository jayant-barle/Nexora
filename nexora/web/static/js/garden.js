/* NEXORA — Photo Garden Controller (Phase 5)
 * Integrates Garden Overview, paginated top-level Photo Gallery, user-initiated Scan People,
 * People Group Cards, Naming/Splitting/Merging with explicit confirmation dialogs,
 * Suggested Merges, and Unreadable / Withheld / No-Face reports.
 */
(function (global) {
  "use strict";

  var GALLERY_PAGE_SIZE = 48;

  var state = {
    activeTab: "people",
    peopleQuery: "",
    peopleSort: "Largest first",
    galleryQuery: "",
    galleryFilter: "all",
    galleryPage: 1,
    pollTimer: null,
    peopleTimer: null,
    galleryTimer: null,
    modalAction: null,
    lastOverview: null,
    lastCards: []
  };

  function el(id) {
    return document.getElementById(id);
  }

  function clearChildren(node) {
    if (node) node.innerHTML = "";
  }

  /* ------------------------------------------------------------------
   * Storybook Confirmation Modal (Explicit Approval for Name/Split/Merge)
   * ------------------------------------------------------------------ */

  function closeModal() {
    var backdrop = el("garden-confirm-modal");
    if (backdrop) backdrop.hidden = true;
    state.modalAction = null;
  }

  function openConfirmationModal(opts) {
    var backdrop = el("garden-confirm-modal");
    var titleEl = el("garden-modal-title");
    var bodyEl = el("garden-modal-body");
    var warnEl = el("garden-modal-warning");
    var confirmBtn = el("garden-modal-confirm");
    if (!backdrop || !titleEl || !bodyEl || !warnEl || !confirmBtn) return;

    titleEl.textContent = opts.title || "Confirm Action";
    bodyEl.textContent = opts.body || "";

    if (opts.warning) {
      warnEl.hidden = false;
      warnEl.textContent = opts.warning;
    } else {
      warnEl.hidden = true;
      warnEl.textContent = "";
    }

    confirmBtn.textContent = opts.confirmLabel || "Confirm";
    confirmBtn.disabled = false;
    state.modalAction = opts.onConfirm || null;
    backdrop.hidden = false;
    confirmBtn.focus();
  }

  /* ------------------------------------------------------------------
   * Sub-tabs within Photo Garden
   * ------------------------------------------------------------------ */

  function switchSubTab(tabName) {
    if (["people", "gallery", "reports"].indexOf(tabName) === -1) tabName = "people";
    state.activeTab = tabName;

    document.querySelectorAll(".nx-garden-tab[data-garden-tab]").forEach(function (btn) {
      var active = btn.dataset.gardenTab === tabName;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });

    ["people", "gallery", "reports"].forEach(function (name) {
      var panel = el("garden-tab-" + name);
      if (panel) panel.hidden = name !== tabName;
    });

    if (tabName === "gallery") {
      refreshGallery(false);
    }
  }

  /* ------------------------------------------------------------------
   * A. Overview & Provenance & Scan Controls
   * ------------------------------------------------------------------ */

  function renderOverview(data) {
    var ov = (data && data.overview) || {};
    state.lastOverview = ov;

    var pill = el("garden-provenance-pill");
    if (pill) {
      pill.textContent = ov.cache_source_label || "No face cache recorded yet";
      pill.classList.remove("is-fresh", "is-empty");
      if (ov.data_origin === "fresh_scan") pill.classList.add("is-fresh");
      else if (ov.data_origin === "empty") pill.classList.add("is-empty");
    }

    if (el("garden-kpi-indexed")) el("garden-kpi-indexed").textContent = String(ov.total_cached_images || 0);
    if (el("garden-kpi-faces")) el("garden-kpi-faces").textContent = String(ov.images_with_faces || 0);
    if (el("garden-kpi-groups")) el("garden-kpi-groups").textContent = String(ov.visible_people || 0);
    if (el("garden-kpi-named")) el("garden-kpi-named").textContent = String(ov.named_people || 0);
    if (el("garden-kpi-unnamed")) {
      var unnamedText = String(ov.unnamed_awaiting_review || 0);
      if (ov.needs_review_groups > 0) unnamedText += " (" + ov.needs_review_groups + " rev)";
      el("garden-kpi-unnamed").textContent = unnamedText;
    }
    if (el("garden-kpi-unreadable")) {
      var unreadStr = String(ov.unreadable_count || 0);
      if (typeof ov.unsupported_source_count === "number") {
        unreadStr += " / " + ov.unsupported_source_count + " other";
      }
      el("garden-kpi-unreadable").textContent = unreadStr;
    }
  }

  function updateScanControlsUI(job) {
    var startBtn = el("garden-scan-start-btn");
    var stopBtn = el("garden-scan-stop-btn");
    var statusEl = el("garden-scan-status-text");
    var fillEl = el("garden-scan-progress-fill");
    var isRunning = Boolean(job && job.running);
    var isScan = Boolean(job && job.kind === "scan");

    if (startBtn) {
      startBtn.disabled = isRunning;
      startBtn.textContent = isRunning ? "Scan Running..." : "Scan People";
    }
    if (stopBtn) {
      stopBtn.hidden = !(isRunning && isScan);
      stopBtn.disabled = !isRunning;
    }
    if (statusEl && job) {
      if (isScan && isRunning) {
        statusEl.textContent = (job.status_text || "Scanning...") + " (" + (job.faces || 0) + " faces)";
      } else if (job.error && isScan) {
        statusEl.textContent = "Scan error: " + job.error;
      } else if (isScan && !isRunning && job.last_result) {
        statusEl.textContent = job.status_text || "Scan completed.";
      } else if (!isRunning) {
        statusEl.textContent = job.status_text || "Ready — click Scan People when you want to detect faces.";
      }
    }
    if (fillEl && job) {
      var pct = isScan ? Number(job.percent || 0) : (isRunning ? 0 : (job.last_result ? 100 : 0));
      fillEl.style.width = Math.max(0, Math.min(100, pct)) + "%";
    }
  }

  function stopPollingScan() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function pollScanStatusOnce() {
    return global.NexoraApi.call("get_job_status").then(function (job) {
      updateScanControlsUI(job);
      if (global.NexoraRouter) global.NexoraRouter.refreshAppState();

      if (!job.running) {
        stopPollingScan();
        refreshPeopleAndReports();
        if (state.activeTab === "gallery") refreshGallery(true);
        if (job.kind === "scan" && job.error) {
          if (global.NexoraFairy) global.NexoraFairy.say("Scan stopped with error: " + job.error, "error");
        } else if (job.kind === "scan" && job.last_result) {
          if (global.NexoraFairy) global.NexoraFairy.say(job.status_text || "Scan complete!", "celebrate");
        }
      }
      return job;
    });
  }

  function startScanPolling() {
    if (state.pollTimer) return;
    state.pollTimer = setInterval(pollScanStatusOnce, 600);
  }

  function handleStartScan() {
    var startBtn = el("garden-scan-start-btn");
    if (startBtn && startBtn.disabled) return;
    if (startBtn) startBtn.disabled = true;

    global.NexoraApi.call("start_scan").then(function (res) {
      if (!res || !res.ok) {
        if (startBtn) startBtn.disabled = false;
        var errMsg = (res && res.error) || "Unable to start scan.";
        if (el("garden-scan-status-text")) el("garden-scan-status-text").textContent = errMsg;
        if (global.NexoraFairy) global.NexoraFairy.say(errMsg, "error");
        return;
      }
      if (global.NexoraFairy) {
        global.NexoraFairy.say("Scanning top-level photos and videos for people...", "working");
      }
      pollScanStatusOnce();
      startScanPolling();
    }).catch(function (err) {
      if (startBtn) startBtn.disabled = false;
      var msg = err && err.message ? err.message : "Failed to start scan.";
      if (el("garden-scan-status-text")) el("garden-scan-status-text").textContent = msg;
    });
  }

  function handleStopScan() {
    var stopBtn = el("garden-scan-stop-btn");
    if (stopBtn) stopBtn.disabled = true;
    global.NexoraApi.call("stop_scan").then(function (res) {
      if (el("garden-scan-status-text")) {
        el("garden-scan-status-text").textContent = res && res.ok
          ? "Stopping scan cleanly after current batch..."
          : ((res && res.error) || "No active scan to stop.");
      }
    });
  }

  /* ------------------------------------------------------------------
   * C. Suggested Merges Banner (Inspected / Dismissed, Never Auto-Applied)
   * ------------------------------------------------------------------ */

  function renderSuggestions(data) {
    var listEl = el("garden-suggestions-list");
    var countEl = el("garden-suggestions-count");
    if (!listEl || !countEl) return;

    var suggestions = (data && data.suggestions) || [];
    var total = (data && data.total_suggestions) || suggestions.length;
    countEl.textContent = total > suggestions.length
      ? suggestions.length + " shown (capped from " + total + ")"
      : String(suggestions.length) + " suggestion(s)";

    clearChildren(listEl);
    if (suggestions.length === 0) {
      var none = document.createElement("p");
      none.className = "nx-muted";
      none.style.margin = "0";
      none.textContent = "No suggested merges.";
      listEl.appendChild(none);
      return;
    }

    suggestions.forEach(function (sug) {
      var card = document.createElement("div");
      card.className = "nx-suggest-card";

      var pairWrap = document.createElement("div");
      pairWrap.className = "nx-suggest-pair";

      function buildSide(name, photos, cropUrl) {
        var side = document.createElement("div");
        side.className = "nx-suggest-side";
        if (cropUrl) {
          var img = document.createElement("img");
          img.className = "nx-crop-thumb";
          img.src = cropUrl;
          img.alt = name;
          img.loading = "lazy";
          side.appendChild(img);
        } else {
          var ph = document.createElement("span");
          ph.className = "nx-crop-placeholder";
          ph.textContent = "🙂";
          side.appendChild(ph);
        }
        var txt = document.createElement("div");
        var strong = document.createElement("strong");
        strong.textContent = name;
        var sub = document.createElement("div");
        sub.className = "nx-muted";
        sub.textContent = photos + " photo(s)";
        txt.appendChild(strong);
        txt.appendChild(sub);
        side.appendChild(txt);
        return side;
      }

      pairWrap.appendChild(buildSide(sug.group_a_name, sug.group_a_photos, sug.group_a_crop_url));
      var vsBadge = document.createElement("span");
      vsBadge.className = "nx-pill-badge";
      vsBadge.textContent = "sim " + sug.similarity;
      pairWrap.appendChild(vsBadge);
      pairWrap.appendChild(buildSide(sug.group_b_name, sug.group_b_photos, sug.group_b_crop_url));

      var actions = document.createElement("div");
      actions.className = "nx-action-inline";

      var mergeBtn = document.createElement("button");
      mergeBtn.type = "button";
      mergeBtn.className = "nx-btn nx-btn-primary";
      mergeBtn.textContent = "Merge Pair…";
      mergeBtn.addEventListener("click", function () {
        requestMergeWithGuard(sug.group_a_id, sug.group_b_id);
      });

      var dismissBtn = document.createElement("button");
      dismissBtn.type = "button";
      dismissBtn.className = "nx-btn";
      dismissBtn.textContent = "Not the Same Person";
      dismissBtn.addEventListener("click", function () {
        global.NexoraApi.call("dismiss_suggested_merge", sug.group_a_id, sug.group_b_id)
          .then(function (res) {
            if (!res || !res.ok) {
              if (global.NexoraFairy) global.NexoraFairy.say((res && res.error) || "Dismiss failed.", "error");
              return;
            }
            if (global.NexoraFairy) global.NexoraFairy.say("Suggestion dismissed and remembered.", "idle");
            refreshPeopleAndReports();
          });
      });

      actions.appendChild(mergeBtn);
      actions.appendChild(dismissBtn);
      card.appendChild(pairWrap);
      card.appendChild(actions);
      listEl.appendChild(card);
    });
  }

  /* ------------------------------------------------------------------
   * D. Guarded Identity Actions (Naming, Splitting, Merging)
   * ------------------------------------------------------------------ */

  function requestNameGroup(cardData, rawInputName) {
    var trimmed = (rawInputName || "").trim();
    if (!trimmed) {
      if (global.NexoraFairy) global.NexoraFairy.say("Enter a person's name before saving.", "error");
      return;
    }
    var currentLabel = cardData.assigned_name
      ? ("Current confirmed name: \"" + cardData.assigned_name + "\" (folder: " + cardData.folder_name + "/)")
      : ("Currently detected group: \"" + cardData.display_name + "\" (withheld until named)");

    openConfirmationModal({
      title: "Confirm Person Name",
      body: currentLabel + ". Assign name \"" + trimmed + "\" to " + cardData.id + " (" + cardData.face_count + " face(s) across " + cardData.total_files + " file(s))?",
      warning: cardData.needs_review
        ? "This group exceeded the large-cluster review cap. Confirm that all faces belong to this person before enabling placement."
        : "",
      confirmLabel: "Confirm & Save Name",
      onConfirm: function () {
        global.NexoraApi.call("name_group", cardData.id, trimmed).then(function (res) {
          closeModal();
          if (!res || !res.ok) {
            if (global.NexoraFairy) global.NexoraFairy.say((res && res.error) || "Invalid name.", "error");
            return;
          }
          if (global.NexoraFairy) {
            global.NexoraFairy.say("Saved confirmed identity \"" + res.saved_name + "\"!", "celebrate");
          }
          refreshPeopleAndReports();
          if (state.activeTab === "gallery") refreshGallery(true);
        });
      }
    });
  }

  function requestSplitGroup(cardData) {
    openConfirmationModal({
      title: "Confirm Group Split",
      body: "Split \"" + cardData.display_name + "\" (" + cardData.id + ", " + cardData.face_count + " face(s)) into two separate groups using face similarity? Any split-out faces lose their current assigned name until you review them.",
      confirmLabel: "Confirm Split",
      onConfirm: function () {
        global.NexoraApi.call("split_group", cardData.id).then(function (res) {
          closeModal();
          if (!res || !res.ok) {
            if (global.NexoraFairy) global.NexoraFairy.say((res && res.error) || "Could not split group.", "error");
            return;
          }
          if (global.NexoraFairy) {
            global.NexoraFairy.say("Split into " + res.original_id + " and " + res.new_id + ".", "curious");
          }
          refreshPeopleAndReports();
        });
      }
    });
  }

  function requestMergeWithGuard(targetGroupId, sourceGroupId) {
    if (!targetGroupId || !sourceGroupId) return;
    global.NexoraApi.call("check_merge_guard", targetGroupId, sourceGroupId).then(function (guard) {
      if (!guard || !guard.ok) {
        if (global.NexoraFairy) global.NexoraFairy.say((guard && guard.error) || "Cannot merge these groups.", "error");
        return;
      }

      var warningText = guard.needs_confirmation
        ? guard.message + " " + (guard.risk_note || "")
        : "";

      openConfirmationModal({
        title: guard.needs_confirmation ? "Small-Cluster Merge Warning" : "Confirm Manual Merge",
        body: "Merge \"" + guard.source_name + "\" (" + guard.source_size + " face(s), " + sourceGroupId + ") into \"" + guard.target_name + "\" (" + guard.target_size + " face(s), " + targetGroupId + ")?",
        warning: warningText,
        confirmLabel: guard.needs_confirmation ? "Yes, Merge Anyway" : "Confirm Merge",
        onConfirm: function () {
          global.NexoraApi.call("merge_groups", targetGroupId, sourceGroupId, Boolean(guard.needs_confirmation))
            .then(function (res) {
              closeModal();
              if (!res || !res.ok) {
                if (global.NexoraFairy) global.NexoraFairy.say((res && res.error) || "Merge aborted.", "error");
                return;
              }
              if (global.NexoraFairy) {
                global.NexoraFairy.say("Merged groups into " + guard.target_name + ".", "celebrate");
              }
              refreshPeopleAndReports();
            });
        }
      });
    });
  }

  function renderPeopleCards(data) {
    var grid = el("garden-people-grid");
    var emptyEl = el("garden-people-empty");
    var errEl = el("garden-people-error");
    var loadingEl = el("garden-people-loading");
    var countNote = el("garden-people-count-note");
    if (!grid) return;

    if (loadingEl) loadingEl.hidden = true;
    if (errEl) errEl.hidden = true;

    var cards = (data && data.cards) || [];
    state.lastCards = cards;
    var allById = {};
    cards.forEach(function (c) { allById[c.id] = c; });

    if (countNote) {
      countNote.textContent = cards.length + " of " + ((data && data.total_visible) || cards.length) + " visible group(s)";
    }

    clearChildren(grid);
    if (cards.length === 0) {
      grid.hidden = true;
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.textContent = state.peopleQuery.trim()
          ? "No people match '" + state.peopleQuery.trim() + "'."
          : "No visible people groups (>= 2 faces) discovered yet. Select a source folder and click Scan People when ready.";
      }
      return;
    }

    if (emptyEl) emptyEl.hidden = true;
    grid.hidden = false;

    cards.forEach(function (card) {
      var cardEl = document.createElement("article");
      cardEl.className = "nx-person-card";
      if (card.identity_status === "confirmed") cardEl.classList.add("is-confirmed");
      else if (card.needs_review) cardEl.classList.add("is-review");

      var head = document.createElement("div");
      head.className = "nx-person-head";

      var titleWrap = document.createElement("div");
      var h4 = document.createElement("strong");
      h4.style.fontSize = "15px";
      h4.textContent = card.display_name;
      var meta = document.createElement("div");
      meta.className = "nx-muted";
      meta.textContent = card.id + " · " + card.face_count + " face(s) · " + card.total_files + " image(s)";
      titleWrap.appendChild(h4);
      titleWrap.appendChild(meta);

      var statusBadge = document.createElement("span");
      statusBadge.className = "nx-pill-badge";
      if (card.identity_status === "confirmed") {
        statusBadge.classList.add("is-good");
        statusBadge.textContent = "Confirmed Identity";
      } else if (card.needs_review) {
        statusBadge.classList.add("is-warn");
        statusBadge.textContent = "Needs Review";
      } else {
        statusBadge.textContent = "Detected Group";
      }

      head.appendChild(titleWrap);
      head.appendChild(statusBadge);
      cardEl.appendChild(head);

      var placementLine = document.createElement("div");
      placementLine.className = "nx-muted";
      placementLine.textContent = card.placement_status;
      cardEl.appendChild(placementLine);

      var cropsWrap = document.createElement("div");
      cropsWrap.className = "nx-person-crops";
      if (card.crop_urls && card.crop_urls.length > 0) {
        card.crop_urls.forEach(function (url) {
          var img = document.createElement("img");
          img.className = "nx-crop-thumb";
          img.src = url;
          img.alt = card.display_name + " face sample";
          img.loading = "lazy";
          cropsWrap.appendChild(img);
        });
      } else {
        var ph = document.createElement("span");
        ph.className = "nx-muted";
        ph.textContent = "No cropped face thumbnails saved.";
        cropsWrap.appendChild(ph);
      }
      cardEl.appendChild(cropsWrap);

      var actionsWrap = document.createElement("div");
      actionsWrap.className = "nx-person-actions";

      // Naming form -> Always goes through Confirmation Modal!
      var nameRow = document.createElement("div");
      nameRow.className = "nx-action-inline";
      var nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "nx-input";
      nameInput.style.flex = "1 1 130px";
      nameInput.placeholder = card.assigned_name ? "Rename " + card.assigned_name + "..." : "Assign person name...";
      nameInput.value = card.assigned_name || "";
      nameInput.setAttribute("aria-label", "Name for " + card.display_name);

      var nameBtn = document.createElement("button");
      nameBtn.type = "button";
      nameBtn.className = "nx-btn nx-btn-primary";
      nameBtn.textContent = "Name…";
      nameBtn.addEventListener("click", function () {
        requestNameGroup(card, nameInput.value);
      });
      nameRow.appendChild(nameInput);
      nameRow.appendChild(nameBtn);
      actionsWrap.appendChild(nameRow);

      // Split & Manual Merge row
      var toolRow = document.createElement("div");
      toolRow.className = "nx-action-inline";

      var splitBtn = document.createElement("button");
      splitBtn.type = "button";
      splitBtn.className = "nx-btn";
      splitBtn.textContent = "Split…";
      splitBtn.disabled = card.face_count < 2;
      splitBtn.addEventListener("click", function () {
        requestSplitGroup(card);
      });
      toolRow.appendChild(splitBtn);

      if (card.merge_targets && card.merge_targets.length > 0) {
        var selectEl = document.createElement("select");
        selectEl.className = "nx-select";
        selectEl.setAttribute("aria-label", "Merge " + card.display_name + " into group");
        card.merge_targets.forEach(function (targetId) {
          var opt = document.createElement("option");
          opt.value = targetId;
          var targetCard = allById[targetId];
          opt.textContent = targetCard ? targetCard.display_name + " (" + targetId + ")" : targetId;
          selectEl.appendChild(opt);
        });

        var mergeBtn = document.createElement("button");
        mergeBtn.type = "button";
        mergeBtn.className = "nx-btn nx-btn-lavender";
        mergeBtn.textContent = "Merge Into…";
        mergeBtn.addEventListener("click", function () {
          requestMergeWithGuard(selectEl.value, card.id);
        });
        toolRow.appendChild(selectEl);
        toolRow.appendChild(mergeBtn);
      }

      actionsWrap.appendChild(toolRow);
      cardEl.appendChild(actionsWrap);
      grid.appendChild(cardEl);
    });
  }

  /* ------------------------------------------------------------------
   * E. Separate Reports: Unreadable, Withheld, No-Face Images
   * ------------------------------------------------------------------ */

  function renderChips(containerId, items, emptyText) {
    var wrap = el(containerId);
    if (!wrap) return;
    clearChildren(wrap);
    if (!items || items.length === 0) {
      var none = document.createElement("span");
      none.className = "nx-muted";
      none.textContent = emptyText;
      wrap.appendChild(none);
      return;
    }
    items.forEach(function (name) {
      var chip = document.createElement("span");
      chip.className = "nx-file-chip";
      chip.textContent = name;
      wrap.appendChild(chip);
    });
  }

  function renderReports(data) {
    var withheld = (data && data.withheld) || {};
    var unreadItems = (data && data.unreadable_items) || [];

    if (el("garden-unreadable-count")) el("garden-unreadable-count").textContent = String(unreadItems.length);
    renderChips("garden-unreadable-list", unreadItems, "No unreadable images recorded.");

    if (el("garden-withheld-review-count")) el("garden-withheld-review-count").textContent = String(withheld.needs_review_count || 0);
    renderChips("garden-withheld-review-list", withheld.needs_review_samples, "None awaiting large-group review.");

    if (el("garden-withheld-unnamed-count")) el("garden-withheld-unnamed-count").textContent = String(withheld.unnamed_count || 0);
    renderChips("garden-withheld-unnamed-list", withheld.unnamed_samples, "No visible unnamed groups.");

    if (el("garden-withheld-hidden-count")) el("garden-withheld-hidden-count").textContent = String(withheld.hidden_group_count || 0);
    renderChips("garden-withheld-hidden-list", withheld.hidden_group_samples, "No hidden single-face clusters.");

    if (el("garden-no-faces-count")) el("garden-no-faces-count").textContent = String(withheld.no_faces_count || 0);
    renderChips("garden-no-faces-list", withheld.no_faces_samples, "No cached zero-face images.");
  }

  function refreshPeopleAndReports() {
    var loadingEl = el("garden-people-loading");
    var errEl = el("garden-people-error");
    if (loadingEl) loadingEl.hidden = false;
    if (errEl) errEl.hidden = true;

    return global.NexoraApi.call("get_people_state", state.peopleQuery, state.peopleSort)
      .then(function (data) {
        if (!data || !data.ok) {
          if (loadingEl) loadingEl.hidden = true;
          if (errEl) {
            errEl.hidden = false;
            errEl.textContent = (data && data.error) || "Failed to load people data.";
          }
          return data;
        }
        renderOverview(data);
        renderSuggestions(data);
        renderPeopleCards(data);
        renderReports(data);
        return data;
      })
      .catch(function (err) {
        if (loadingEl) loadingEl.hidden = true;
        if (errEl) {
          errEl.hidden = false;
          errEl.textContent = err && err.message ? err.message : "Error loading people state.";
        }
      });
  }

  /* ------------------------------------------------------------------
   * B. Paginated Photo Gallery
   * ------------------------------------------------------------------ */

  function updateGalleryFilters(counts) {
    var safe = counts || {};
    ["all", "with_faces", "no_faces", "unscanned", "unreadable"].forEach(function (k) {
      var badge = el("gal-count-" + k);
      if (badge) badge.textContent = String(safe[k] || 0);
    });
    document.querySelectorAll(".nx-filter-pill[data-gallery-filter]").forEach(function (btn) {
      var active = btn.dataset.galleryFilter === state.galleryFilter;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function showGalleryState(mode, msg) {
    if (el("garden-gallery-loading")) el("garden-gallery-loading").hidden = mode !== "loading";
    if (el("garden-gallery-error")) {
      el("garden-gallery-error").hidden = mode !== "error";
      if (mode === "error") el("garden-gallery-error").textContent = msg || "Could not load photo gallery.";
    }
    if (el("garden-gallery-empty")) el("garden-gallery-empty").hidden = mode !== "empty";
    if (el("garden-gallery-grid")) el("garden-gallery-grid").hidden = mode !== "grid";
    if (el("garden-gallery-pagination") && mode !== "grid") el("garden-gallery-pagination").hidden = true;
  }

  function refreshGallery(preservePage) {
    if (!preservePage) state.galleryPage = 1;
    showGalleryState("loading");

    return global.NexoraApi.call(
      "get_garden_gallery",
      state.galleryQuery,
      state.galleryFilter,
      state.galleryPage,
      GALLERY_PAGE_SIZE
    ).then(function (res) {
      if (!res || !res.ok) {
        showGalleryState("error", (res && res.error) || "Could not load Photo Gallery.");
        return res;
      }

      updateGalleryFilters(res.filter_counts);
      state.galleryPage = res.page || 1;

      var sumEl = el("garden-gallery-summary");
      if (sumEl) {
        if (!res.has_source) sumEl.textContent = "Select a source folder to view thumbnails";
        else sumEl.textContent = res.total_matching + " matching image(s) · Page " + state.galleryPage + " of " + (res.total_pages || 1);
      }

      var items = res.items || [];
      if (!res.has_source || items.length === 0) {
        var tEl = el("garden-gallery-empty-title");
        var dEl = el("garden-gallery-empty-desc");
        var pickBtn = el("garden-gallery-empty-pick");
        var resetBtn = el("garden-gallery-empty-reset");
        if (!res.has_source) {
          if (tEl) tEl.textContent = "No Source Folder Selected";
          if (dEl) dEl.textContent = "Select a source folder above to browse real image thumbnails safely.";
          if (pickBtn) pickBtn.hidden = false;
          if (resetBtn) resetBtn.hidden = true;
        } else {
          if (tEl) tEl.textContent = "No Images Match Current Filter";
          if (dEl) dEl.textContent = "Try resetting your gallery search or switching back to All Images.";
          if (pickBtn) pickBtn.hidden = true;
          if (resetBtn) resetBtn.hidden = false;
        }
        showGalleryState("empty");
        return res;
      }

      var grid = el("garden-gallery-grid");
      clearChildren(grid);
      items.forEach(function (item) {
        var card = document.createElement("div");
        card.className = "nx-gallery-card";

        var thumb = document.createElement("div");
        thumb.className = "nx-gallery-thumb";
        if (item.thumbnail_url) {
          var img = document.createElement("img");
          img.src = item.thumbnail_url;
          img.alt = item.name;
          img.loading = "lazy";
          img.onerror = function () {
            thumb.textContent = "⚠";
          };
          thumb.appendChild(img);
        } else {
          thumb.textContent = item.face_status === "unreadable" ? "⚠ Unreadable" : "🖼";
        }

        var body = document.createElement("div");
        body.className = "nx-gallery-body";

        var nameDiv = document.createElement("div");
        nameDiv.className = "nx-gallery-name";
        nameDiv.textContent = item.name;
        nameDiv.title = item.name;

        var dateDiv = document.createElement("div");
        dateDiv.className = "nx-muted";
        dateDiv.textContent = item.capture_date ? "EXIF: " + item.capture_date : "No EXIF date · " + item.size_formatted;

        var badge = document.createElement("span");
        badge.className = "nx-pill-badge";
        if (item.face_status === "faces_found") {
          badge.classList.add("is-good");
          badge.textContent = item.faces_detected + " face(s)" +
            (item.people_labels && item.people_labels.length ? ": " + item.people_labels.join(", ") : "");
        } else if (item.face_status === "no_faces") {
          badge.textContent = "0 faces (cached)";
        } else if (item.face_status === "unreadable") {
          badge.classList.add("is-warn");
          badge.textContent = "Unreadable";
        } else {
          badge.textContent = "Unscanned";
        }

        body.appendChild(nameDiv);
        body.appendChild(dateDiv);
        body.appendChild(badge);
        card.appendChild(thumb);
        card.appendChild(body);
        grid.appendChild(card);
      });

      showGalleryState("grid");

      var pBar = el("garden-gallery-pagination");
      var pLabel = el("garden-gallery-page-label");
      var pPrev = el("garden-gallery-prev");
      var pNext = el("garden-gallery-next");
      if (pBar && pLabel && pPrev && pNext) {
        pBar.hidden = (res.total_pages || 1) <= 1;
        pLabel.textContent = "Page " + state.galleryPage + " of " + (res.total_pages || 1);
        pPrev.disabled = state.galleryPage <= 1;
        pNext.disabled = state.galleryPage >= (res.total_pages || 1);
      }
      return res;
    }).catch(function (err) {
      showGalleryState("error", err && err.message ? err.message : "Failed to load Photo Gallery.");
    });
  }

  function refreshAll(preserveGalleryPage) {
    pollScanStatusOnce();
    var p1 = refreshPeopleAndReports();
    if (state.activeTab === "gallery") {
      return Promise.all([p1, refreshGallery(Boolean(preserveGalleryPage))]);
    }
    return p1;
  }

  function bindGardenEvents() {
    document.querySelectorAll(".nx-garden-tab[data-garden-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        switchSubTab(btn.dataset.gardenTab);
      });
    });

    if (el("garden-refresh-btn")) {
      el("garden-refresh-btn").addEventListener("click", function () {
        refreshAll(true);
      });
    }
    if (el("garden-scan-start-btn")) el("garden-scan-start-btn").addEventListener("click", handleStartScan);
    if (el("garden-scan-stop-btn")) el("garden-scan-stop-btn").addEventListener("click", handleStopScan);

    var pq = el("garden-people-query");
    if (pq) {
      pq.addEventListener("input", function () {
        state.peopleQuery = pq.value || "";
        if (state.peopleTimer) clearTimeout(state.peopleTimer);
        state.peopleTimer = setTimeout(refreshPeopleAndReports, 120);
      });
    }
    if (el("garden-people-clear-btn")) {
      el("garden-people-clear-btn").addEventListener("click", function () {
        state.peopleQuery = "";
        if (pq) pq.value = "";
        refreshPeopleAndReports();
      });
    }
    if (el("garden-people-sort")) {
      el("garden-people-sort").addEventListener("change", function (ev) {
        state.peopleSort = ev.target.value || "Largest first";
        refreshPeopleAndReports();
      });
    }

    var gq = el("garden-gallery-query");
    if (gq) {
      gq.addEventListener("input", function () {
        state.galleryQuery = gq.value || "";
        if (state.galleryTimer) clearTimeout(state.galleryTimer);
        state.galleryTimer = setTimeout(function () { refreshGallery(false); }, 120);
      });
    }
    var resetGal = function () {
      state.galleryQuery = "";
      state.galleryFilter = "all";
      if (gq) gq.value = "";
      refreshGallery(false);
    };
    if (el("garden-gallery-clear-btn")) el("garden-gallery-clear-btn").addEventListener("click", resetGal);
    if (el("garden-gallery-empty-reset")) el("garden-gallery-empty-reset").addEventListener("click", resetGal);
    if (el("garden-gallery-empty-pick")) {
      el("garden-gallery-empty-pick").addEventListener("click", function () {
        var topPick = document.getElementById("btn-pick-source");
        if (topPick) topPick.click();
      });
    }

    document.querySelectorAll(".nx-filter-pill[data-gallery-filter]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (gq) state.galleryQuery = gq.value || "";
        state.galleryFilter = btn.dataset.galleryFilter || "all";
        refreshGallery(false);
      });
    });

    if (el("garden-gallery-prev")) {
      el("garden-gallery-prev").addEventListener("click", function () {
        if (state.galleryPage > 1) {
          state.galleryPage -= 1;
          refreshGallery(true);
        }
      });
    }
    if (el("garden-gallery-next")) {
      el("garden-gallery-next").addEventListener("click", function () {
        state.galleryPage += 1;
        refreshGallery(true);
      });
    }

    if (el("garden-modal-cancel")) el("garden-modal-cancel").addEventListener("click", closeModal);
    if (el("garden-modal-confirm")) {
      el("garden-modal-confirm").addEventListener("click", function () {
        if (typeof state.modalAction === "function") {
          el("garden-modal-confirm").disabled = true;
          state.modalAction();
        }
      });
    }
    document.addEventListener("keydown", function (ev) {
      var modal = el("garden-confirm-modal");
      if (ev.key === "Escape" && modal && !modal.hidden) {
        closeModal();
      }
    });
  }

  document.addEventListener("DOMContentLoaded", bindGardenEvents);

  global.NexoraGarden = {
    refresh: refreshAll,
    switchSubTab: switchSubTab,
    closeModal: closeModal,
    getState: function () { return state; }
  };
})(window);
