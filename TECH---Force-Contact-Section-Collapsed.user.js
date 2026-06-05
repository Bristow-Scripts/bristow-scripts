// ==UserScript==
// @name         TECH - Force Contact Section Collapsed
// @match        https://bristow-app.azurewebsites.net/*
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Force-Contact-Section-Collapsed.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Force-Contact-Section-Collapsed.user.js
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @grant        none
// ==/UserScript==
(function () {
    'use strict';

    const TARGET_ID = "#collapseContactInfo";
    let userExpanded = false;
    let collapseTimer = null;
    let observerPaused = false;

    function collapse() {
        const el = document.querySelector(TARGET_ID);
        if (!el) return;
        observerPaused = true;
        el.classList.remove("in");
        el.classList.add("collapse");
        el.style.height = "0px";
        setTimeout(() => { observerPaused = false; }, 50);
    }

    function expand() {
        const el = document.querySelector(TARGET_ID);
        if (!el) return;
        observerPaused = true;
        el.classList.add("in");
        el.classList.remove("collapse");
        el.style.height = "auto";
        setTimeout(() => { observerPaused = false; }, 50);
    }

    function scheduleCollapse(delay = 200) {
        clearTimeout(collapseTimer);
        collapseTimer = setTimeout(() => {
            if (!userExpanded) collapse();
        }, delay);
    }

    // 1. Force collapsed on initial load
    window.addEventListener("load", () => scheduleCollapse(200));

    // 2. Watch for DOM rebuilds (e.g. refreshOrderHeader),
    //    but only react to structural changes — not style/class thrash
    const observer = new MutationObserver((mutations) => {
        if (observerPaused) return;

        const isStructural = mutations.some(m =>
            m.type === "childList" && m.addedNodes.length > 0
        );

        if (!isStructural) return;

        // Only re-collapse if the target element was re-added to the DOM
        const targetRebuilt = mutations.some(m =>
            [...m.addedNodes].some(node =>
                node.nodeType === 1 &&
                (node.matches?.(TARGET_ID) || node.querySelector?.(TARGET_ID))
            )
        );

        if (targetRebuilt) {
            userExpanded = false; // treat a DOM rebuild as a fresh state
            scheduleCollapse(200);
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // 3. Button hooks
    document.addEventListener("click", function (e) {
        const btn = e.target.closest("button");
        if (!btn) return;

        if (btn.textContent.includes("Edit Info")) {
            userExpanded = false;
            scheduleCollapse(300);
        }

        if (btn.textContent.includes("Save")) {
            userExpanded = false;
            scheduleCollapse(300);
        }
    });

    // 4. If the user manually clicks the section toggle, respect it
    document.addEventListener("click", function (e) {
        const toggle = e.target.closest(`[data-target="${TARGET_ID}"], [href="${TARGET_ID}"]`);
        if (!toggle) return;
        // Flip userExpanded based on current state
        const el = document.querySelector(TARGET_ID);
        if (!el) return;
        userExpanded = el.classList.contains("in") ? false : true;
    });

    // Expose manual controls
    window.forceContactCollapse = () => { userExpanded = false; collapse(); };
    window.forceContactExpand   = () => { userExpanded = true;  expand();  };

})();
