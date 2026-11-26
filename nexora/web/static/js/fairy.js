/* NEXORA — Woodland Fairy Companion Controller */
(function (global) {
  "use strict";

  var ROOM_TIPS = {
    "treehouse": "Welcome to the Living Treehouse! Pick a room on the tree or use the sidebar.",
    "main-hall": "Main Hall shows real scanned counts and recent activity from your runs folder.",
    "library": "Magical Library shows top-level files only. Subfolders stay untouched!",
    "photo-garden": "Photo Garden lets you name, split, and merge discovered people safely.",
    "crystal-chamber": "Crystal Chamber enforces safety: Nexora never deletes user files!",
    "potion-workshop": "Potion Workshop previews every move first and verifies SHA-256 checksums.",
    "memory-room": "Memory Room reads your move and scan audit logs chronologically.",
    "secret-vault": "Secret Vault lets you undo your last run safely and return every file home."
  };

  function setFairyMessage(text, mood) {
    var bubble = document.getElementById("fairy-bubble");
    if (!bubble) return;
    bubble.textContent = text;
    bubble.dataset.mood = mood || "idle";
  }

  function onRoomChanged(roomId) {
    var tip = ROOM_TIPS[roomId] || ROOM_TIPS.treehouse;
    setFairyMessage(tip, "guide");
  }

  function bindFairy() {
    var btn = document.getElementById("fairy-toggle-btn");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var activeRoom = document.body.dataset.room || "treehouse";
      onRoomChanged(activeRoom);
    });
  }

  global.NexoraFairy = {
    say: setFairyMessage,
    onRoomChanged: onRoomChanged,
    init: bindFairy
  };
})(window);
