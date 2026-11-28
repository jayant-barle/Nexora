/* NEXORA — Magical Library Room Controller (Phase 4)
 * Connects read-only top-level file browsing, search, category filtering,
 * pagination for large directories, and real metadata inspection to Python bridge.
 */
(function (global) {
  "use strict";

  var PAGE_SIZE = 60;

  var state = {
    query: "",
    fileType: "all",
    page: 1,
    hasSource: false,
    sourceDir: "",
    files: [],
    totalTopLevel: 0,
    totalMatching: 0,
    totalPages: 1,
    serverPaginated: false,
    subfoldersSkipped: 0,
    typeCounts: { all: 0, image: 0, video: 0, other: 0 },
    selectedPath: null,
    searchTimer: null
  };

  function el(id) {
    return document.getElementById(id);
  }

  function formatCategoryLabel(ftype) {
    if (ftype === "image") return "Image";
    if (ftype === "video") return "Video";
    return "Other";
  }

  function categoryGlyph(ftype) {
    if (ftype === "image") return "🖼";
    if (ftype === "video") return "🎞";
    return "📄";
  }

  function updateCategoryCounts(counts) {
    var safe = counts || { all: 0, image: 0, video: 0, other: 0 };
    if (el("lib-count-all")) el("lib-count-all").textContent = String(safe.all || 0);
    if (el("lib-count-image")) el("lib-count-image").textContent = String(safe.image || 0);
    if (el("lib-count-video")) el("lib-count-video").textContent = String(safe.video || 0);
    if (el("lib-count-other")) el("lib-count-other").textContent = String(safe.other || 0);

    document.querySelectorAll(".nx-filter-pill[data-lib-type]").forEach(function (btn) {
      var active = btn.dataset.libType === state.fileType;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function showShelfState(mode, message) {
    var loadingEl = el("lib-loading");
    var errEl = el("lib-error");
    var emptyEl = el("lib-empty");
    var listEl = el("lib-file-list");
    var pageBar = el("lib-pagination");

    if (loadingEl) loadingEl.hidden = mode !== "loading";
    if (errEl) {
      errEl.hidden = mode !== "error";
      if (mode === "error") errEl.textContent = message || "Could not read files from source folder.";
    }
    if (emptyEl) emptyEl.hidden = mode !== "empty";
    if (listEl) listEl.hidden = mode !== "list";
    if (pageBar && mode !== "list") pageBar.hidden = true;
  }

  function resetDesk(promptText) {
    state.selectedPath = null;
    if (el("lib-desk-idle")) {
      el("lib-desk-idle").hidden = false;
      var noteEl = el("lib-desk-idle-text");
      if (noteEl && promptText) noteEl.textContent = promptText;
    }
    if (el("lib-desk-loading")) el("lib-desk-loading").hidden = true;
    if (el("lib-desk-error")) el("lib-desk-error").hidden = true;
    if (el("lib-desk-content")) el("lib-desk-content").hidden = true;
  }

  function renderInspection(res) {
    if (el("lib-desk-loading")) el("lib-desk-loading").hidden = true;
    if (!res || !res.ok || !res.file) {
      if (el("lib-desk-idle")) el("lib-desk-idle").hidden = true;
      if (el("lib-desk-content")) el("lib-desk-content").hidden = true;
      if (el("lib-desk-error")) {
        el("lib-desk-error").hidden = false;
        el("lib-desk-error").textContent = (res && res.error) || "Unable to inspect file metadata.";
      }
      if (global.NexoraRouter && global.NexoraRouter.notify) {
        global.NexoraRouter.notify((res && res.error) || "Could not open file metadata.", "error");
      }
      return;
    }

    var f = res.file;
    if (el("lib-desk-idle")) el("lib-desk-idle").hidden = true;
    if (el("lib-desk-error")) el("lib-desk-error").hidden = true;
    if (el("lib-desk-content")) el("lib-desk-content").hidden = false;

    var previewImg = el("lib-desk-img");
    var previewBox = el("lib-desk-media-box");
    var previewFallback = el("lib-desk-preview-note");

    if (previewImg && previewBox && previewFallback) {
      if (f.preview_url) {
        previewFallback.hidden = true;
        previewImg.hidden = false;
        previewImg.alt = f.name;
        previewImg.onerror = function () {
          previewImg.hidden = true;
          previewFallback.hidden = false;
          previewFallback.textContent = f.image_error || "Image could not be decoded for preview.";
        };
        previewImg.src = f.preview_url;
      } else {
        previewImg.hidden = true;
        previewImg.removeAttribute("src");
        previewFallback.hidden = false;
        previewFallback.textContent = f.preview_note || "Preview not available for this file type.";
      }
    }

    el("lib-meta-name").textContent = f.name;
    el("lib-meta-type").textContent = formatCategoryLabel(f.type) + " (" + f.extension + ")";
    el("lib-meta-size").textContent = f.size_formatted + " (" + f.size.toLocaleString() + " bytes)";
    el("lib-meta-dims").textContent = f.dimensions || (f.type === "image" ? "Unavailable" : "Not applicable");
    el("lib-meta-exif").textContent = f.exif_date
      ? f.exif_date + " -> " + f.exif_folder
      : (f.type === "video" ? "Videos never use metadata dates" : "No EXIF DateTimeOriginal");
    el("lib-meta-name-rule").textContent = f.name_rule_candidate
      ? f.name_rule_candidate + "/"
      : (f.supported ? "None found" : "Skipped (unsupported extension)");

    var scanInfo = f.scan_cache || {};
    var scanText = "Not yet scanned in faces.json";
    if (scanInfo.unreadable_reason) {
      scanText = "Marked unreadable: " + scanInfo.unreadable_reason;
    } else if (scanInfo.cached) {
      var people = scanInfo.people_labels && scanInfo.people_labels.length > 0
        ? " — " + scanInfo.people_labels.join(", ")
        : "";
      scanText = "Cached (" + (scanInfo.faces_detected || 0) + " face(s)" + people + ")";
    }
    el("lib-meta-faces").textContent = scanText;
    el("lib-meta-rule").textContent = f.placement_summary || "Unsorted";
    el("lib-meta-safety-note").textContent = res.safety_note || "";
  }

  function inspectFile(filePath) {
    state.selectedPath = filePath;
    highlightSelectedRow();

    if (el("lib-desk-idle")) el("lib-desk-idle").hidden = true;
    if (el("lib-desk-error")) el("lib-desk-error").hidden = true;
    if (el("lib-desk-content")) el("lib-desk-content").hidden = true;
    if (el("lib-desk-loading")) el("lib-desk-loading").hidden = false;

    global.NexoraApi.call("inspect_source_file", filePath)
      .then(function (res) {
        if (state.selectedPath !== filePath) return;
        renderInspection(res);
      })
      .catch(function (err) {
        if (state.selectedPath !== filePath) return;
        renderInspection({ ok: false, error: err && err.message ? err.message : "Inspection error." });
      });
  }

  function highlightSelectedRow() {
    var listEl = el("lib-file-list");
    if (!listEl) return;
    listEl.querySelectorAll(".nx-lib-row").forEach(function (rowBtn) {
      var selected = rowBtn.dataset.filePath === state.selectedPath;
      rowBtn.classList.toggle("is-selected", selected);
      rowBtn.setAttribute("aria-current", selected ? "true" : "false");
    });
  }

  function renderEmptyBanner() {
    var titleEl = el("lib-empty-title");
    var descEl = el("lib-empty-desc");
    var pickBtn = el("lib-empty-pick-btn");
    var resetBtn = el("lib-empty-reset-btn");

    if (!state.hasSource) {
      if (titleEl) titleEl.textContent = "No Source Folder Selected Yet";
      if (descEl) descEl.textContent = "Choose a folder above to browse its top-level photos, videos, and other files without altering anything.";
      if (pickBtn) pickBtn.hidden = false;
      if (resetBtn) resetBtn.hidden = true;
    } else if (state.totalTopLevel === 0) {
      if (titleEl) titleEl.textContent = "This Shelf Has No Top-Level Files";
      var subMsg = state.subfoldersSkipped > 0
        ? " (" + state.subfoldersSkipped + " subfolder(s) intentionally skipped by Nexora's top-level safety rule.)"
        : "";
      if (descEl) descEl.textContent = "No files were found directly inside the selected source folder" + subMsg;
      if (pickBtn) pickBtn.hidden = false;
      if (resetBtn) resetBtn.hidden = true;
    } else {
      if (titleEl) titleEl.textContent = "No Files Match Current Filters";
      if (descEl) descEl.textContent = "Try clearing your search query or switching back to All Categories.";
      if (pickBtn) pickBtn.hidden = true;
      if (resetBtn) resetBtn.hidden = false;
    }
    showShelfState("empty");
  }

  function renderPage() {
    var listEl = el("lib-file-list");
    var summaryEl = el("lib-summary-bar");
    var pageBar = el("lib-pagination");
    var pageLabel = el("lib-page-label");
    var prevBtn = el("lib-prev-page");
    var nextBtn = el("lib-next-page");

    var total = state.totalMatching || state.files.length;
    if (!state.hasSource || total === 0 || state.files.length === 0) {
      if (summaryEl) {
        summaryEl.textContent = state.hasSource
          ? state.totalTopLevel + " top-level file(s) (" + state.subfoldersSkipped + " subfolder(s) skipped)"
          : "No source folder chosen";
      }
      renderEmptyBanner();
      return;
    }

    var totalPages = state.totalPages || Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    if (state.page < 1) state.page = 1;

    var startIdx = (state.page - 1) * PAGE_SIZE;
    var slice = state.serverPaginated ? state.files : state.files.slice(startIdx, startIdx + PAGE_SIZE);
    var endIdx = startIdx + slice.length;

    if (summaryEl) {
      var skipText = state.subfoldersSkipped > 0
        ? " · " + state.subfoldersSkipped + " subfolder(s) skipped"
        : "";
      summaryEl.textContent = "Showing " + (startIdx + 1) + "–" + endIdx + " of " + total + " matching files" + skipText;
    }

    listEl.innerHTML = "";
    slice.forEach(function (fileItem) {
      var rowBtn = document.createElement("button");
      rowBtn.type = "button";
      rowBtn.className = "nx-lib-row";
      rowBtn.dataset.filePath = fileItem.path;
      if (fileItem.path === state.selectedPath) {
        rowBtn.classList.add("is-selected");
        rowBtn.setAttribute("aria-current", "true");
      }

      var thumbWrap = document.createElement("span");
      thumbWrap.className = "nx-lib-thumb nx-lib-thumb-" + fileItem.type;
      if (fileItem.preview_url) {
        var img = document.createElement("img");
        img.src = fileItem.preview_url;
        img.alt = "";
        img.loading = "lazy";
        img.onerror = function () {
          thumbWrap.textContent = categoryGlyph(fileItem.type);
        };
        thumbWrap.appendChild(img);
      } else {
        thumbWrap.textContent = categoryGlyph(fileItem.type);
      }

      var mainCol = document.createElement("span");
      mainCol.className = "nx-lib-row-main";

      var nameSpan = document.createElement("span");
      nameSpan.className = "nx-lib-row-name";
      nameSpan.textContent = fileItem.name;

      var subSpan = document.createElement("span");
      subSpan.className = "nx-lib-row-sub";
      subSpan.textContent = fileItem.rule_hint + " · " + fileItem.size_formatted;

      mainCol.appendChild(nameSpan);
      mainCol.appendChild(subSpan);

      var badge = document.createElement("span");
      badge.className = "nx-pill-badge";
      if (fileItem.type === "image") badge.classList.add("is-good");
      else if (fileItem.type === "other") badge.classList.add("is-warn");
      badge.textContent = formatCategoryLabel(fileItem.type);

      rowBtn.appendChild(thumbWrap);
      rowBtn.appendChild(mainCol);
      rowBtn.appendChild(badge);

      rowBtn.addEventListener("click", function () {
        inspectFile(fileItem.path);
      });

      listEl.appendChild(rowBtn);
    });

    showShelfState("list");

    if (pageBar && pageLabel && prevBtn && nextBtn) {
      pageBar.hidden = totalPages <= 1;
      pageLabel.textContent = "Page " + state.page + " of " + totalPages;
      prevBtn.disabled = state.page <= 1;
      nextBtn.disabled = state.page >= totalPages;
    }
  }

  function refreshLibrary(preserveSelection) {
    if (!preserveSelection) {
      state.page = 1;
    }

    var srcBadge = el("lib-source-badge");
    showShelfState("loading");

    return global.NexoraApi.call("list_source_files", state.query, state.fileType, state.page, PAGE_SIZE)
      .then(function (res) {
        if (!res || !res.ok) {
          updateCategoryCounts({ all: 0, image: 0, video: 0, other: 0 });
          showShelfState("error", (res && res.error) || "Could not load source folder.");
          resetDesk("Resolve the source folder error to inspect files.");
          if (global.NexoraRouter && global.NexoraRouter.notify && res && res.error) {
            global.NexoraRouter.notify(res.error, "error");
          }
          return res;
        }

        state.hasSource = Boolean(res.has_source);
        state.sourceDir = res.source_dir || "";
        state.files = res.files || [];
        state.totalTopLevel = res.total_top_level || 0;
        state.totalMatching = typeof res.filtered_count === "number" ? res.filtered_count : state.files.length;
        state.serverPaginated = typeof res.total_pages === "number";
        state.totalPages = res.total_pages || Math.max(1, Math.ceil(state.totalMatching / PAGE_SIZE));
        if (typeof res.page === "number") state.page = res.page;
        state.subfoldersSkipped = res.subfolders_skipped || 0;
        state.typeCounts = res.type_counts || {
          all: state.totalTopLevel,
          image: 0,
          video: 0,
          other: 0
        };

        if (srcBadge) {
          srcBadge.textContent = state.hasSource ? state.sourceDir : "No source folder chosen";
          srcBadge.title = state.sourceDir || "No source folder chosen";
        }

        updateCategoryCounts(state.typeCounts);

        var selectedStillVisible = state.selectedPath && state.files.some(function (f) {
          return f.path === state.selectedPath;
        });
        if (!selectedStillVisible) {
          resetDesk(
            state.hasSource
              ? "Select any scroll or photo from the shelf to inspect its real EXIF date, name rule token, and preview."
              : "Select a source folder to begin browsing files in the Magical Library."
          );
        }

        renderPage();
        return res;
      })
      .catch(function (err) {
        showShelfState("error", err && err.message ? err.message : "Failed to load Magical Library.");
        resetDesk("Unable to inspect files while folder listing is unavailable.");
      });
  }

  function resetFilters() {
    state.query = "";
    state.fileType = "all";
    state.page = 1;
    var searchInput = el("lib-search-input");
    if (searchInput) searchInput.value = "";
    refreshLibrary(false);
  }

  function bindLibraryEvents() {
    var searchInput = el("lib-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", function () {
        state.query = searchInput.value || "";
        state.page = 1;
        if (state.searchTimer) clearTimeout(state.searchTimer);
        state.searchTimer = setTimeout(function () {
          refreshLibrary(false);
        }, 120);
      });
    }

    var clearSearchBtn = el("lib-clear-search-btn");
    if (clearSearchBtn) {
      clearSearchBtn.addEventListener("click", resetFilters);
    }

    var emptyResetBtn = el("lib-empty-reset-btn");
    if (emptyResetBtn) {
      emptyResetBtn.addEventListener("click", resetFilters);
    }

    document.querySelectorAll(".nx-filter-pill[data-lib-type]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (searchInput) state.query = searchInput.value || "";
        state.fileType = btn.dataset.libType || "all";
        state.page = 1;
        refreshLibrary(false);
      });
    });

    var refreshBtn = el("lib-refresh-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () {
        refreshLibrary(true);
      });
    }

    var pickSourceInline = function () {
      var topPick = document.getElementById("btn-pick-source");
      if (topPick) topPick.click();
    };
    if (el("lib-pick-source-btn")) el("lib-pick-source-btn").addEventListener("click", pickSourceInline);
    if (el("lib-empty-pick-btn")) el("lib-empty-pick-btn").addEventListener("click", pickSourceInline);

    if (el("lib-prev-page")) {
      el("lib-prev-page").addEventListener("click", function () {
        if (state.page > 1) {
          state.page -= 1;
          refreshLibrary(true);
        }
      });
    }

    if (el("lib-next-page")) {
      el("lib-next-page").addEventListener("click", function () {
        var totalPages = state.totalPages || Math.max(1, Math.ceil(state.files.length / PAGE_SIZE));
        if (state.page < totalPages) {
          state.page += 1;
          refreshLibrary(true);
        }
      });
    }
  }

  document.addEventListener("DOMContentLoaded", bindLibraryEvents);

  global.NexoraLibrary = {
    refresh: refreshLibrary,
    inspectFile: inspectFile,
    resetFilters: resetFilters,
    getState: function () { return state; }
  };
})(window);
