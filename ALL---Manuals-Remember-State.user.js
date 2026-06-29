// ==UserScript==
// @name         ALL - Manuals remember state
// @namespace    http://tampermonkey.net/
// @version      3.3
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/ALL---Manuals-Remember-State.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/ALL---Manuals-Remember-State.user.js
// @description  Default expanded, remembers collapse state, re-applies state on re-renders (e.g. after Save button click)
// @require      https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Shared-Core.user.js
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    var KEY = "tm-manuals-collapsed";

    function isCollapsed(key) {
        if (window.TechShared) return TechShared.storage.get(key) === "true";
        return localStorage.getItem(key) === "true";
    }

    function setCollapsed(key, v) {
        if (window.TechShared) { TechShared.storage.set(key, v ? "true" : "false"); return; }
        localStorage.setItem(key, v ? "true" : "false");
    }

    function applyState(collapse, key) {
        var collapsed = localStorage.getItem(key) !== "true";
        if (collapsed) {
            $(collapse).collapse('show');
        } else {
            $(collapse).collapse('hide');
        }
    }

    function buildManualsCollapseIfNeeded() {
        var target = document.querySelector("#collapseAerospace > div:nth-child(5)");
        if (!target) return;
        if (document.querySelector("#tm-manuals-collapse")) return;

        var well = document.createElement("div");
        well.className = "well well-sm";
        well.id = "tm-manuals-well";

        var collapse = document.createElement("div");
        collapse.className = "row collapse";
        collapse.id = "tm-manuals-collapse";

        var header = document.createElement("h3");
        header.innerHTML =
            '<a class="accordion-toggle" data-toggle="collapse" ' +
            'data-target="#tm-manuals-collapse" aria-expanded="true" ' +
            'aria-controls="#tm-manuals-collapse" style="cursor:pointer;">Manuals</a>';

        target.parentNode.insertBefore(well, target);
        well.appendChild(header);
        well.appendChild(collapse);
        collapse.appendChild(target);

        applyState(collapse, KEY);

        $(collapse).on('shown.bs.collapse', function () { setCollapsed(KEY, false); });
        $(collapse).on('hidden.bs.collapse', function () { setCollapsed(KEY, true); });
    }

    function reapplyState() {
        var collapseManuals = document.querySelector("#tm-manuals-collapse");
        if (collapseManuals) applyState(collapseManuals, KEY);
    }

    buildManualsCollapseIfNeeded();

    if (window.TechShared) {
        TechShared.observer.register(function () {
            buildManualsCollapseIfNeeded();
            reapplyState();
        }, { debounce: 200 });
    } else {
        var observer = new MutationObserver(function () {
            buildManualsCollapseIfNeeded();
            reapplyState();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    document.addEventListener("click", function (e) {
        var btn = e.target.closest("button");
        if (!btn) return;
        if (btn.textContent.includes("Save")) {
            setTimeout(reapplyState, 300);
        }
    });

})();
