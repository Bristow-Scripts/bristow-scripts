// ==UserScript==
// @name         TECH - Auto Grow Work Order Description
// @namespace    http://tampermonkey.net/
// @version      1.1
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Auto-Grow-Work-Order-Description.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Auto-Grow-Work-Order-Description.user.js
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    const MIN_HEIGHT = 233; // 👈 set your preferred minimum (px)

    function autoGrow(textarea) {
        if (!textarea) return;

        textarea.style.height = "auto";

        // Use the larger of scrollHeight or MIN_HEIGHT
        const newHeight = Math.max(textarea.scrollHeight, MIN_HEIGHT);
        textarea.style.height = newHeight + "px";
    }

    function init() {
        const textarea = document.getElementById("AerospaceHead_WorkOrderDesc");
        if (!textarea) return;

        textarea.style.resize = "vertical";
        textarea.style.overflow = "hidden";

        // Set minimum height visually too (helps on first render)
        textarea.style.minHeight = MIN_HEIGHT + "px";

        autoGrow(textarea);

        textarea.addEventListener("input", function () {
            autoGrow(textarea);
        });
    }

    window.addEventListener("DOMContentLoaded", init);

    const observer = new MutationObserver(function () {
        if (!document.getElementById("AerospaceHead_WorkOrderDesc")) return;
        init();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

})();
