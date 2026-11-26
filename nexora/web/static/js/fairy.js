/* NEXORA — Original Woodland Fairy Companion ("Luma") with Multi-Expression SVG */
(function (global) {
  "use strict";

  var ROOM_TIPS = {
    "treehouse": "Welcome to the Living Treehouse! Hover any cozy window or door to explore, or use the sidebar.",
    "main-hall": "Main Hall shows real cached file totals, people summary, and recent audit activity.",
    "library": "Magical Library lets you inspect top-level source files safely. Subfolders stay untouched.",
    "photo-garden": "Photo Garden organizes your discovered people cards so you can name, split, or merge groups.",
    "crystal-chamber": "Crystal Chamber guards safety rules: Nexora never deletes user files!",
    "potion-workshop": "Potion Workshop previews every file move before running SHA-256 verification.",
    "memory-room": "Memory Room reads your move and scan audit logs in chronological order.",
    "secret-vault": "Secret Vault reverses the last completed run cleanly using your audit log."
  };

  var EXPRESSIONS = ["idle", "curious", "working", "celebrate", "error"];
  var currentMood = "idle";
  var bubbleOpen = true;

  /* Builds an inline original SVG fairy so facial expressions and wing layers animate cleanly. */
  function buildFairySvg() {
    return (
      '<svg id="nx-fairy-svg" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<g class="nx-fairy-wings">' +
          '<path d="M56 54 C28 30, 14 48, 30 68 C40 74, 52 68, 56 60 Z" fill="#B7A1DC" fill-opacity="0.78" stroke="#322116" stroke-width="3" stroke-linejoin="round"/>' +
          '<path d="M64 54 C92 30, 106 48, 90 68 C80 74, 68 68, 64 60 Z" fill="#B7A1DC" fill-opacity="0.78" stroke="#322116" stroke-width="3" stroke-linejoin="round"/>' +
        '</g>' +
        '<path d="M48 64 Q60 56 72 64 L78 96 Q60 102 42 96 Z" fill="#8EBB70" stroke="#322116" stroke-width="3" stroke-linejoin="round"/>' +
        '<path d="M54 68 L60 95 L66 68" fill="none" stroke="#315B3B" stroke-width="2" stroke-linecap="round"/>' +
        '<circle cx="60" cy="44" r="16" fill="#F4EBD5" stroke="#322116" stroke-width="3"/>' +
        '<path d="M43 38 C46 22, 74 22, 77 38 Q60 32 43 38 Z" fill="#79563C" stroke="#322116" stroke-width="3" stroke-linejoin="round"/>' +
        '<path d="M60 22 L62 15" stroke="#322116" stroke-width="3" stroke-linecap="round"/>' +
        '<circle cx="49" cy="49" r="3" fill="#E8C477" opacity="0.65"/>' +
        '<circle cx="71" cy="49" r="3" fill="#E8C477" opacity="0.65"/>' +
        /* Expression: Default / Curious / Working eyes */
        '<g id="fairy-eyes-open">' +
          '<circle cx="54" cy="44" r="2.4" fill="#322116"/>' +
          '<circle cx="66" cy="44" r="2.4" fill="#322116"/>' +
        '</g>' +
        /* Expression: Celebrate happy crescent eyes */
        '<g id="fairy-eyes-happy" style="display:none" fill="none" stroke="#322116" stroke-width="2.4" stroke-linecap="round">' +
          '<path d="M51 45 Q54 41 57 45"/>' +
          '<path d="M63 45 Q66 41 69 45"/>' +
        '</g>' +
        /* Mouth variants */
        '<path id="fairy-mouth-smile" d="M55 50 Q60 55 65 50" fill="none" stroke="#322116" stroke-width="2.4" stroke-linecap="round"/>' +
        '<circle id="fairy-mouth-o" cx="60" cy="52" r="2.8" fill="#322116" style="display:none"/>' +
        /* Curious raised eyebrow */
        '<path id="fairy-brow-curious" d="M63 39 Q66 37 69 39" fill="none" stroke="#322116" stroke-width="2" stroke-linecap="round" style="display:none"/>' +
        /* Sparkle lantern twig */
        '<line x1="75" y1="74" x2="90" y2="62" stroke="#79563C" stroke-width="3" stroke-linecap="round"/>' +
        '<circle id="fairy-lantern" cx="92" cy="60" r="5.5" fill="#E8C477" stroke="#322116" stroke-width="2.2"/>' +
      '</svg>'
    );
  }

  function applyExpression(mood) {
    if (EXPRESSIONS.indexOf(mood) === -1) mood = "idle";
    currentMood = mood;

    var dock = document.getElementById("fairy-dock");
    if (dock) {
      EXPRESSIONS.forEach(function (name) {
        dock.classList.remove("nx-fairy-state-" + name);
      });
      dock.classList.add("nx-fairy-state-" + mood);
      dock.dataset.mood = mood;
    }

    var eyesOpen = document.getElementById("fairy-eyes-open");
    var eyesHappy = document.getElementById("fairy-eyes-happy");
    var mouthSmile = document.getElementById("fairy-mouth-smile");
    var mouthO = document.getElementById("fairy-mouth-o");
    var browCurious = document.getElementById("fairy-brow-curious");
    var lantern = document.getElementById("fairy-lantern");

    if (!eyesOpen) return;

    var isHappy = mood === "celebrate";
    var isError = mood === "error";
    var isCurious = mood === "curious" || mood === "working";

    eyesOpen.style.display = isHappy ? "none" : "inline";
    eyesHappy.style.display = isHappy ? "inline" : "none";
    mouthSmile.style.display = isError ? "none" : "inline";
    mouthO.style.display = isError ? "inline" : "none";
    browCurious.style.display = isCurious ? "inline" : "none";

    if (lantern) {
      if (mood === "working") lantern.setAttribute("fill", "#B7A1DC");
      else if (mood === "error") lantern.setAttribute("fill", "#E88B77");
      else lantern.setAttribute("fill", "#E8C477");
    }
  }

  function setFairyMessage(text, mood) {
    var msgEl = document.getElementById("fairy-bubble-text");
    if (msgEl && text) msgEl.textContent = text;
    if (mood) applyExpression(mood);

    var bubble = document.getElementById("fairy-bubble");
    if (bubble && bubbleOpen) bubble.hidden = false;
  }

  function onRoomChanged(roomId) {
    var tip = ROOM_TIPS[roomId] || ROOM_TIPS.treehouse;
    var mood = roomId === "crystal-chamber" ? "curious" : "idle";
    setFairyMessage(tip, mood);
  }

  function initFairy() {
    var slot = document.getElementById("fairy-avatar-slot");
    if (slot) slot.innerHTML = buildFairySvg();
    applyExpression("idle");

    var toggleBtn = document.getElementById("fairy-toggle-btn");
    var closeBtn = document.getElementById("fairy-close-btn");
    var bubble = document.getElementById("fairy-bubble");

    if (toggleBtn && bubble) {
      toggleBtn.addEventListener("click", function () {
        bubbleOpen = !bubbleOpen;
        bubble.hidden = !bubbleOpen;
        if (bubbleOpen) {
          onRoomChanged(document.body.dataset.room || "treehouse");
        }
      });
    }

    if (closeBtn && bubble) {
      closeBtn.addEventListener("click", function () {
        bubbleOpen = false;
        bubble.hidden = true;
      });
    }
  }

  global.NexoraFairy = {
    EXPRESSIONS: EXPRESSIONS,
    getExpression: function () { return currentMood; },
    setExpression: applyExpression,
    say: setFairyMessage,
    onRoomChanged: onRoomChanged,
    init: initFairy
  };
})(window);
