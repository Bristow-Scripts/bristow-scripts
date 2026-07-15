// ==UserScript==
// @name         TECH - Auto Grow Work Order Description
// @namespace    http://tampermonkey.net/
// @version      1.8
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Auto-Grow-Work-Order-Description.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Auto-Grow-Work-Order-Description.user.js
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @grant        none
// @run-at       document-end
// ==/UserScript==
(function () {
    'use strict';
    var MIN_HEIGHT = 233;
    // Only the WO description textarea gets the forced-size auto-grow treatment
    // while editing. Fields 10/11 stay their natural size in edit mode — they
    // only auto-expand once rendered as read-only view spans (see below).
    var TEXTAREA_IDS = [
        "AerospaceHead_WorkOrderDesc"
    ];
    // Custom field indices that render as read-only <span> in view mode
    var SPAN_FIELD_INDICES = [10, 11];

    function autoGrow(textarea) {
        if (!textarea) return;
        textarea.style.height = "auto";
        var newHeight = Math.max(textarea.scrollHeight, MIN_HEIGHT);
        textarea.style.height = newHeight + "px";
    }

    function attachTextarea(textarea) {
        if (!textarea || textarea.dataset.autoGrowAttached) return;
        textarea.dataset.autoGrowAttached = "1";
        textarea.style.resize = "vertical";
        textarea.style.overflow = "hidden";
        textarea.style.minHeight = MIN_HEIGHT + "px";
        autoGrow(textarea);
        textarea.addEventListener("input", function () {
            autoGrow(textarea);
        });
    }

    function attachSpan(idx) {
        var hiddenLabel = document.getElementById("OrderHead_CustomFields_" + idx + "__Label");
        if (!hiddenLabel) return;
        var td = hiddenLabel.closest("td");
        if (!td) return;
        var span = td.querySelector("span:not(.field-validation-valid):not(.text-danger)");
        if (!span) return;
        // Always (re)apply — cheap, and guards against the site swapping the
        // span's text content in place (a characterData mutation) without
        // ever removing/re-adding the node, which would otherwise leave a
        // stale/unstyled span behind if we only styled it once.
        span.style.display = "block";
        span.style.whiteSpace = "pre";
        span.style.fontFamily = "monospace";
        span.style.overflowX = "auto";
        span.dataset.autoGrowAttached = "1";
    }

    function init() {
        TEXTAREA_IDS.forEach(function (id) {
            attachTextarea(document.getElementById(id));
        });
        SPAN_FIELD_INDICES.forEach(function (idx) {
            attachSpan(idx);
        });
    }

    function anyPresent() {
        var textareaPresent = TEXTAREA_IDS.some(function (id) {
            return document.getElementById(id);
        });
        var spanPresent = SPAN_FIELD_INDICES.some(function (idx) {
            return document.getElementById("OrderHead_CustomFields_" + idx + "__Label");
        });
        return textareaPresent || spanPresent;
    }

    window.addEventListener("DOMContentLoaded", init);
    if (window.TechShared) {
        TechShared.observer.register(function () {
            if (!anyPresent()) return;
            init();
        }, { debounce: 200 });
    } else {
        // characterData: true is the key addition — catches the case where
        // the site updates a span's text in place after Save without
        // replacing the element itself.
        var observer = new MutationObserver(function () {
            if (!anyPresent()) return;
            init();
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
})();
