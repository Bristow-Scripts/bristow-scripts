// ==UserScript==
// @name         FE - Force Contact Section Expanded
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/FE---Force-Contact-Section-Expanded.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/FE---Force-Contact-Section-Expanded.user.js
// @grant        none
// ==/UserScript==
(function () {
    'use strict';

    const TARGET_ID = "#collapseContactInfo";
    let expandTimer = null;
    let observerPaused = false;

    function expand() {
        const el = document.querySelector(TARGET_ID);
        if (!el) return;
        observerPaused = true;
        el.classList.add("in");
        el.classList.remove("collapse");
        el.style.height = "auto";
        setTimeout(() => { observerPaused = false; }, 50);
    }

    function scheduleExpand(delay = 200) {
        clearTimeout(expandTimer);
        expandTimer = setTimeout(() => expand(), delay);
    }

    // 1. Force expanded on initial load
    window.addEventListener("load", () => scheduleExpand(200));

    // 2. Watch for DOM rebuilds and re-expand if the target was re-added
    const observer = new MutationObserver((mutations) => {
        if (observerPaused) return;

        const targetRebuilt = mutations.some(m =>
            m.type === "childList" &&
            [...m.addedNodes].some(node =>
                node.nodeType === 1 &&
                (node.matches?.(TARGET_ID) || node.querySelector?.(TARGET_ID))
            )
        );

        if (targetRebuilt) scheduleExpand(200);
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // 3. Re-expand after Edit Info or Save actions
    document.addEventListener("click", function (e) {
        const btn = e.target.closest("button");
        if (!btn) return;

        if (btn.textContent.includes("Edit Info") || btn.textContent.includes("Save")) {
            scheduleExpand(300);
        }
    });

    // Expose manual control just in case
    window.forceContactExpand = expand;

})();