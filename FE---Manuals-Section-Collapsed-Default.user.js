// ==UserScript==
// @name         FE - Manuals Section Collapsed Default
// @namespace    http://tampermonkey.net/
// @version      1.7
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/FE---Manuals-Section-Collapsed-Default.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/FE---Manuals-Section-Collapsed-Default.user.js
// @description  Re-injects collapse after DOM refresh (Kendo/Razor safe)
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    function buildIfNeeded() {
        const target = document.querySelector("#collapseAerospace > div:nth-child(5)");
        if (!target) return;

        // prevent duplicates
        if (document.querySelector("#tm-manuals-collapse")) return;

        // -----------------------------
        // WELL container
        // -----------------------------
        const well = document.createElement("div");
        well.className = "well well-sm";
        well.id = "tm-manuals-well";

        // -----------------------------
        // Header (same as native UI)
        // -----------------------------
        const header = document.createElement("h3");
        header.innerHTML = `
            <a
                class="accordion-toggle collapsed"
                data-toggle="collapse"
                data-target="#tm-manuals-collapse"
                aria-expanded="false"
                aria-controls="tm-manuals-collapse"
                style="cursor: pointer;"
                onmouseover="this.style.cursor='pointer'"
            >
                Manuals
            </a>
        `;

        // -----------------------------
        // Collapse container
        // -----------------------------
        const collapse = document.createElement("div");
        collapse.className = "row collapse";
        collapse.id = "tm-manuals-collapse";

        // insert in correct order
        target.parentNode.insertBefore(well, target);
        well.appendChild(header);
        well.appendChild(collapse);
        collapse.appendChild(target);

        console.log("Manuals section injected");
    }

    // initial run
    buildIfNeeded();

    // -----------------------------
    // IMPORTANT: watch DOM changes
    // -----------------------------
    const observer = new MutationObserver(() => {
        buildIfNeeded();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();
