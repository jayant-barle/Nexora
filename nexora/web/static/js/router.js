/* NEXORA — Obsidian Lavender Workspace Router & Dashboard Presenter */
(function (global) {
  "use strict";

  var ROOM_TITLES = {
    "dashboard": "Dashboard",
    "main-hall": "Workspace Overview",
    "library": "File Explorer",
    "photo-garden": "Photos & People",
    "potion-workshop": "File Organizer",
    "memory-room": "Activity & History",
    "secret-vault": "Settings & Privacy",
    "crystal-chamber": "Safety & Restrictions"
  };

  function normalizeRoom(roomId) {
    if (roomId === "treehouse" || !ROOM_TITLES[roomId]) return "dashboard";
    return roomId;
  }

  function el(id) {
    return document.getElementById(id);
  }

  function navigateTo(roomId) {
    var target = normalizeRoom(roomId);
    document.body.dataset.room = target;

    var titleEl = el("topbar-page-title");
    if (titleEl) titleEl.textContent = ROOM_TITLES[target] || "Dashboard";

    document.querySelectorAll(".nx-nav-item[data-room-target]").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.dataset.roomTarget === target);
    });

    document.querySelectorAll("[data-room-panel]").forEach(function (panel) {
      panel.hidden = panel.dataset.roomPanel !== target;
    });

    if (target === "dashboard" || target === "main-hall" || target === "crystal-chamber" || target === "library" || target === "photo-garden") {
      refreshRoomData(target);
    }
  }

  function refreshAppState() {
    return global.NexoraApi.call("get_app_state").then(function (state) {
      if (el("app-version")) el("app-version").textContent = "v" + state.version;
      if (el("status-text") && state.job) el("status-text").textContent = state.job.status_text || "Ready";
      if (el("safety-footer") && state.footer) el("safety-footer").textContent = state.footer;

      var srcPill = el("source-path-pill");
      if (srcPill) {
        srcPill.textContent = state.source_dir || "No source folder chosen";
        srcPill.title = state.source_dir || "No source folder chosen";
      }

      var dstPill = el("dest-path-pill");
      if (dstPill) {
        dstPill.textContent = state.dest_dir || "No destination folder chosen";
        dstPill.title = state.dest_dir || "No destination folder chosen";
      }

      var topWsText = el("topbar-workspace-text");
      var topWsDot = el("topbar-workspace-dot");
      if (topWsText && topWsDot) {
        topWsText.textContent = state.source_dir || "No source selected";
        topWsText.title = state.source_dir || "No source selected";
        topWsDot.classList.toggle("is-ready", Boolean(state.source_dir));
      }

      var topBadge = el("topbar-status-badge");
      if (topBadge && state.job) {
        topBadge.textContent = state.job.running ? "Running" : (state.has_active_plan ? "Plan Ready" : "Ready");
      }

      return state;
    }).catch(function (err) {
      if (el("status-text")) el("status-text").textContent = "Bridge error: " + err.message;
    });
  }

  function renderPeopleChips(container, previewPeople) {
    if (!container) return;
    container.innerHTML = "";
    if (!previewPeople || previewPeople.length === 0) {
      var empty = document.createElement("span");
      empty.className = "nx-muted";
      empty.textContent = "No visible people groups scanned yet.";
      container.appendChild(empty);
      return;
    }

    previewPeople.forEach(function (person) {
      var chip = document.createElement("button");
      chip.className = "nx-people-chip";
      chip.type = "button";
      chip.title = "Open Photos & People";
      chip.addEventListener("click", function () {
        navigateTo("photo-garden");
      });

      if (person.crop_url) {
        var img = document.createElement("img");
        img.src = person.crop_url;
        img.alt = person.display_name;
        chip.appendChild(img);
      } else {
        var dot = document.createElement("span");
        dot.className = "nx-people-chip-dot";
        dot.textContent = (person.display_name || "?").charAt(0).toUpperCase();
        chip.appendChild(dot);
      }

      var label = document.createElement("span");
      label.textContent = person.display_name + " (" + person.size + ")";
      chip.appendChild(label);
      container.appendChild(chip);
    });
  }

  function renderDashboard(data) {
    if (!data || !data.ok) return;
    var appSt = data.app_state || {};
    var pCounts = appSt.plan_counts || {};

    if (el("dash-kpi-indexed")) el("dash-kpi-indexed").textContent = String(data.indexed_total || 0);
    if (el("dash-kpi-indexed-sub")) {
      el("dash-kpi-indexed-sub").textContent = (data.indexed_images || 0) + " images · " + (data.indexed_videos || 0) + " videos";
    }

    if (el("dash-kpi-people")) el("dash-kpi-people").textContent = String(data.visible_people || 0);
    if (el("dash-kpi-people-sub")) {
      el("dash-kpi-people-sub").textContent = (data.named_people || 0) + " confirmed · " + (data.unnamed_people || 0) + " unnamed";
    }

    if (el("dash-kpi-ready")) el("dash-kpi-ready").textContent = String(appSt.has_active_plan ? (pCounts.ready || 0) : 0);
    if (el("dash-kpi-ready-sub")) {
      el("dash-kpi-ready-sub").textContent = appSt.has_active_plan
        ? (pCounts.ready || 0) + " ready · " + (pCounts.skipped || 0) + " skipped"
        : (appSt.source_dir && appSt.dest_dir ? "Ready to preview moves" : "Select source & destination");
    }

    if (el("dash-kpi-undo")) el("dash-kpi-undo").textContent = appSt.can_undo ? "Available" : "None";
    if (el("dash-kpi-undo-sub")) {
      el("dash-kpi-undo-sub").textContent = appSt.can_undo
        ? "Latest: " + appSt.active_undo_run
        : "Zero un-reversed runs";
    }

    var tbody = el("dash-activity-tbody");
    if (tbody) {
      tbody.innerHTML = "";
      var entries = data.recent_activity || [];
      if (entries.length === 0) {
        var emptyTr = document.createElement("tr");
        var emptyTd = document.createElement("td");
        emptyTd.colSpan = 3;
        emptyTd.className = "nx-muted";
        emptyTd.textContent = "No scan logs or organization runs recorded in runs/ yet.";
        emptyTr.appendChild(emptyTd);
        tbody.appendChild(emptyTr);
      } else {
        entries.forEach(function (entry) {
          var tr = document.createElement("tr");

          var idTd = document.createElement("td");
          idTd.className = "nx-mono";
          idTd.textContent = entry.id || entry.kind;

          var detTd = document.createElement("td");
          detTd.className = "nx-muted";
          detTd.textContent = entry.kind === "move_run"
            ? entry.moved_count + " file(s) moved (" + entry.timestamp + ")"
            : (entry.summary || "Scan recorded");

          var stTd = document.createElement("td");
          var badge = document.createElement("span");
          badge.className = "nx-pill-badge";
          if (entry.kind === "move_run") {
            badge.classList.add(entry.undone ? "is-warn" : "is-good");
            badge.textContent = entry.undone ? "Undone" : "Completed";
          } else {
            badge.classList.add("is-accent");
            badge.textContent = "Face Scan";
          }
          stTd.appendChild(badge);

          tr.appendChild(idTd);
          tr.appendChild(detTd);
          tr.appendChild(stTd);
          tbody.appendChild(tr);
        });
      }
    }

    renderPeopleChips(el("dash-people-chips"), data.people_preview || []);
  }

  function renderMainHall(data) {
    if (!data || !data.ok) return;
    if (el("kpi-indexed")) el("kpi-indexed").textContent = String(data.indexed_total);
    if (el("kpi-people")) el("kpi-people").textContent = String(data.visible_people);
    if (el("kpi-named")) el("kpi-named").textContent = String(data.named_people);
    if (el("kpi-unreadable")) el("kpi-unreadable").textContent = String(data.unreadable_count);

    if (el("hall-images-count")) el("hall-images-count").textContent = String(data.indexed_images || 0);
    if (el("hall-videos-count")) el("hall-videos-count").textContent = String(data.indexed_videos || 0);
    if (el("hall-cached-size")) el("hall-cached-size").textContent = data.indexed_size_formatted || "0.0 KB";
    if (el("hall-unnamed-review")) {
      el("hall-unnamed-review").textContent = (data.needs_review_count || 0) + " review / " + (data.unnamed_people || 0) + " unnamed";
    }

    var appSt = data.app_state || {};
    var pCounts = appSt.plan_counts || {};
    if (el("hall-source-status")) el("hall-source-status").textContent = appSt.source_dir ? "Selected" : "Not selected";
    if (el("hall-dest-status")) el("hall-dest-status").textContent = appSt.dest_dir ? "Selected" : "Not selected";
    if (el("hall-plan-status")) {
      el("hall-plan-status").textContent = appSt.has_active_plan
        ? (pCounts.ready || 0) + " ready, " + (pCounts.skipped || 0) + " skipped"
        : "No preview built";
    }
    if (el("hall-undo-status")) {
      el("hall-undo-status").textContent = appSt.can_undo ? "Available (" + appSt.active_undo_run + ")" : "No active run log";
    }

    renderPeopleChips(el("hall-people-chips"), data.people_preview || []);

    var actWrap = el("hall-activity-list");
    if (!actWrap) return;
    actWrap.innerHTML = "";
    var entries = data.recent_activity || [];
    if (entries.length === 0) {
      var emptyAct = document.createElement("p");
      emptyAct.className = "nx-muted";
      emptyAct.style.margin = "0";
      emptyAct.textContent = "No scan logs or organization runs recorded in runs/ yet.";
      actWrap.appendChild(emptyAct);
    } else {
      entries.forEach(function (entry) {
        var row = document.createElement("div");
        row.className = "nx-activity-row";
        var left = document.createElement("div");
        var title = document.createElement("strong");
        title.textContent = entry.id || entry.kind;
        var detail = document.createElement("div");
        detail.className = "nx-muted";
        detail.textContent = entry.kind === "move_run"
          ? entry.moved_count + " file(s) moved at " + entry.timestamp
          : (entry.summary || "Scan recorded");
        left.appendChild(title);
        left.appendChild(detail);

        var badge = document.createElement("span");
        badge.className = "nx-pill-badge";
        if (entry.kind === "move_run") {
          badge.classList.add(entry.undone ? "is-warn" : "is-good");
          badge.textContent = entry.undone ? "Undone" : "Move Run";
        } else {
          badge.classList.add("is-accent");
          badge.textContent = "Face Scan";
        }
        row.appendChild(left);
        row.appendChild(badge);
        actWrap.appendChild(row);
      });
    }
  }

  function refreshRoomData(roomId) {
    if (roomId === "dashboard" || roomId === "main-hall") {
      return global.NexoraApi.call("get_main_hall_summary").then(function (data) {
        renderDashboard(data);
        renderMainHall(data);
        return data;
      });
    } else if (roomId === "library") {
      if (global.NexoraLibrary) return global.NexoraLibrary.refresh(false);
    } else if (roomId === "photo-garden") {
      if (global.NexoraGarden) return global.NexoraGarden.refresh(false);
    } else if (roomId === "crystal-chamber") {
      return global.NexoraApi.call("get_crystal_chamber_status").then(function (data) {
        if (!data || !data.ok) return;
        if (el("crystal-summary")) el("crystal-summary").textContent = data.summary;
        var list = el("crystal-details");
        if (list) {
          list.innerHTML = "";
          (data.details || []).forEach(function (line) {
            var li = document.createElement("li");
            li.textContent = line;
            list.appendChild(li);
          });
        }
      });
    }
  }

  function bindControls() {
    document.querySelectorAll("[data-room-target]").forEach(function (item) {
      item.addEventListener("click", function () {
        navigateTo(item.dataset.roomTarget);
      });
    });

    var topSearch = el("topbar-search-input");
    if (topSearch) {
      topSearch.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          var libInp = el("lib-search-input");
          if (libInp) {
            libInp.value = topSearch.value || "";
            libInp.dispatchEvent(new Event("input", { bubbles: true }));
          }
          navigateTo("library");
        }
      });
    }

    var pickSrc = el("btn-pick-source");
    if (pickSrc) {
      pickSrc.addEventListener("click", function () {
        global.NexoraApi.call("pick_folder", "source").then(function (res) {
          if (res && res.ok && !res.cancelled) {
            refreshAppState();
            refreshRoomData("dashboard");
            if (global.NexoraLibrary) global.NexoraLibrary.refresh(false);
            if (global.NexoraGarden) global.NexoraGarden.refresh(false);
          }
        });
      });
    }

    var pickDst = el("btn-pick-dest");
    if (pickDst) {
      pickDst.addEventListener("click", function () {
        global.NexoraApi.call("pick_folder", "dest").then(function (res) {
          if (res && res.ok && !res.cancelled) {
            refreshAppState();
            refreshRoomData("dashboard");
          }
        });
      });
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    bindControls();
    navigateTo("dashboard");
    refreshAppState().then(function () {
      refreshRoomData("dashboard");
      refreshRoomData("crystal-chamber");
    });
  });

  global.NexoraRouter = { navigateTo: navigateTo, refreshAppState: refreshAppState };
})(window);
