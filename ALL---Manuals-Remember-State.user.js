// ==UserScript==
// @name         ALL - Manuals remember state
// @namespace    http://tampermonkey.net/
// @version      3.0
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/ALL---Manuals-Remember-State.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/ALL---Manuals-Remember-State.user.js
// @description  Default expanded, remembers collapse state, re-applies state on re-renders (e.g. after Save button click)
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const KEY = "tm-manuals-collapsed";
    const UPLOADS_KEY = "tm-uploads-collapsed";

    // Check if the section is collapsed from localStorage
    function isCollapsed(key) {
        return localStorage.getItem(key) === "true";
    }

    // Set the collapse state in localStorage (true for collapsed, false for expanded)
    function setCollapsed(key, v) {
        localStorage.setItem(key, v ? "true" : "false");
    }

    // Apply the stored state to the collapse element (expanded/collapsed)
    function applyState(collapse, key) {
        const collapsed = localStorage.getItem(key) !== "true";
        if (collapsed) {
            $(collapse).collapse('show'); // Expand by default if no saved state
        } else {
            $(collapse).collapse('hide'); // Collapse if state is saved as collapsed
        }
    }

    // Only touch the manuals section, leave the uploads section alone
    function buildManualsCollapseIfNeeded() {
        const target = document.querySelector("#collapseAerospace > div:nth-child(5)");
        if (!target) return;

        if (document.querySelector("#tm-manuals-collapse")) return; // Avoid rebuilding if already present

        // Create the wrapper for the manuals section
        const well = document.createElement("div");
        well.className = "well well-sm";
        well.id = "tm-manuals-well";

        // Create the collapse container (Bootstrap 3/4/5 style)
        const collapse = document.createElement("div");
        collapse.className = "row collapse";
        collapse.id = "tm-manuals-collapse";

        // Create the header
        const header = document.createElement("h3");
        header.innerHTML = `
            <a
                class="accordion-toggle"
                data-toggle="collapse"
                data-target="#tm-manuals-collapse"
                aria-expanded="true"
                aria-controls="tm-manuals-collapse"
                style="cursor: pointer;"
            >
                Manuals
            </a>
        `;

        // Insert into the DOM
        target.parentNode.insertBefore(well, target);
        well.appendChild(header);
        well.appendChild(collapse);
        collapse.appendChild(target);

        // Apply the saved state (collapsed/expanded) immediately after injection
        applyState(collapse, KEY);

        // Listen for user actions (collapse/expand) and save the state
        $(collapse).on('shown.bs.collapse', () => setCollapsed(KEY, false));  // Expanded state
        $(collapse).on('hidden.bs.collapse', () => setCollapsed(KEY, true));  // Collapsed state

        console.log("Manuals section injected (default expanded, persistent state)");
    }

    // Skip any changes to the Uploads section completely
    function buildUploadsCollapseIfNeeded() {
        const target = document.querySelector("#collapseDocs");
        if (!target) return;

        // We will leave this section untouched to avoid any interference
        console.log("Uploads section left untouched");
    }

    // Reapply state when a mode switch is detected or when content reloads
    function reapplyState() {
        const collapseManuals = document.querySelector("#tm-manuals-collapse");
        if (collapseManuals) {
            applyState(collapseManuals, KEY);
        }

        // Don't touch the Uploads section; it's intentionally left unchanged
    }

    // Initial calls to build the sections (handles page load)
    buildManualsCollapseIfNeeded();

    // Watch for any DOM changes (e.g., Save button or other dynamic content reloads)
    const observer = new MutationObserver(() => {
        // Rebuild the section and reapply the state if necessary
        buildManualsCollapseIfNeeded();

        // Reapply the collapse state after re-renders (page mode changes or dynamic content reloads)
        reapplyState();
    });

    // Observe the entire body for changes (may include page re-renders)
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Optional: if you want to hook into specific button clicks (like Save button)
    document.addEventListener("click", function (e) {
        const btn = e.target.closest("button");
        if (!btn) return;

        if (btn.textContent.includes("Save")) {
            // After Save, re-apply the saved state for collapse
            setTimeout(() => {
                reapplyState();
            }, 300);  // Delay allows the page re-render to complete
        }
    });

})();
