/* NEXORA — Hybrid Treehouse & Sidebar Router */
(function (global) {
  "use strict";

  var VALID_ROOMS = {
    "treehouse": true,
    "main-hall": true,
    "library": true,
    "photo-garden": true,
    "potion-workshop": true,
    "memory-room": true,
    "secret-vault": true,
    "crystal-chamber": true
  };

  function navigateTo(roomId) {
    if (!VALID_ROOMS[roomId]) roomId = "treehouse";
    document.body.dataset.room = roomId;

    var navBtns = document.querySelectorAll(".nx-nav-item[data-room-target]");
    navBtns.forEach(function (btn) {
      btn.classList.toggle("is-active", btn.dataset.roomTarget === roomId);
    });

    var stage = document.getElementById("main-stage");
    if (stage) {
      stage.classList.toggle("nx-stage-home", roomId === "treehouse");
    }

    var panels = document.querySelectorAll("[data-room-panel]");
    panels.forEach(function (panel) {
      panel.hidden = panel.dataset.roomPanel !== roomId;
    });

    if (global.NexoraFairy) {
      global.NexoraFairy.onRoomChanged(roomId);
    }

    if (roomId === "main-hall" || roomId === "crystal-chamber" || roomId === "library") {
      refreshRoomData(roomId);
    }
  }

  function refreshAppState() {
    return global.NexoraApi.call("get_app_state").then(function (state) {
      var versionEl = document.getElementById("app-version");
      if (versionEl) versionEl.textContent = "v" + state.version;

      var statusEl = document.getElementById("status-text");
      if (statusEl && state.job) statusEl.textContent = state.job.status_text || "Ready";

      var footerEl = document.getElementById("safety-footer");
      if (footerEl && state.footer) footerEl.textContent = state.footer;

      var srcPill = document.getElementById("source-path-pill");
      if (srcPill) srcPill.textContent = state.source_dir || "No source folder chosen";

      var dstPill = document.getElementById("dest-path-pill");
      if (dstPill) dstPill.textContent = state.dest_dir || "No destination folder chosen";

      return state;
    }).catch(function (err) {
      var statusEl = document.getElementById("status-text");
      if (statusEl) statusEl.textContent = "Bridge error: " + err.message;
      if (global.NexoraFairy) {
        global.NexoraFairy.say("Hmm, the bridge seems sleepy: " + err.message, "error");
      }
    });
  }

  function renderMainHall(data) {
    if (!data || !data.ok) return;
    document.getElementById("kpi-indexed").textContent = String(data.indexed_total);
    document.getElementById("kpi-people").textContent = String(data.visible_people);
    document.getElementById("kpi-named").textContent = String(data.named_people);
    document.getElementById("kpi-unreadable").textContent = String(data.unreadable_count);

    document.getElementById("hall-images-count").textContent = String(data.indexed_images || 0);
    document.getElementById("hall-videos-count").textContent = String(data.indexed_videos || 0);
    document.getElementById("hall-cached-size").textContent = data.indexed_size_formatted || "0.0 KB";
    document.getElementById("hall-unnamed-review").textContent =
      (data.needs_review_count || 0) + " review / " + (data.unnamed_people || 0) + " unnamed";

    var appSt = data.app_state || {};
    document.getElementById("hall-source-status").textContent = appSt.source_dir ? "Selected" : "Not selected";
    document.getElementById("hall-dest-status").textContent = appSt.dest_dir ? "Selected" : "Not selected";
    var pCounts = appSt.plan_counts || {};
    document.getElementById("hall-plan-status").textContent = appSt.has_active_plan
      ? (pCounts.ready || 0) + " ready, " + (pCounts.skipped || 0) + " skipped"
      : "No preview built";
    document.getElementById("hall-undo-status").textContent = appSt.can_undo
      ? "Available (" + appSt.active_undo_run + ")"
      : "No active run log";

    var chipsWrap = document.getElementById("hall-people-chips");
    chipsWrap.innerHTML = "";
    var previewPeople = data.people_preview || [];
    if (previewPeople.length === 0) {
      var emptyPeople = document.createElement("span");
      emptyPeople.className = "nx-muted";
      emptyPeople.textContent = "No visible people groups scanned yet.";
      chipsWrap.appendChild(emptyPeople);
    } else {
      previewPeople.forEach(function (person) {
        var chip = document.createElement("button");
        chip.className = "nx-people-chip";
        chip.type = "button";
        chip.title = "Open Photo Garden";
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
        chipsWrap.appendChild(chip);
      });
    }

    var actWrap = document.getElementById("hall-activity-list");
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
        if (entry.kind === "move_run") {
          detail.textContent = entry.moved_count + " file(s) moved at " + entry.timestamp;
        } else {
          detail.textContent = entry.summary || "Scan recorded";
        }
        left.appendChild(title);
        left.appendChild(detail);

        var badge = document.createElement("span");
        badge.className = "nx-pill-badge";
        if (entry.kind === "move_run") {
          badge.classList.add(entry.undone ? "is-warn" : "is-good");
          badge.textContent = entry.undone ? "Undone (" + entry.restored_count + ")" : "Move Run";
        } else {
          badge.textContent = "Face Scan";
        }

        row.appendChild(left);
        row.appendChild(badge);
        actWrap.appendChild(row);
      });
    }
  }

  function refreshRoomData(roomId) {
    if (roomId === "main-hall") {
      global.NexoraApi.call("get_main_hall_summary").then(renderMainHall);
    } else if (roomId === "library") {
      if (global.NexoraLibrary) {
        global.NexoraLibrary.refresh(false);
      }
    } else if (roomId === "crystal-chamber") {
      global.NexoraApi.call("get_crystal_chamber_status").then(function (data) {
        if (!data || !data.ok) return;
        document.getElementById("crystal-summary").textContent = data.summary;
        var list = document.getElementById("crystal-details");
        list.innerHTML = "";
        (data.details || []).forEach(function (line) {
          var li = document.createElement("li");
          li.textContent = line;
          list.appendChild(li);
        });
      });
    }
  }

  function bindControls() {
    document.querySelectorAll("[data-room-target]").forEach(function (el) {
      el.addEventListener("click", function () {
        navigateTo(el.dataset.roomTarget);
      });
    });

    var pickSrc = document.getElementById("btn-pick-source");
    if (pickSrc) {
      pickSrc.addEventListener("click", function () {
        global.NexoraApi.call("pick_folder", "source").then(function (res) {
          if (res && res.ok && !res.cancelled) {
            refreshAppState();
            if (global.NexoraLibrary) {
              global.NexoraLibrary.refresh(false);
            }
            if (global.NexoraFairy) {
              global.NexoraFairy.say("Source folder set! Explore the treehouse rooms anytime.", "celebrate");
            }
          }
        });
      });
    }

    var pickDst = document.getElementById("btn-pick-dest");
    if (pickDst) {
      pickDst.addEventListener("click", function () {
        global.NexoraApi.call("pick_folder", "dest").then(function (res) {
          if (res && res.ok && !res.cancelled) {
            refreshAppState();
            if (global.NexoraFairy) {
              global.NexoraFairy.say("Destination folder chosen! Safe organizing ahead.", "celebrate");
            }
          }
        });
      });
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    bindControls();
    if (global.NexoraFairy) global.NexoraFairy.init();
    if (global.NexoraScene) global.NexoraScene.load();
    navigateTo("treehouse");
    refreshAppState().then(function () {
      refreshRoomData("main-hall");
      refreshRoomData("crystal-chamber");
    });
  });

  global.NexoraRouter = { navigateTo: navigateTo, refreshAppState: refreshAppState };
})(window);
