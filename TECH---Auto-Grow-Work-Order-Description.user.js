// ==UserScript==
// @name         TECH - Auto Grow Work Order Description
// @namespace    http://tampermonkey.net/
// @version      1.5
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Auto-Grow-Work-Order-Description.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Auto-Grow-Work-Order-Description.user.js
// @require      https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Shared-Core.user.js
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    var MIN_HEIGHT = 233;

    function autoGrow(textarea) {
        if (!textarea) return;
        textarea.style.height = "auto";
        var newHeight = Math.max(textarea.scrollHeight, MIN_HEIGHT);
        textarea.style.height = newHeight + "px";
    }

    function init() {
        var textarea = document.getElementById("AerospaceHead_WorkOrderDesc");
        if (!textarea) return;
        if (textarea.dataset.autoGrowAttached) return;
        textarea.dataset.autoGrowAttached = "1";

        textarea.style.resize = "vertical";
        textarea.style.overflow = "hidden";
        textarea.style.minHeight = MIN_HEIGHT + "px";

        autoGrow(textarea);

        textarea.addEventListener("input", function () {
            autoGrow(textarea);
        });
    }

    window.addEventListener("DOMContentLoaded", init);

    if (window.TechShared) {
        TechShared.observer.register(function () {
            if (!document.getElementById("AerospaceHead_WorkOrderDesc")) return;
            init();
        }, { debounce: 200 });
    } else {
        var observer = new MutationObserver(function () {
            if (!document.getElementById("AerospaceHead_WorkOrderDesc")) return;
            init();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
})();
