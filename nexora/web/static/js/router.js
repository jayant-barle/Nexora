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
      if (global.NexoraFairy) {
        global.NexoraFairy.say("Hmm, the bridge seems sleepy: " + err.message, "error");
      }
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
