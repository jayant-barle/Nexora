/* NEXORA — Phase 2 Hybrid Router & Design Foundation Validation */
(function (global) {
  "use strict";

  var ROOM_META = {
    "treehouse": { title: "Living Treehouse", subtitle: "Home forest hub — choose any room door or sidebar item." },
    "main-hall": { title: "Main Hall", subtitle: "Dashboard of real indexed counts, active status, and recent runs." },
    "library": { title: "Magical Library", subtitle: "Top-level source browser (Phase 5 connects full exploration & preview)." },
    "photo-garden": { title: "Photo Garden", subtitle: "People cards, naming, splitting, merging (Phase 5 wires full workspace)." },
    "crystal-chamber": { title: "Crystal Chamber", subtitle: "Safety boundary: duplicate detection & file deletion are disabled." },
    "potion-workshop": { title: "Potion Workshop", subtitle: "AI face scan, preview table, explicit Approve & SHA-256 verified moves." },
    "memory-room": { title: "Memory Room", subtitle: "Audit timeline from runs/ logs." },
    "secret-vault": { title: "Secret Vault", subtitle: "Verified full-run Undo & corrupt-state recovery backups." }
  };

  function navigateTo(roomId) {
    if (!ROOM_META[roomId]) roomId = "treehouse";
    document.body.dataset.room = roomId;

    var navBtns = document.querySelectorAll("[data-room-target]");
    navBtns.forEach(function (btn) {
      btn.classList.toggle("is-active", btn.dataset.roomTarget === roomId);
    });

    var panels = document.querySelectorAll("[data-room-panel]");
    panels.forEach(function (panel) {
      var match = panel.dataset.roomPanel === roomId;
      panel.hidden = !match;
    });

    if (global.NexoraFairy) {
      global.NexoraFairy.onRoomChanged(roomId);
    }

    if (roomId === "main-hall" || roomId === "crystal-chamber") {
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
    });
  }

  function refreshRoomData(roomId) {
    if (roomId === "main-hall") {
      global.NexoraApi.call("get_main_hall_summary").then(function (data) {
        if (!data || !data.ok) return;
        document.getElementById("kpi-indexed").textContent = String(data.indexed_total);
        document.getElementById("kpi-people").textContent = String(data.visible_people);
        document.getElementById("kpi-named").textContent = String(data.named_people);
        document.getElementById("kpi-unreadable").textContent = String(data.unreadable_count);
      });
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
            if (global.NexoraFairy) {
              global.NexoraFairy.say("Source folder set! You can now visit Potion Workshop or Magical Library.");
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
              global.NexoraFairy.say("Destination folder chosen! Ready for safe organization preview.");
            }
          }
        });
      });
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    bindControls();
    if (global.NexoraFairy) global.NexoraFairy.init();
    navigateTo("treehouse");
    refreshAppState().then(function () {
      refreshRoomData("main-hall");
      refreshRoomData("crystal-chamber");
    });
  });

  global.NexoraRouter = { navigateTo: navigateTo, refreshAppState: refreshAppState };
})(window);
