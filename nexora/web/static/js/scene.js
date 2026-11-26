/* NEXORA — Interactive Forest Scene Loader & Hotspot Controller */
(function (global) {
  "use strict";

  var FIREFLY_POSITIONS = [
    { left: "12%", top: "30%", delay: "0s" },
    { left: "22%", top: "52%", delay: "1.1s" },
    { left: "34%", top: "20%", delay: "2.4s" },
    { left: "44%", top: "42%", delay: "0.7s" },
    { left: "64%", top: "24%", delay: "1.9s" },
    { left: "74%", top: "46%", delay: "3.1s" },
    { left: "86%", top: "28%", delay: "0.4s" },
    { left: "89%", top: "64%", delay: "2.7s" },
    { left: "16%", top: "74%", delay: "1.5s" },
    { left: "68%", top: "78%", delay: "2.1s" }
  ];

  function populateFireflies() {
    var layer = document.getElementById("treehouse-fireflies");
    if (!layer || layer.children.length > 0) return;
    FIREFLY_POSITIONS.forEach(function (pos) {
      var dot = document.createElement("span");
      dot.className = "nx-firefly";
      dot.style.left = pos.left;
      dot.style.top = pos.top;
      dot.style.animationDelay = pos.delay;
      layer.appendChild(dot);
    });
  }

  function bindSceneHotspots(svgRoot) {
    var tooltipTitle = document.getElementById("scene-hover-title");
    var tooltipDesc = document.getElementById("scene-hover-desc");
    var rooms = svgRoot.querySelectorAll(".nx-scene-room[data-room-target]");

    function showRoomTooltip(el) {
      if (tooltipTitle) tooltipTitle.textContent = el.getAttribute("data-room-title") || "Treehouse Room";
      if (tooltipDesc) tooltipDesc.textContent = el.getAttribute("data-room-desc") || "";
    }

    function resetTooltip() {
      if (tooltipTitle) tooltipTitle.textContent = "Living Giant Treehouse";
      if (tooltipDesc) tooltipDesc.textContent = "Hover any cozy door, balcony, or window to preview its room — click to enter.";
    }

    rooms.forEach(function (roomEl) {
      roomEl.addEventListener("mouseenter", function () {
        showRoomTooltip(roomEl);
        if (global.NexoraFairy) {
          global.NexoraFairy.setExpression("curious");
        }
      });

      roomEl.addEventListener("mouseleave", function () {
        resetTooltip();
        if (global.NexoraFairy) {
          global.NexoraFairy.setExpression("idle");
        }
      });

      roomEl.addEventListener("focus", function () {
        showRoomTooltip(roomEl);
      });

      roomEl.addEventListener("click", function () {
        var target = roomEl.getAttribute("data-room-target");
        if (target && global.NexoraRouter) {
          global.NexoraRouter.navigateTo(target);
        }
      });

      roomEl.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          var target = roomEl.getAttribute("data-room-target");
          if (target && global.NexoraRouter) {
            global.NexoraRouter.navigateTo(target);
          }
        }
      });
    });

    resetTooltip();
  }

  function loadForestScene() {
    populateFireflies();
    var mount = document.getElementById("treehouse-canvas-mount");
    if (!mount) return Promise.resolve();

    return fetch("/static/assets/svg/forest-scene.svg")
      .then(function (resp) {
        if (!resp.ok) throw new Error("Failed to load forest-scene.svg (" + resp.status + ")");
        return resp.text();
      })
      .then(function (svgText) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(svgText, "image/svg+xml");
        var svgEl = doc.documentElement;
        if (!svgEl || svgEl.nodeName.toLowerCase() !== "svg") {
          throw new Error("Invalid SVG returned for forest scene.");
        }
        mount.innerHTML = "";
        mount.appendChild(document.importNode(svgEl, true));
        bindSceneHotspots(mount.querySelector("svg"));
      })
      .catch(function (err) {
        mount.innerHTML = '<div class="nx-card"><p>Unable to load forest scene: ' + err.message + '</p></div>';
      });
  }

  global.NexoraScene = {
    load: loadForestScene
  };
})(window);
