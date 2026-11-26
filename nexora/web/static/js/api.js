/* NEXORA — Safe PyWebView Bridge Client (Vanilla JS) */
(function (global) {
  "use strict";

  var bridgeReadyPromise = null;

  function waitForBridge() {
    if (global.pywebview && global.pywebview.api) {
      return Promise.resolve(global.pywebview.api);
    }
    if (!bridgeReadyPromise) {
      bridgeReadyPromise = new Promise(function (resolve, reject) {
        var settled = false;
        function done() {
          if (!settled && global.pywebview && global.pywebview.api) {
            settled = true;
            resolve(global.pywebview.api);
          }
        }
        global.addEventListener("pywebviewready", done, { once: true });
        var tries = 0;
        var timer = setInterval(function () {
          tries += 1;
          if (global.pywebview && global.pywebview.api) {
            clearInterval(timer);
            done();
          } else if (tries > 100) {
            clearInterval(timer);
            if (!settled) {
              reject(new Error("PyWebView bridge did not become ready."));
            }
          }
        }, 50);
      });
    }
    return bridgeReadyPromise;
  }

  function callApi(methodName) {
    var args = Array.prototype.slice.call(arguments, 1);
    return waitForBridge().then(function (api) {
      if (typeof api[methodName] !== "function") {
        throw new Error("Bridge method not available: " + methodName);
      }
      return api[methodName].apply(api, args);
    });
  }

  global.NexoraApi = {
    waitForBridge: waitForBridge,
    call: callApi
  };
})(window);
