// ==UserScript==
// @name         ALL - Uniform Date Format (DD-MMM-YYYY)
// @namespace    https://bristow-scripts.github.io/bristow-scripts
// @version      1.3
// @description  Reformats all visible dates on the page to DD-MMM-YYYY
// @match        https://bristow-app.azurewebsites.net/*
// @noframes
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/ALL---Uniform-Date-Format-DD-MMM-YYYY.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/ALL---Uniform-Date-Format-DD-MMM-YYYY.user.js
// @tag          ALL
// ==/UserScript==

(function () {
    'use strict';

    const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

    // Primary: ISO YYYY-MM-DD (matches your data). Fallbacks below just in case.
    const DATE_PATTERNS = [
        { re: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, order: ['y', 'm', 'd'] }, // 2025-08-06
        { re: /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/, order: ['m', 'd', 'y'] }, // 08/06/2025 (US fallback)
    ];

    function toDDMMMYYYY(y, m, d) {
        y = parseInt(y, 10);
        m = parseInt(m, 10);
        d = parseInt(d, 10);
        if (m < 1 || m > 12 || d < 1 || d > 31) return null;
        const dd = String(d).padStart(2, '0');
        return `${dd}-${MONTHS[m - 1]}-${y}`;
    }

    function reformatString(str) {
        for (const { re, order } of DATE_PATTERNS) {
            const match = str.match(re);
            if (!match) continue;
            const parts = {};
            order.forEach((key, i) => { parts[key] = match[i + 1]; });
            const formatted = toDDMMMYYYY(parts.y, parts.m, parts.d);
            if (formatted) {
                return str.replace(re, formatted);
            }
        }
        return null;
    }

    function processTextNode(node) {
        const text = node.nodeValue;
        if (!text || !/\d{4}/.test(text)) return; // quick pre-filter, avoids wasted regex work
        const formatted = reformatString(text);
        if (formatted && formatted !== text) {
            node.nodeValue = formatted;
        }
    }

    // Inputs: Kendo writes the date to the .value PROPERTY, not the attribute,
    // so getAttribute('value') is empty here.
    function reformatInput(input) {
        if (!input || typeof input.value !== 'string' || !input.value) return;
        const formatted = reformatString(input.value);
        if (formatted && formatted !== input.value) {
            input.value = formatted;
        }
    }

    // Picking a date from the calendar is programmatic (no DOM event/mutation),
    // so hook the Kendo widget itself so the format sticks.
    function hookDatepicker(input) {
        if (!input || input._dateHooked) return;
        input._dateHooked = true;
        try {
            const w = window.kendo && window.kendo.widgetInstance && window.kendo.widgetInstance(input);
            if (w && w.bind) {
                ['change', 'open', 'close'].forEach(ev => w.bind(ev, () => reformatInput(input)));
            }
        } catch (e) {}
        input.addEventListener('change', () => reformatInput(input));
        input.addEventListener('blur', () => reformatInput(input));
    }

    function processElementAttributes(el) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
        if (el.tagName === 'INPUT') {
            reformatInput(el);
            const isPicker = (el.getAttribute && el.getAttribute('data-role') === 'datepicker') ||
                (el.parentElement && String(el.parentElement.className || '').includes('k-datepicker'));
            if (isPicker) hookDatepicker(el);
        }
        ['title', 'value', 'placeholder'].forEach(attr => {
            if (!el.getAttribute || !el.getAttribute(attr)) return;
            const val = el.getAttribute(attr);
            const formatted = reformatString(val);
            if (formatted && formatted !== val) {
                el.setAttribute(attr, formatted);
            }
        });
    }

    function walkAndFormat(root) {
        if (!root) return;
        if (root.nodeType === Node.TEXT_NODE) {
            processTextNode(root);
            return;
        }
        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode(node) {
                    const tag = node.parentElement && node.parentElement.tagName;
                    if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );
        const nodes = [];
        let n;
        while ((n = walker.nextNode())) nodes.push(n);
        nodes.forEach(processTextNode);

        if (root.querySelectorAll) {
            root.querySelectorAll('input, span, td, div').forEach(processElementAttributes);
        }
    }

    // Initial pass
    walkAndFormat(document.body);

    // Watch for Kendo grid re-renders / async content, AND attribute changes
    // (grids occasionally re-write the value attribute on refresh).
    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            if (m.type === 'attributes') {
                processElementAttributes(m.target);
            } else if (m.addedNodes) {
                m.addedNodes.forEach(walkAndFormat);
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['value', 'title', 'placeholder']
    });
})();