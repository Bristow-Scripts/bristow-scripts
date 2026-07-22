// ==UserScript==
// @name         TECH - Expanded / Auto Labor / Time Panel
// @namespace    http://tampermonkey.net/
// @version      9.5
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Auto-Add-Labor-Tech-Time-Panel.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Auto-Add-Labor-Tech-Time-Panel.user.js
// @description  Uses TechShared core for observer management, polling, and DOM helpers.
// @require      https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Shared-Core.user.js
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @grant        none
// @run-at       document-end
// ==/UserScript==

// =========================================================================
// ORIGINAL SCRIPT 1: TECH - Time Expanded Section Trimmed
// =========================================================================
(function () {
    'use strict';
    var BR_MAX_IFRAME_HEIGHT = 5000;

    function hideExtraIframeUI(doc) {
        if (doc.documentElement.dataset.brUiHidden === "1") return;
        doc.documentElement.dataset.brUiHidden = "1";

        // Hide filter label-card groups by label text
        doc.querySelectorAll(".form-group.label-card").forEach(function (group) {
            var label = group.querySelector(".control-label");
            if (!label) return;
            var text = label.textContent.trim();
            if (["Sub Category", "Activity", "Task", "Checklist"].indexOf(text) !== -1) {
                group.style.display = "none";
            }
        });

        // Hide the standalone filter controls (category select, etc.)
        var filterIds = ['ServiceCategorySearch', 'ServiceNumberSearch', 'ServiceAltServiceNumberSearch'];
        filterIds.forEach(function (id) {
            var el = doc.getElementById(id);
            if (!el) return;
            var parent = el.closest('.col-md-2, .col-md-3, .col-md-4, .form-group');
            if (parent) { parent.style.display = 'none'; } else { el.style.display = 'none'; }
        });

        doc.querySelectorAll('a[href*="ServiceTimeTracking"]').forEach(function (el) {
            el.style.display = "none";
        });

        doc.querySelectorAll("tr").forEach(function (tr) {
            var th = tr.querySelector("th");
            if (!th) return;
            var label = th.textContent.trim();
            if (label === "Output" || label === "Job Status") {
                tr.style.display = "none";
            }
        });

        doc.querySelectorAll("label").forEach(function (lbl) {
            if (lbl.textContent.trim() === "Service Tags") {
                lbl.style.display = "none";
            }
        });
    }

    function hideOrderLineColumns(doc) {
        if (doc.documentElement.dataset.brColsHidden === "1") return;
        doc.documentElement.dataset.brColsHidden = "1";

        // ── Hide Cost, Markup, Price, Per, Subtotal columns ──
        // Headers
        doc.querySelectorAll('tr.lq-table-header-w-options th').forEach(function (th) {
            var label = th.textContent.trim();
            if (['Cost', 'Markup', 'Price', 'Per', 'Subtotal'].indexOf(label) !== -1) {
                th.style.display = 'none';
            }
        });
        // Line item data cells
        ['OrderLineCostMask_', 'OrderLineMarkup_', 'OrderLinePriceMask_', 'OrderLinePricedPerDefault_', 'OrderLineSubtotal_'].forEach(function (prefix) {
            doc.querySelectorAll('tr.line-item > td:has(input[id^="' + prefix + '"])').forEach(function (td) {
                td.style.display = 'none';
            });
        });
        // Source line data cells
        ['OrderLineSourceCost_', 'OrderLineSourceMarkup_', 'OrderLineSourcePrice_', 'OrderLineSourceSubtotal_'].forEach(function (prefix) {
            doc.querySelectorAll('tr.sourceLine > td:has(input[id^="' + prefix + '"])').forEach(function (td) {
                td.style.display = 'none';
            });
        });
        // Source line "Per Unit" column (no input — nth-child 8)
        doc.querySelectorAll('tr.sourceLine > td:nth-child(8)').forEach(function (td) {
            td.style.display = 'none';
        });
    }

    function removeInternalScrollContainers(doc) {
        if (doc.documentElement.dataset.brScrollFixed === "1") return;
        doc.documentElement.dataset.brScrollFixed = "1";

        doc.querySelectorAll('*').forEach(function (el) {
            if (el.closest('.k-animation-container, .k-list-container, .k-popup, .k-grid-header')) return;
            var cs = doc.defaultView.getComputedStyle(el);
            var isScrollable = (cs.overflowY === 'auto' || cs.overflowY === 'scroll' || cs.overflowY === 'overlay');
            var isHeightConstrained =
                (cs.maxHeight && cs.maxHeight !== 'none') ||
                (cs.height && cs.height !== 'auto');

            if (isScrollable && (cs.overflowY !== 'auto' || isHeightConstrained)) {
                el.style.overflowY = 'visible';
                el.style.maxHeight = 'none';
            }
        });
    }

    function pollResizeUntilStable(iframe) {
        if (iframe.dataset.brPollDone === "1") return;
        if (iframe.dataset.brPolling === "1") return;
        iframe.dataset.brPolling = "1";

        var stableCount = 0;
        var lastHeight = -1;
        var attempts = 0;
        var maxAttempts = 30;

        var poll = setInterval(function () {
            attempts++;
            try {
                var doc = iframe.contentDocument || iframe.contentWindow.document;
                if (!doc || !doc.body) return;
                var h = Math.min(Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight, 300), BR_MAX_IFRAME_HEIGHT);
                if (h !== lastHeight) {
                    iframe.style.height = (h + 20) + "px";
                    lastHeight = h;
                    stableCount = 0;
                } else {
                    stableCount++;
                }
                if (stableCount >= 3 || attempts >= maxAttempts) {
                    clearInterval(poll);
                    iframe.dataset.brPolling = "0";
                    iframe.dataset.brPollDone = "1";
                }
            } catch (e) {
                clearInterval(poll);
                iframe.dataset.brPolling = "0";
                iframe.dataset.brPollDone = "1";
            }
        }, 200);
    }

    function observeIframeHeight(iframe) {
        if (iframe.dataset.brResizeObserverAttached === "1") return;
        try {
            var doc = iframe.contentDocument || iframe.contentWindow.document;
            if (!doc || !doc.documentElement) return;

            var applyingSelf = false;
            var stableCount = 0;
            var lastApplied = -1;

            var ro = new ResizeObserver(function () {
                if (applyingSelf) return;

                var h = Math.min(Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight, 300), BR_MAX_IFRAME_HEIGHT);
                var target = h + 20;

                if (Math.abs(target - lastApplied) < 10) {
                    stableCount++;
                    if (stableCount >= 3) {
                        if (h >= BR_MAX_IFRAME_HEIGHT) {
                            console.warn("[Trim] Iframe hit max height cap - content may be taller than expected");
                        }
                        ro.disconnect();
                    }
                    return;
                }

                stableCount = 0;
                lastApplied = target;
                applyingSelf = true;
                iframe.style.height = target + "px";
                requestAnimationFrame(function () {
                    requestAnimationFrame(function () { applyingSelf = false; });
                });
            });

            ro.observe(doc.documentElement);
            iframe.dataset.brResizeObserverAttached = "1";
        } catch (e) {
            console.warn("[Trim] Could not attach ResizeObserver", e);
        }
    }

    function neutralizeIframeBackground(doc) {
        if (doc.getElementById("br-trim-style-overrides")) return;
        var style = doc.createElement("style");
        style.id = "br-trim-style-overrides";
        style.textContent = [
            "html, body { background: #fff !important; }",
            "tr.lq-table-header-w-options th:nth-child(3),",
            "tr.lq-table-header-w-options th:nth-child(4),",
            "tr.lq-table-header-w-options th:nth-child(5),",
            "tr.lq-table-header-w-options th:nth-child(6),",
            "tr.lq-table-header-w-options th:nth-child(8),",
            "tr.line-item > td:nth-child(3),",
            "tr.line-item > td:nth-child(4),",
            "tr.line-item > td:nth-child(5),",
            "tr.line-item > td:nth-child(6),",
            "tr.line-item > td:nth-child(8),",
            "tr.sourceLine > td:nth-child(5),",
            "tr.sourceLine > td:nth-child(6),",
            "tr.sourceLine > td:nth-child(7),",
            "tr.sourceLine > td:nth-child(8),",
            "tr.sourceLine > td:nth-child(10) { display: none !important; }"
        ].join('\n');
        doc.head.appendChild(style);
    }

    if (window !== window.top) return;

    function findJobLink() {
        var link = document.querySelector("a.monospaced[href*='Orders/Jobs/Edit']");
        return link ? link.href : null;
    }

    function waitForJobLink() {
        return new Promise(function (resolve) {
            var existing = findJobLink();
            if (existing) return resolve(existing);

            if (window.TechShared) {
                TechShared.poll('jobLink', findJobLink, function (link) {
                    resolve(link);
                }, 20000);
                return;
            }

            var observer = new MutationObserver(function () {
                var link = findJobLink();
                if (link) {
                    observer.disconnect();
                    resolve(link);
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
            setTimeout(function () { observer.disconnect(); resolve(null); }, 20000);
        });
    }

    function refreshServiceGrid(doc, win) {
        try {
            var gridEl = doc.getElementById('serviceGrid');
            if (!gridEl) return;
            var $ = win.jQuery;
            // Try Kendo Grid
            var grid = $(gridEl).data('kendoGrid');
            if (grid && grid.dataSource) {
                grid.dataSource.read();
                return;
            }
            // Fallback: try refreshLines
            if (typeof win.refreshLines === 'function') {
                win.refreshLines();
            }
        } catch (e) {
            console.warn("[Trim] Could not refresh grid", e);
        }
    }

    function preloadServiceFilters(iframe, doc) {
        if (iframe.dataset.brFiltersPreloaded === "1") return;

        try {
            var win = iframe.contentWindow;
            var $ = win.jQuery;

            // Find ALL tag combos, fetch each, and use the one containing "Hourly"
            var tagInputs = doc.querySelectorAll('input[data-role="combobox"][id^="TagSearch_"]');
            var categorySelect = doc.getElementById("ServiceCategorySearch");

            if (!categorySelect) {
                var retries = parseInt(iframe.dataset.brFilterRetries || "0");
                if (retries < 3) {
                    iframe.dataset.brFilterRetries = String(retries + 1);
                    setTimeout(function () {
                        preloadServiceFilters(iframe, doc);
                    }, 1500);
                }
                return;
            }

            iframe.dataset.brFiltersPreloaded = "1";

            // Category select: native DOM change event (run this regardless of combo)
            try {
                var otherOption = Array.from(categorySelect.options).find(function (o) {
                    return o.text.trim() === "OTHER";
                });
                if (otherOption) {
                    categorySelect.value = otherOption.value;
                    if (typeof win.serviceCategorySearch === 'function') {
                        win.serviceCategorySearch();
                    }
                    categorySelect.dispatchEvent(new Event('change'));
                }
            } catch (e) {
                console.warn("[Trim] Could not set category filter", e);
            }

            // Discover the Task tag combo by probing combos for "Hourly"
            var combos = [];
            if ($ && tagInputs) {
                Array.from(tagInputs).forEach(function (input) {
                    var c = $(input).data("kendoComboBox");
                    if (c) {
                        var url = c.dataSource && c.dataSource.transport && c.dataSource.transport.options && c.dataSource.transport.options.read && c.dataSource.transport.options.read.url;
                        // Skip part catalog combos — only service combos have "Hourly"
                        if (url && url.indexOf('/Parts/') !== -1) return;
                        combos.push({ combo: c, url: url || '?' });
                    }
                });
            }
            console.log('[Trim] Found ' + combos.length + ' service combo(s)');

            // Probe each combo's data to find "Hourly"
            var combo = null;
            var match = null;
            var probeIdx = 0;

            function probeNext() {
                if (probeIdx >= combos.length) {
                    console.warn('[Trim] No combo contains "Hourly"');
                    return;
                }
                var entry = combos[probeIdx];
                var sep = entry.url.indexOf('?') > -1 ? '&' : '?';
                console.log('[Trim] Probing #' + probeIdx + ': ' + entry.url);
                $.ajax({
                    url: entry.url + sep + 'take=9999',
                    dataType: "json",
                    success: function (data) {
                        var items = data;
                        if (data && data.Data) items = data.Data;
                        if (Array.isArray(items)) {
                            var m = items.find(function (item) {
                                return item.Text && item.Text.toLowerCase().indexOf("hourly") !== -1;
                            });
                            if (m) {
                                combo = entry.combo;
                                match = m;
                                console.log('[Trim] Found "Hourly" in combo #' + probeIdx + ': ' + match.Text + ' = ' + match.Value);
                                setupComboAndGrid();
                                return;
                            }
                        }
                        probeIdx++;
                        probeNext();
                    },
                    error: function () {
                        probeIdx++;
                        probeNext();
                    }
                });
            }

            function setupComboAndGrid() {
                // 1. Display the text in the input box
                var rawInput = combo.input ? (combo.input[0] || combo.input) : null;
                if (rawInput) {
                    rawInput.value = match.Text;
                }
                // 2. Set Kendo internal state so combo.value() returns the UUID
                combo._value = match.Value;
                combo._selectedValue = match.Value;
                combo._selectedText = match.Text;
                // 3. Override combo.value() getter (ensures any internal code reads the UUID)
                var _origVal = combo.value.bind(combo);
                combo.value = function (val) {
                    return val !== undefined ? _origVal(val) : match.Value;
                };
                // 4. Set combobox value via Kendo's public API (may fail in virtual mode, but best-effort)
                try { combo.value(match.Value); } catch (e) { /* virtual mode - ignore */ }
                // 5. Disable server operations (use internal Kendo properties)
                var grid = doc.getElementById('serviceGrid') && $(doc.getElementById('serviceGrid')).data('kendoGrid');
                if (grid && grid.dataSource) {
                    var ds = grid.dataSource;
                    ds._serverPaging = false;
                    ds._serverSorting = false;
                    ds._serverFiltering = false;
                    // Hook schema.parse to filter every response by Task
                    if (ds.options && ds.options.schema) {
                        var schema = ds.options.schema;
                        var origParse = schema.parse;
                        schema.parse = function (response) {
                            if (response && Array.isArray(response.Data)) {
                                response.Data = response.Data.filter(function (svc) {
                                    return svc.ServiceTags && svc.ServiceTags.some(function (tag) {
                                        return tag.TagTypeName === "Task" && tag.TagValue && tag.TagValue.trim().toLowerCase() === "hourly";
                                    });
                                });
                                response.Total = response.Data.length;
                            }
                            return origParse ? origParse(response) : response;
                        };
                    }
                }
                // 6. Trigger the page's own serviceTagSearch handler (which reads combo.value())
                if (typeof win.serviceTagSearch === 'function') {
                    win.serviceTagSearch();
                }
                // 7. Watchdog
                var ticks = 0;
                var watchdog = setInterval(function () {
                    if (rawInput && rawInput.value !== match.Text) {
                        rawInput.value = match.Text;
                    }
                    if (++ticks > 10) clearInterval(watchdog);
                }, 100);
                console.log('[Trim] Set combo value to:', combo.value ? combo.value() : '?');
                combo.close();
                refreshServiceGrid(doc, win);
            }

            probeNext();
        } catch (e) {
            console.warn("[Trim] Could not preload service filters", e);
            iframe.dataset.brFiltersPreloaded = "0";
        }
    }

    function removeStuffFromIframe(iframe) {
        try {
            var doc = iframe.contentDocument || iframe.contentWindow.document;
            if (!doc) return;

            if (!doc.querySelector('#serviceGrid')) {
                console.log('[Trim] Grid not ready yet - skipping');
                return;
            }

            console.log('[Trim] Grid ready - performing cleanup');
            neutralizeIframeBackground(doc);
            // removeInternalScrollContainers(doc);  // can cause whitespace (removes overflow constraints)
            preloadServiceFilters(iframe, doc);
            hideExtraIframeUI(doc);

            doc.querySelectorAll('a.btn.btn-default[href="#HeaderTarget"]').forEach(el => el.remove());
            doc.querySelectorAll('a.btn.btn-default[href="#AddPartTarget"]').forEach(el => el.remove());
            doc.querySelectorAll('a.btn.btn-default[href="#CommentsTarget"]').forEach(el => el.remove());

            var navbar = doc.querySelector("nav.navbar");
            if (navbar) navbar.remove();

            var jumpLinks = doc.querySelectorAll(
                'a[href="#HeaderTarget"], a[href="#AddPartTarget"], a[href="#RQsTarget"], a[href="#CommentsTarget"]'
            );

            jumpLinks.forEach(function (link) {
                var container = link.closest(".col-md-4");
                if (container) container.remove();
            });

            var commentsTarget = doc.getElementById("CommentsTarget");
            if (commentsTarget) {
                var section = commentsTarget.closest(".row.content-group");
                if (section) section.remove();
            }

            var desc = doc.getElementById("HeaderInfo_Description");
            var notes = doc.getElementById("HeaderInfo_JobNotes");

            [desc, notes].forEach(function (el) {
                if (el) {
                    var row = el.closest(".row");
                    if (row) row.remove();
                }
            });

            var partsTabLink = doc.querySelector('a[href="#partPicker"]');
            if (partsTabLink) {
                var li = partsTabLink.closest("li");
                if (li) li.remove();
            }

            var partsContent = doc.getElementById("partPicker");
            if (partsContent) partsContent.remove();

            var servicesTabLink = doc.querySelector('a[href="#servicePicker"]');
            var servicesContent = doc.getElementById("servicePicker");

            if (servicesTabLink) {
                var li = servicesTabLink.closest("li");
                if (li) li.classList.add("active");
                servicesTabLink.setAttribute("aria-expanded", "true");
            }

            if (servicesContent) {
                servicesContent.classList.add("active", "in");
            }

            doc.querySelectorAll("h5").forEach(function (h) {
                if (h.textContent.trim() === "Order Line Details") {
                    var row = h.closest(".row");
                    if (row) row.remove();
                }
            });

            doc.querySelectorAll('input[type="submit"][value="Save"]').forEach(btn => btn.remove());

            var readyBtn = doc.getElementById("readyButton");
            if (readyBtn) readyBtn.remove();

            var completeBtn = doc.getElementById("completeButton");
            if (completeBtn) completeBtn.remove();

            doc.querySelectorAll('a[href*="/Orders/Jobs/PerformServices"]').forEach(function (el) {
                el.remove();
            });

            var progressArea = doc.getElementById("ProgressArea");
            if (progressArea) {
                var progressSection = progressArea.closest(".row.content-group") || progressArea.closest(".row") || progressArea;
                progressSection.remove();
            }

            doc.querySelectorAll('a.btn.btn-warning[href*="/Orders/Orders/Edit"]').forEach(function (el) {
                el.remove();
            });

            doc.querySelectorAll('a.btn[href*="/Orders/Receiving/PerformServices"]').forEach(function (el) {
                el.remove();
            });

            doc.querySelectorAll('a[href*="ReportGenerator/PrintPDF"]').forEach(btn => btn.remove());

            var footer = doc.querySelector("footer");
            if (footer) footer.remove();

            doc.querySelectorAll("a.accordion-toggle").forEach(function (toggle) {
                if (toggle.textContent.trim() === "Uploads") {
                    var well = toggle.closest(".well.well-sm");
                    if (well) well.remove();
                }
            });

            var orderSubtotal = doc.getElementById("OrderSubtotal");
            if (orderSubtotal) {
                var container = orderSubtotal.closest(".container-fluid");
                if (container) container.remove();
            }

            var refreshBtn = doc.querySelector('button[onclick="refreshLines()"]');
            var saveBtn = doc.querySelector('button[onclick="saveAll()"]');

            if (refreshBtn && saveBtn) {

                var container = refreshBtn.parentElement;

                while (container && !container.contains(saveBtn)) {
                    container = container.parentElement;
                }

                if (container) {
                    container.style.width = "100%";
                    container.style.display = "flex";
                    container.style.justifyContent = "flex-end";
                    container.style.alignItems = "center";
                    container.style.gap = "5px";
                    container.style.paddingRight = "0px";
                    container.style.marginRight = "0px";

                    saveBtn.style.order = "1";
                    refreshBtn.style.order = "2";
                }
            }

            hideOrderLineColumns(doc);

            pollResizeUntilStable(iframe);
            observeIframeHeight(iframe);

        } catch (e) {
            console.warn("Iframe not ready or inaccessible");
        }
    }

    function watchIframe(iframe) {
        try {
            var doc = iframe.contentDocument || iframe.contentWindow.document;
            if (!doc) return;

            var debounceTimer = null;
            var observer = new MutationObserver(function () {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(function () {
                removeStuffFromIframe(iframe);
            }, 200);
      });

            observer.observe(doc.body, {childList: true,subtree: true});
            removeStuffFromIframe(iframe);

        } catch (e) {
            console.warn("Could not attach observer to iframe");
        }
    }

    function createTimeExpandedSection(jobUrl) {

        var anchor = document.querySelector("#OrderRowsSection");
        if (!anchor) return;

        if (document.getElementById("timeExpandedSection")) return;

        var section = document.createElement("div");
        section.className = "row content-group";
        section.id = "timeExpandedSection";
        section.style.marginTop = "20px";

        var col = document.createElement("div");
        col.className = "col-md-12";

        var well = document.createElement("div");
        well.className = "well well-sm";

        var h3 = document.createElement("h3");

        var toggle = document.createElement("a");
        toggle.innerText = "Time Expanded";
        toggle.className = "accordion-toggle collapsed";
        toggle.setAttribute("data-toggle", "collapse");

        var id = "collapseTimeExpanded";
        toggle.setAttribute("data-target", "#" + id);
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-controls", id);

        toggle.onmouseover = function () {
            this.style.cursor = "pointer";
        };

        h3.appendChild(toggle);

        var body = document.createElement("div");
        body.className = "row collapse";
        body.id = id;

        var inner = document.createElement("div");
        inner.className = "col-md-12";

        var iframe = document.createElement("iframe");
        iframe.src = jobUrl;
        iframe.style.width = "100%";
        iframe.style.height = "2000px";
        iframe.style.border = "1px solid #ccc";
        iframe.style.borderRadius = "6px";
        iframe.style.marginTop = "10px";
        iframe.style.overflow = "hidden";

        iframe.onload = function () {
            watchIframe(iframe);
        };

        inner.appendChild(iframe);
        body.appendChild(inner);

        well.appendChild(h3);
        well.appendChild(body);

        col.appendChild(well);
        section.appendChild(col);

        anchor.parentNode.insertBefore(section, anchor.nextSibling);
    }

    function init() {
        waitForJobLink().then(function (jobUrl) {
            if (!jobUrl) return;
            createTimeExpandedSection(jobUrl);
        });
    }

    init();

})();

// =========================================================================
// ORIGINAL SCRIPT 2: TECH - Auto Add Labor + Tech Time Panel
// =========================================================================
(function () {
    'use strict';

    if (!window.location.href.includes('/Orders/Orders/Edit')) return;

    // =========================================================================
    // SHARED UTILITIES — delegates to TechShared where available
    // =========================================================================

    var SERVICE_ID = '834f33a0-2baf-4b64-6727-08ddb592746f';
    var undoStack = [];
    var TS = window.TechShared;

    function log(msg)  { TS ? TS.log(msg) : console.log('[Tech] ' + msg); }
    function warn(msg) { TS ? TS.log(msg, 'warn') : console.warn('[Tech] ' + msg); }

    function poll(label, conditionFn, onFound, timeoutMs, intervalMs) {
        if (TS) return TS.poll(label, conditionFn, onFound, timeoutMs || 15000, intervalMs);
        timeoutMs  = timeoutMs  || 15000;
        intervalMs = intervalMs || 300;
        var elapsed = 0;
        var tid = setInterval(function () {
            var result = conditionFn();
            if (result) {
                clearInterval(tid);
                onFound(result);
                return;
            }
            elapsed += intervalMs;
            if (elapsed >= timeoutMs) {
                clearInterval(tid);
                warn('Timed out: ' + label);
            }
        }, intervalMs);
        return function () { clearInterval(tid); };
    }

    function getCsrfToken() {
        if (TS) return TS.csrf.get();
        var el = document.querySelector('input[name="__RequestVerificationToken"]')
               || document.querySelector('meta[name="RequestVerificationToken"]');
        return el ? (el.value || el.getAttribute('content')) : null;
    }

    function getOrderId() {
        if (TS) return TS.dom.getOrderId();
        return new URLSearchParams(window.location.search).get('id');
    }

    // =========================================================================
    // ORDER COMPLETION CHECK
    // =========================================================================

    function isOrderComplete() {
        if (TS) return TS.dom.isOrderComplete();
        var rows = document.querySelectorAll('table.lq-table-info th');
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].textContent.trim() === 'Order Status') {
                var td = rows[i].nextElementSibling;
                if (td && td.textContent.trim() === 'Complete') return true;
            }
        }
        return false;
    }

    // =========================================================================
    // PART 1 — AUTO ADD SERVICE LINE
    // =========================================================================

    window.alert = function (msg) { log('Suppressed alert: ' + msg); };

    function tableHasLines() {
        var table = document.getElementById('order-line-area');
        if (!table) return false;
        return table.innerHTML.indexOf('S-100542') !== -1
            || table.innerHTML.indexOf(SERVICE_ID)  !== -1;
    }

    function findServiceRow() {
        var rows = document.querySelectorAll('#order-line-area tbody tr');
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].innerHTML.indexOf('S-100542') !== -1
             || rows[i].innerHTML.indexOf(SERVICE_ID) !== -1) {
                return rows[i];
            }
        }
        return null;
    }

    function getServiceLineId() {
        var row = findServiceRow();
        if (!row) return null;
        var m = row.id.match(/OrderLine_(.+)/);
        return m ? m[1] : null;
    }

    function setSourceTypeToJob() {
        var lineId = getServiceLineId();
        if (!lineId) return;
        var sourceRow = document.getElementById('OrderLineSourceArea_' + lineId);
        if (!sourceRow) return;
        var select = sourceRow.querySelector('select[id^="OrderLineSourceType_"]');
        if (select && select.value !== '6') {
            select.value = '6';
            try { sourceTypeChanged(select); } catch (e) {}
        }
    }

    function setQuantitiesToOne() {
        var row = findServiceRow();
        if (!row) return;
        var input = row.querySelector('input[id^="OrderLineQuantityMask_"]');
        if (input && (parseFloat(input.value) === 0 || input.value === '')) {
            input.value = '1';
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function phaseProcess() {
        var lineId = getServiceLineId();
        if (!lineId) return;
        var checkbox = document.getElementById('check_' + lineId);
        if (!checkbox) return;
        checkbox.checked = true;
        try { checkLine(checkbox, lineId); } catch (e) {}

        poll('processSourceLines button', function () {
            var btn = document.getElementById('processSourceLines');
            return (btn && btn.style.display !== 'none') ? btn : null;
        }, function () {
            setTimeout(function () {
                try { processSourceLines(); } catch (e) { warn('processSourceLines: ' + e.message); }
            }, 100);
        }, 10000, 100);
    }

    function phaseSave() {
        poll('saveLines fn', function () {
            return typeof saveLines === 'function' ? true : null;
        }, function () {
            saveLines();
            setTimeout(phaseProcess, 1500);
        });
    }

    function phaseConfigureAndSave() {
        poll('OrderLineSourceType', function () {
            return document.querySelector('select[id^="OrderLineSourceType_"]');
        }, function () {
            setSourceTypeToJob();
            poll('OrderLineQuantityMask', function () {
                return document.querySelector('input[id^="OrderLineQuantityMask_"]');
            }, function () {
                setQuantitiesToOne();
                phaseSave();
            });
        });
    }

    function injectHtml(html) {
        var table = document.getElementById('order-line-area');
        if (!table) return;
        var tbody = table.querySelector('tbody');
        if (!tbody) return;
        var tpl = document.createElement('template');
        tpl.innerHTML = html;
        tpl.content.querySelectorAll('script').forEach(function (s) { s.remove(); });
        tbody.appendChild(tpl.content);
        phaseConfigureAndSave();
    }

    function observeForNewLines() {
        var table = document.getElementById('order-line-area');
        if (!table) return;
        var debounce = null;
        var obs = new MutationObserver(function () {
            clearTimeout(debounce);
            debounce = setTimeout(function () {
                setQuantitiesToOne();
                if (findServiceRow()) {
                    obs.disconnect();
                    log('Part1 observer disconnected.');
                }
            }, 200);
        });
        obs.observe(table, { childList: true, subtree: true });
    }

    function addServiceLine() {
        if (tableHasLines()) {
            setQuantitiesToOne();
            var lineId = getServiceLineId();
            if (lineId) {
                var sourceArea = document.getElementById('OrderLineSourceArea_' + lineId);
                if (sourceArea) {
                    var sourceType = sourceArea.querySelector('select[id^="OrderLineSourceType_"]');
                    var locked = sourceArea.querySelector('input[id^="OrderLineSourceLocked_"]');
                    var isProcessed = locked && locked.value;
                    if (!isProcessed) {
                        log('Labor line unprocessed — configuring and processing.');
                        if (sourceType && sourceType.value !== '6') {
                            setSourceTypeToJob();
                        }
                        phaseSave();
                    }
                }
            }
            return;
        }
        var orderId = getOrderId();
        if (!orderId) { warn('No order ID.'); return; }
        fetch('/Orders/Orders/Edit?handler=NewServiceLine'
            + '&orderId='   + encodeURIComponent(orderId)
            + '&serviceId=' + encodeURIComponent(SERVICE_ID)
            + '&quantity=1', {
            method: 'POST',
            headers: {
                'Accept': '*/*',
                'Content-Type': 'application/json; charset=utf-8',
                'X-Requested-With': 'XMLHttpRequest',
                'RequestVerificationToken': getCsrfToken() || ''
            },
            credentials: 'include',
            body: ''
        })
        .then(function (r) { return r.ok ? r.text() : null; })
        .then(function (html) { if (html) injectHtml(html); })
        .catch(function (err) { warn('Fetch error: ' + err); });
    }

    poll('order-line-area', function () {
        return document.getElementById('order-line-area');
    }, function () {
        setTimeout(function () {
            if (isOrderComplete()) {
                log('Order is complete — Part 1 skipped.');
                return;
            }
            addServiceLine();
            observeForNewLines();
        }, 500);
    });

    // =========================================================================
    // PART 2 — TECH TIME ENTRY PANEL
    // =========================================================================

    var _iframe     = null;
    var _techList        = null;
    var _techListLoading = null;
    var _panelReady      = false;

    function getIframe() {
        if (TS) return TS.iframe.getVisible();
        var te = document.querySelector('#collapseTimeExpanded iframe');
        if (te) {
            try {
                return te;
            } catch (e) {}
        }
        return _iframe;
    }

    function getIframeDoc() {
        if (TS) return TS.iframe.getDoc();
        var f = getIframe();
        if (!f) return null;
        try { return f.contentDocument || f.contentWindow.document; } catch (e) { return null; }
    }

    function getIframeWin() {
        if (TS) return TS.iframe.getWin();
        var f = getIframe();
        if (!f) return null;
        try { return f.contentWindow; } catch (e) { return null; }
    }

    function getJobId() {
        if (TS) return TS.dom.getJobId();
        var link = document.querySelector("a.monospaced[href*='Orders/Jobs/Edit']");
        if (link) {
            try { return new URL(link.href).searchParams.get('id'); } catch (e) {}
        }
        var f = getIframe();
        if (!f) return null;
        try { return new URL(f.src).searchParams.get('id'); } catch (e) { return null; }
    }

    function getCsrfFromIframe() {
        if (TS) return TS.csrf.getFromIframe();
        var iDoc = getIframeDoc();
        if (!iDoc) return null;
        var t = iDoc.querySelector('input[name="__RequestVerificationToken"]');
        return t ? t.value : null;
    }

    function findJobUrl() {
        if (TS) return TS.dom.getJobLink();
        var link = document.querySelector("a.monospaced[href*='Orders/Jobs/Edit']");
        return link ? link.href : null;
    }

    function waitForJobUrl() {
        return new Promise(function (resolve) {
            var existing = findJobUrl();
            if (existing) return resolve(existing);
            if (TS) {
                TS.poll('jobUrl', findJobUrl, function (link) {
                    resolve(link);
                }, 30000);
                return;
            }
            var obs = new MutationObserver(function () {
                var link = findJobUrl();
                if (link) { obs.disconnect(); resolve(link); }
            });
            obs.observe(document.body, { childList: true, subtree: true });
            setTimeout(function () { obs.disconnect(); resolve(null); }, 30000);
        });
    }

    function createHiddenIframe(jobUrl) {
        log('Hidden iframe creation DISABLED to avoid conflict with Time Expanded');
    }

    function waitForIframeReady(callback) {
        if (TS) { TS.iframe.waitForReady(callback, 60000); return; }
        poll('iframe ready', function () {
            var iDoc = getIframeDoc();
            return (iDoc && iDoc.querySelector('.k-input-value-text')) ? true : null;
        }, callback, 60000, 800);
    }

    function releaseKendoGrid() {
        try {
            var iWin = getIframeWin();
            if (!iWin || !iWin.jQuery) return;

            var grid = iWin.jQuery('#serviceGrid').data('kendoGrid');
            if (grid) {
                // Only clear data, don't fully destroy when using shared iframe
                grid.dataSource.data([]);
                log('Kendo grid data cleared (safe mode)');
            }
        } catch (e) {}
    }

    function getOrderRepName() {
        if (TS) return TS.dom.getOrderRepName();
        var rows = document.querySelectorAll('table.lq-table-info th');
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].textContent.trim() === 'Order Rep') {
                var td = rows[i].nextElementSibling;
                if (td) {
                    var span = td.querySelector('span');
                    if (span && span.textContent.trim()) return span.textContent.trim();
                }
            }
        }
        return 'Unknown Tech';
    }

    function getInitials(name) {
        return name.split(' ').filter(Boolean)
            .map(function (w) { return w[0]; })
            .join('').toUpperCase().slice(0, 2);
    }

    var TAG_HOURLY_NAME = 'TagSearch_115ac658-0136-4f3b-e15a-08daa4c0721f_input';

    function setKendoTag(iDoc, iWin, inputName, value, done) {
        var input = iDoc.querySelector('input[name="' + inputName + '"]');
        if (!input) { warn('Tag input not found: ' + inputName); done(); return; }
        var jEl = iWin.jQuery(input).closest('[data-role]');
        var widget = jEl.data('kendoComboBox') || jEl.data('kendoDropDownList') || jEl.data('kendoAutoComplete');
        if (!widget) {
            input.value = value;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
            setTimeout(done, 300);
            return;
        }
        widget.value(value);
        widget.trigger('change');
        setTimeout(done, 300);
    }

    function isValidTechEntry(description) {
        return /^[A-Za-z]+\s+[A-Za-z].*\s-\sHours$/i.test((description || '').trim());
    }

    function loadTechList(callback) {
        if (_techList) { callback(_techList); return; }

        if (_techListLoading) {
            _techListLoading.push(callback);
            return;
        }
        _techListLoading = [];
        _techListLoading.push(callback);

        function drainTechQueue(techs) {
            _techList = techs;
            var q = _techListLoading;
            _techListLoading = null;
            for (var i = 0; i < q.length; i++) q[i](techs);
        }

        var iWin = getIframeWin();
        var iDoc = getIframeDoc();
        if (!iWin || !iWin.jQuery || !iDoc) return drainTechQueue([]);
        var kendoGrid = iWin.jQuery('#serviceGrid').data('kendoGrid');
        if (!kendoGrid) return drainTechQueue([]);

        function doFetch() {
            kendoGrid.dataSource.pageSize(50);
            kendoGrid.dataSource.fetch(function () {
                var data  = kendoGrid.dataSource.data();
                var techs = [];
                for (var i = 0; i < data.length; i++) {
                    var desc = (data[i].Description || '').trim();
                   var category = (data[i].Category || '').trim().toUpperCase();
                    if (isValidTechEntry(desc) && category === 'OTHER') {
                        techs.push({ name: desc.split(' - ')[0].trim(), serviceId: data[i].Id });
                    }
                }
                techs.sort(function (a, b) { return a.name.localeCompare(b.name); });
                log('Tech list loaded: ' + techs.length + ' entries (filtered).');

                try {
                    var clearBtn = iDoc.querySelector('button[onclick*="clearServiceSearch"]');
                    if (clearBtn) clearBtn.click();
                    else if (typeof iWin.clearServiceSearch === 'function') iWin.clearServiceSearch();
                } catch (e) {}

                releaseKendoGrid();
                drainTechQueue(techs);
            });
        }

        // NOTE: previously this called setKendoTag(iDoc, iWin, TAG_HOURLY_NAME, 'hourly', ...)
        // to re-select the "Hourly" tag combo before fetching. That passed the literal
        // string 'hourly' into Kendo's widget.value() setter, which expects the combo's
        // underlying GUID (dataValueField), not display text. No item matched, so the
        // combo's selection got CLEARED instead of set, and the resulting fetch pulled
        // back the entire unfiltered service catalog (500+ rows) into the visible grid.
        //
        // Script 1 (preloadServiceFilters, in the Time Expanded iframe setup) already
        // does this correctly: it discovers the real GUID for "Hourly" and hooks
        // schema.parse to filter every response to Task === hourly. Wait for that setup
        // to finish (it flags iframe.dataset.brFiltersPreloaded = "1") instead of
        // duplicating and clobbering it here.
        var iframeEl = getIframe();
        var waited = 0;
        (function waitForFiltersThenFetch() {
            if (iframeEl && iframeEl.dataset.brFiltersPreloaded === "1") {
                doFetch();
                return;
            }
            waited += 300;
            if (waited >= 15000) {
                warn('Timed out waiting for Time Expanded filters to preload — fetching anyway.');
                doFetch();
                return;
            }
            setTimeout(waitForFiltersThenFetch, 300);
        })();
    }

    function getServiceIdForTech(techName, techs) {
        var parts = techName.toLowerCase().split(' ');
        var first = parts[0], last = parts[1] || '';
        for (var i = 0; i < techs.length; i++) {
            var n = techs[i].name.toLowerCase();
            if (n.indexOf(first) !== -1 && (!last || n.indexOf(last) !== -1))
                return techs[i].serviceId;
        }
        return null;
    }

    function getTotalHours() {
        // Try both iframes — Time Expanded may be collapsed, hidden iframe may not be ready
        var docs = [];
        var te = document.querySelector('#collapseTimeExpanded iframe');
        if (te) { try { if (te.contentDocument) docs.push(te.contentDocument); } catch (e) {} }
        if (_iframe) { try { if (_iframe.contentDocument) docs.push(_iframe.contentDocument); } catch (e) {} }

        for (var d = 0; d < docs.length; d++) {
            var iDoc = docs[d];
            var inputs = iDoc.querySelectorAll('input[id^="OrderLineQuantity_"]');
            if (!inputs.length) continue;

            var total = 0;
            var found = false;

            inputs.forEach(function (el) {
                var row = el.closest('tr');
                if (!row) return;

                var rowHtml = row.innerHTML || '';

                // === EXCLUDE THESE LINES FROM TOTAL ===
                if (rowHtml.includes('S-100238') || rowHtml.includes('S-100215')) {
                    return; // Skip this line
                }

                var v = parseFloat(el.value);
                if (!isNaN(v)) {
                    total += v;
                    found = true;
                }
            });

            if (found) {
                return Math.round(total * 100) / 100;
            }
        }
        return null;
    }

    function updateTotalDisplay() {
        var el = document.getElementById('tp-total');
        if (!el) return;
        var total = getTotalHours();
        el.textContent = total !== null ? total + 'h' : '—';
    }

    function findTechMainLine(techName) {
        var iDoc = getIframeDoc();
        if (!iDoc) return null;
        var first = techName.split(' ')[0].toLowerCase();
        var last  = techName.split(' ')[1] ? techName.split(' ')[1].toLowerCase() : '';
        var inputs = iDoc.querySelectorAll('input[id^="OrderLineQuantity_"]');
        for (var i = 0; i < inputs.length; i++) {
            var row = inputs[i].closest('tr');
            if (!row) continue;
            var cells = row.querySelectorAll('.condensedCell');
            for (var j = 0; j < cells.length; j++) {
                var t = cells[j].textContent.trim().toLowerCase();
                if (t.indexOf(first) !== -1 && (!last || t.indexOf(last) !== -1))
                    return { lineId: inputs[i].id.replace('OrderLineQuantity_', ''), input: inputs[i] };
            }
        }
        return null;
    }

    function getSubLineQuantities(lineId) {
        var iDoc = getIframeDoc();
        if (!iDoc) return [];
        var results = [];
        iDoc.querySelectorAll('input[id^="OrderLineSourceQuantity_"]').forEach(function (el) {
            if ((el.getAttribute('onchange') || '').indexOf(lineId) !== -1)
                results.push({ id: el.id, input: el, value: parseFloat(el.value) || 0 });
        });
        return results;
    }

    function clickAddSourceLine(lineId) {
        var iDoc = getIframeDoc(), iWin = getIframeWin();
        if (!iDoc || !iWin) return false;
        if (typeof iWin.addNewSourceLine === 'function') {
            try { iWin.addNewSourceLine(lineId); return true; } catch (e) {}
        }
        var btns = iDoc.querySelectorAll('button[onclick*="addNewSourceLine"]');
        for (var i = 0; i < btns.length; i++) {
            if (btns[i].getAttribute('onclick').indexOf(lineId) !== -1) {
                btns[i].click(); return true;
            }
        }
        return false;
    }

    function updateMainLineTotal(lineId) {
        var iDoc = getIframeDoc(), iWin = getIframeWin();
        if (!iDoc || !iWin) return;
        var subs  = getSubLineQuantities(lineId);
        var total = Math.round(subs.reduce(function (s, x) { return s + x.value; }, 0) * 100) / 100;
        var main  = iDoc.getElementById('OrderLineQuantity_' + lineId);
        if (!main) return;

        var origOnChange = main.onchange;
        main.onchange = null;

        main.value = total;
        main.dispatchEvent(new Event('input', { bubbles: true }));

        setTimeout(function () {
            main.onchange = origOnChange;
            try {
                main.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (e) {
                log('Suppressed validation noise: ' + e.message);
            }
            main.blur();
        }, 50);
    }

    function clickSaveInIframe() {
        var iDoc = getIframeDoc(), iWin = getIframeWin();
        if (!iDoc) return;
        if (iWin && typeof iWin.saveLines === 'function') { iWin.saveLines(); return; }
        var btns = iDoc.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
            if (btns[i].innerHTML.indexOf('floppy-disk') !== -1) { btns[i].click(); return; }
        }
    }

    function setFeedback(msg, ok) {
        var color = ok === false ? '#c0392b' : '#3B6D11';
        ['tp-feedback', 'tp-feedback-hdr'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) { el.textContent = msg; el.style.color = color; }
        });
    }

    function resetBtn() {
        var btn = document.getElementById('tp-set');
        if (btn) { btn.disabled = false; btn.textContent = 'Log Hours'; }
        var btnM = document.getElementById('tp-set-m');
        if (btnM) { btnM.disabled = false; btnM.textContent = 'Log Hours'; }
    }

    function doAddSubLine(lineId, hours, techName, isNewLine) {
        setFeedback('Logging hours...', true);

function applyAndSave(subInput) {
            // 1. Temporarily remove the native onchange handler to prevent the crash
            const originalOnChange = subInput.onchange;
            subInput.onchange = null;

            // 2. Safely set the value
            subInput.value = hours;
            subInput.dispatchEvent(new Event('input', { bubbles: true }));

            // 3. Re-attach the handler after a micro-task delay
            setTimeout(function() {
                subInput.onchange = originalOnChange;

                // 4. Now manually trigger the change event so the app processes the new value
                // We wrap this in a try/catch in case the app's validator is still grumpy
                try {
                    subInput.dispatchEvent(new Event('change', { bubbles: true }));
                } catch (e) {
                    log('Suppressed validation noise: ' + e.message);
                }

                // 5. Final save sequence
                setTimeout(function () {
                    updateMainLineTotal(lineId);
                    setTimeout(function () {
                        clickSaveInIframe();
                        setFeedback('✔ ' + hours + 'h logged for ' + techName, true);
                        undoStack.push(subInput.id);
                        updateUndoBtn();
                        resetBtn();
                        setTimeout(updateTotalDisplay, 600);
                    }, 500);
                }, 400);
            }, 100);
        }

        if (isNewLine) {
            var existing = getSubLineQuantities(lineId);
            if (existing.length > 0) { applyAndSave(existing[existing.length - 1].input); return; }
        }

        var before = getSubLineQuantities(lineId).length;
        if (!clickAddSourceLine(lineId)) {
            resetBtn();
            return setFeedback('Could not find + button in iframe.', false);
        }

        poll('new sub-line', function () {
            var subs = getSubLineQuantities(lineId);
            return subs.length > before ? subs : null;
        }, function (subs) {
            var lastInput = subs[subs.length - 1].input;
            applyAndSave(lastInput);
        }, 5000, 250);
    }

    function injectLabourLineIntoIframe(html) {
        var iDoc = getIframeDoc();
        if (!iDoc) return;
        var tbody = null;
        iDoc.querySelectorAll('tbody').forEach(function (tb) {
            if (tb.querySelector('input[id^="OrderLineQuantity_"]')) tbody = tb;
        });
        if (!tbody) {
            var tbs = iDoc.querySelectorAll('tbody');
            if (tbs.length >= 4) tbody = tbs[3];
        }
        if (!tbody) return;
        var tpl = iDoc.createElement('template');
        tpl.innerHTML = html;
        tpl.content.querySelectorAll('script').forEach(function (s) { s.remove(); });
        tbody.appendChild(tpl.content);
    }

    function addLabourLineToJob(techName, serviceId, onDone) {
        var jobId = getJobId();
        var csrf  = getCsrfFromIframe();
        if (!jobId)     return onDone(false, 'Could not find Job ID.');
        if (!csrf)      return onDone(false, 'Could not find CSRF token.');
        if (!serviceId) return onDone(false, 'No service ID for ' + techName + '.');

        fetch('/Orders/Jobs/Edit?handler=NewServiceLine'
            + '&jobId='     + jobId
            + '&serviceId=' + serviceId
            + '&quantity=1', {
            method: 'POST',
            headers: {
                'Accept': '*/*',
                'Content-Type': 'application/json; charset=utf-8',
                'X-Requested-With': 'XMLHttpRequest',
                'RequestVerificationToken': csrf
            },
            credentials: 'include',
            body: ''
        })
        .then(function (r) { return r.ok ? r.text() : Promise.reject('POST ' + r.status); })
        .then(function (html) {
            if (!html) return onDone(false, 'Empty response.');
            injectLabourLineIntoIframe(html);
            onDone(true, '');
        })
        .catch(function (err) { onDone(false, 'Error: ' + err); });
    }

    function logHours(hours, techName, serviceId) {
        var mainLine = findTechMainLine(techName);
        if (mainLine) {
            doAddSubLine(mainLine.lineId, hours, techName, false);
        } else {
            setFeedback('Adding labour line for ' + techName + '...', true);
            addLabourLineToJob(techName, serviceId, function (ok, msg) {
                if (!ok) { setFeedback(msg, false); resetBtn(); return; }
                poll('tech main line after add', function () {
                    return findTechMainLine(techName);
                }, function (line) {
                    setTimeout(function () { doAddSubLine(line.lineId, hours, techName, true); }, 300);
                }, 10000, 500);
            });
        }
    }

    function updateBadge(name, isOrderRep) {
        var nameDiv   = document.getElementById('tp-name');
        var avatarDiv = document.getElementById('tp-avatar');
        var subDiv    = document.getElementById('tp-sub');
        var techCard  = document.getElementById('tp-tech');
        if (nameDiv)   nameDiv.textContent   = name;
        if (avatarDiv) avatarDiv.textContent = getInitials(name);
        if (isOrderRep) {
            if (avatarDiv) { avatarDiv.style.background = '#B5D4F4'; avatarDiv.style.color = '#0C447C'; }
            if (subDiv)    subDiv.textContent = 'Order Rep';
            if (techCard)  techCard.style.background = '#f4f6f8';
        } else {
            if (avatarDiv) { avatarDiv.style.background = '#FAEEDA'; avatarDiv.style.color = '#854F0B'; }
            if (subDiv)    subDiv.textContent = 'Assisting Tech';
            if (techCard)  techCard.style.background = '#FEF3E2';
        }
    }

    function updateUndoBtn() {
        var btn = document.getElementById('tp-undo') || document.getElementById('tp-undo-m');
        if (!btn) return;
        btn.textContent = undoStack.length ? '↩ (' + undoStack.length + ')' : '↩';
    }

    function createPanel(readOnly) {
        if (_panelReady || document.getElementById('timePanelRoot')) return;
        _panelReady = true;
        readOnly = !!readOnly;

        var orderRep = getOrderRepName();
        var initials = getInitials(orderRep);

        var style = document.createElement('style');
        style.textContent = [
            '#timePanelRoot{position:fixed;bottom:24px;right:24px;z-index:99999;width:380px;background:#fff;border:1px solid #ddd;border-radius:10px;padding:11px 14px;font-family:system-ui,sans-serif;font-size:12px;color:#222;cursor:default;will-change:transform}',
            '#timePanelRoot *{box-sizing:border-box}',
            '#tp-header{display:flex;align-items:center;gap:6px;margin-bottom:8px;padding-right:50px}',
            '#tp-title{font-weight:700;font-size:13px;white-space:nowrap;margin-right:4px}',
            '#tp-feedback{font-size:11px;color:#3B6D11;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
            '#tp-feedback-hdr{display:none;font-size:11px;flex:1;color:#3B6D11;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
            '#timePanelRoot.tp-mini #tp-feedback-hdr{display:block}',
            '#timePanelRoot.tp-mini #tp-label-row{display:none!important}',
            '#tp-header-btns{position:absolute;top:7px;right:9px;display:flex;gap:2px;z-index:2}',
            '#tp-mini,#tp-close{background:none;border:none;font-size:17px;cursor:pointer;color:#aaa;line-height:1;padding:0 2px}',
            '#tp-mini:hover,#tp-close:hover{color:#333}',
            '#tp-tech{display:flex;align-items:center;gap:6px;background:#f4f6f8;border-radius:7px;padding:7px 10px;margin-bottom:9px;transition:background .2s}',
            '#tp-avatar{width:30px;height:30px;border-radius:50%;background:#B5D4F4;color:#0C447C;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;flex-shrink:0;transition:background .2s,color .2s}',
            '#tp-name-block{flex:1;min-width:0;overflow:hidden}',
            '#tp-name{font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
            '#tp-sub{font-size:10px;color:#888}',
            '#tp-alt-badge{display:none}',
            '#tp-mini-target{display:none;flex-direction:column;gap:3px;align-items:stretch;flex-shrink:0}',
            '#tp-total-box{background:#EAF3DE;border-radius:6px;padding:5px 9px;text-align:center;flex-shrink:0}',
            '#tp-total{font-weight:700;color:#3B6D11;font-size:14px;line-height:1.2}',
            '#tp-total-lbl{font-size:9px;color:#3B6D11;text-transform:uppercase;letter-spacing:.04em}',
            '#tp-label-row{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px;margin-top:8px}',
            '#tp-select-lbl{font-size:12px;color:#666}',
            '#tp-row{display:flex;gap:5px;align-items:center}',
            '#tp-tech-select{flex:1;padding:5px 6px;border:1px solid #ccc;border-radius:5px;font-size:11px;background:#fff;min-width:0}',
            '#tp-tech-select:focus{outline:none;border-color:#378ADD}',
            '#tp-hours{width:50px;padding:5px 5px;border:1px solid #ccc;border-radius:5px;font-size:12px;text-align:center;flex-shrink:0}',
            '#tp-hours:focus{outline:none;border-color:#378ADD}',
            '#tp-set,#tp-set-m{flex-shrink:0;padding:5px 10px;border:none;border-radius:5px;background:#378ADD;color:#fff;cursor:pointer;font-size:11px;font-weight:600;white-space:nowrap}',
            '#tp-set:hover,#tp-set-m:hover{background:#2a6cb5}',
            '#tp-set:disabled,#tp-set-m:disabled{opacity:.5;cursor:not-allowed}',
            '#tp-undo,#tp-undo-m{flex-shrink:0;padding:5px 8px;border:1px solid #ccc;border-radius:5px;background:#f5f5f5;color:#666;cursor:pointer;font-size:12px;font-weight:500;line-height:1}',
            '#tp-undo:hover,#tp-undo-m:hover{background:#e8e8e8;border-color:#bbb}',

            '#timePanelRoot.tp-mini{width:auto;min-width:260px}',
            '#tp-mini-controls{display:none;flex-direction:row;gap:4px;align-items:center;flex-shrink:0;margin-left:auto}',
            '#tp-hours-m{width:48px;padding:3px 4px;border:1px solid #ccc;border-radius:5px;font-size:12px;text-align:center}',
            '#tp-hours-m:focus{outline:none;border-color:#378ADD}',
            '#tp-set-m{padding:4px 8px;border:none;border-radius:5px;background:#378ADD;color:#fff;cursor:pointer;font-size:11px;font-weight:600;white-space:nowrap}',
            '#tp-set-m:hover{background:#2a6cb5}',
            '#tp-set-m:disabled{opacity:.5;cursor:not-allowed}',
            '#timePanelRoot.tp-mini{width:auto;min-width:280px}',
            '#timePanelRoot.tp-mini #tp-select-lbl,#timePanelRoot.tp-mini #tp-row{display:none!important}',
            '#timePanelRoot.tp-mini #tp-tech{margin-bottom:0}',
            '#timePanelRoot.tp-mini #tp-sub{display:none}',
            '#timePanelRoot.tp-mini #tp-mini-controls{display:flex!important}'
        ].join('\n');
        document.head.appendChild(style);

        var panel = document.createElement('div');
        panel.id = 'timePanelRoot';
        panel.innerHTML = [
            '<div id="tp-header">',
            '  <span id="tp-title">' + (readOnly ? '⏱ Tech Time — View Only' : '⏱ Log Tech Time') + '</span>',
            '  <span id="tp-feedback-hdr" style="display:none;font-size:11px;color:#3B6D11;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0 6px"></span>',
            '  <div id="tp-header-btns">',
            '    <button id="tp-mini" title="Mini mode">▬</button>',
            '    <button id="tp-close" title="Collapse">&#8212;</button>',
            '  </div>',
            '</div>',
            '<div id="tp-tech">',
            '  <div id="tp-avatar">' + initials + '</div>',
            '  <div id="tp-name-block">',
            '    <div style="display:flex;align-items:center;gap:4px">',
            '      <div id="tp-name">' + orderRep + '</div>',
            '      <span id="tp-alt-badge"></span>',
            '    </div>',
            '    <div id="tp-sub">Order Rep</div>',
            '  </div>',
            '  <div id="tp-mini-controls">',
            '    <input type="number" id="tp-hours-m" min="0.1" step="0.5" value="1.0" />',
            '    <button type="button" id="tp-set-m">Log Hours</button>',
            '    <button type="button" id="tp-undo-m" title="Undo last entry">↩</button>',
            '  </div>',
            '  <div id="tp-total-box">',
            '    <div id="tp-total">—</div>',
            '    <div id="tp-total-lbl">Total Hours</div>',
            '  </div>',
            '</div>',
            '<div id="tp-feedback-mini" style="display:none;font-size:12px;margin-top:5px"></div>',
            '<div id="tp-label-row">',
            '  <label id="tp-select-lbl" for="tp-tech-select">Log time for</label>',
            '  <span id="tp-feedback"></span>',
            '</div>',
            '<div id="tp-row">',
            '  <select id="tp-tech-select"><option value="">Loading techs...</option></select>',
            '  <input type="number" id="tp-hours" min="0.1" step="0.5" value="1.0" placeholder="hrs" />',
            '  <button id="tp-set">Log Hours</button>',
            '  <button id="tp-undo" title="Undo last entry">↩</button>',
            '</div>'
        ].join('');
        document.body.appendChild(panel);

        var pill = document.createElement('button');
        pill.id = 'tp-pill';
        pill.title = 'Show Tech Time Panel';
        pill.textContent = '⏱ Tech Time';
        pill.style.cssText = [
            'display:none', 'position:fixed', 'bottom:24px', 'right:24px',
            'z-index:99999', 'background:#1a2a4a', 'color:#fff',
            'border:none', 'border-radius:20px', 'padding:7px 14px',
            'font-family:system-ui,sans-serif', 'font-size:12px',
            'font-weight:600', 'cursor:pointer', 'box-shadow:0 2px 8px rgba(0,0,0,0.25)'
        ].join(';');
        document.body.appendChild(pill);

        var resetBtn = document.createElement('button');
        resetBtn.id = 'tp-reset-pos';
        resetBtn.title = 'Reset panel position to default';
        resetBtn.textContent = '↺ Reset Panel';
        resetBtn.style.cssText = [
            'position:fixed', 'top:6px', 'right:300px',
            'z-index:100000', 'background:rgba(0,0,0,0.45)', 'color:rgba(255,255,255,0.7)',
            'border:none', 'border-radius:4px', 'padding:2px 8px',
            'font-family:system-ui,sans-serif', 'font-size:12px',
            'cursor:pointer', 'opacity:1.0', 'transition:opacity 0.2s',
            'line-height:1.6'
        ].join(';');
        document.body.appendChild(resetBtn);

        resetBtn.addEventListener('mouseenter', function () {
            resetBtn.style.background = 'rgba(0,0,0,0.7)';
            resetBtn.style.color = '#fff';
        });
        resetBtn.addEventListener('mouseleave', function () {
            resetBtn.style.background = 'rgba(0,0,0,0.45)';
            resetBtn.style.color = 'rgba(255,255,255,0.7)';
        });

        resetBtn.addEventListener('click', function () {
            try {
                localStorage.removeItem('bristow_tp_pos_full');
                localStorage.removeItem('bristow_tp_pos_mini');
            } catch (e) {}
            panel.style.left = '';
            panel.style.top = '';
            panel.style.right = '24px';
            panel.style.bottom = '24px';
            resetBtn.textContent = '✓ Reset';
            setTimeout(function () { resetBtn.textContent = '↺ Reset Panel'; }, 1500);
        });

        var resetBtnTimer = null;
        document.addEventListener('mousemove', function (e) {
            clearTimeout(resetBtnTimer);

            if (e.clientY <= 20) {
                resetBtn.style.opacity = '1';
            } else {
                resetBtnTimer = setTimeout(function () {
                    resetBtn.style.opacity = '0.4';
                }, 600);
            }
        });

        function restorePosition(isMini) {
            try {
                var key = isMini ? 'bristow_tp_pos_mini' : 'bristow_tp_pos_full';
                var pos = JSON.parse(localStorage.getItem(key) || 'null');
                if (pos && (pos.left || pos.top)) {
                    panel.style.left   = pos.left   || '';
                    panel.style.top    = pos.top    || '';
                    panel.style.right  = pos.right  || '';
                    panel.style.bottom = pos.bottom || '';
                } else {
                    panel.style.left   = '';
                    panel.style.top    = '';
                    panel.style.right  = '24px';
                    panel.style.bottom = '24px';
                }
            } catch (e) {}
        }


        function undoLastAction() {
            var btn = document.getElementById('tp-undo') || document.getElementById('tp-undo-m');
            if (btn) btn.textContent = '...';

            if (!undoStack.length) {
                setFeedback('Nothing to undo', false);
                updateUndoBtn();
                return;
            }

            setFeedback('Undoing...', true);

            var iDoc = getIframeDoc();
            var iWin = getIframeWin();
            if (!iDoc || !iWin) {
                setFeedback('Could not access iframe', false);
                updateUndoBtn();
                return;
            }

            var inputId = undoStack[undoStack.length - 1];
            var parentLineId = null;
            var sourceLineId = null;

            // Try to find the row via stored input ID
            var input = iDoc.getElementById(inputId);
            if (!input) {
                setFeedback('Row already removed', false);
                undoStack.pop();
                updateUndoBtn();
                updateTotalDisplay();
                return;
            }
            if (input) {
                var row = input.closest('tr.sourceLine');
                if (row) {
                    var delBtn = row.querySelector('button[onclick*="removeSourceLine"]');
                    if (delBtn) {
                        var onclick = delBtn.getAttribute('onclick');
                        var match = onclick.match(/removeSourceLine\('([^']+)',\s*'([^']+)'/);
                        if (match) {
                            parentLineId = match[1];
                            sourceLineId = match[2];
                        }
                    }
                }
            }

            // If not found by ID, extract sourceLineId from the stored ID itself
            if (!sourceLineId && inputId.indexOf('OrderLineSourceQuantity_') === 0) {
                sourceLineId = inputId.replace('OrderLineSourceQuantity_', '');
                // Find the button by matching the sourceLineId in onclick
                var allDelBtns = iDoc.querySelectorAll('button[onclick*="removeSourceLine"][onclick*="' + sourceLineId + '"]');
                if (allDelBtns.length > 0) {
                    var btnEl = allDelBtns[allDelBtns.length - 1];
                    var onclick = btnEl.getAttribute('onclick');
                    var match = onclick.match(/removeSourceLine\('([^']+)',\s*'([^']+)'/);
                    if (match) {
                        parentLineId = match[1];
                        sourceLineId = match[2];
                    }
                }
            }

            if (!parentLineId || !sourceLineId) {
                setFeedback('Could not locate the line to undo', false);
                undoStack.pop();
                updateUndoBtn();
                return;
            }

            // Call removeSourceLine via jQuery trigger or direct function call
            try {
                if (iWin.jQuery) {
                    var targetBtn = iDoc.querySelector('button[onclick*="removeSourceLine(\'' + parentLineId + '\',\'' + sourceLineId + '\')"]');
                    if (targetBtn) {
                        iWin.jQuery(targetBtn).trigger('click');
                    } else {
                        iWin.removeSourceLine(parentLineId, sourceLineId);
                    }
                } else {
                    iWin.removeSourceLine(parentLineId, sourceLineId);
                }
            } catch (e) {
                setFeedback('Could not remove: ' + e.message, false);
                updateUndoBtn();
                return;
            }

            // Poll for the input to be removed from DOM
            var waited = 0;
            var pollTimer = setInterval(function () {
                waited += 200;
                var stillHere = iDoc.getElementById(inputId);
                if (!stillHere || waited >= 5000) {
                    clearInterval(pollTimer);
                    updateMainLineTotal(parentLineId);
                    setTimeout(function () {
                        var qtyInput = iDoc.getElementById('OrderLineQuantity_' + parentLineId);
                        var isZero = qtyInput && parseFloat(qtyInput.value) === 0;
                        if (isZero) {
                            var origConfirm = iWin.confirm;
                            iWin.confirm = function () { return true; };
                            try {
                                iWin.removeLine(parentLineId);
                            } catch (e) {
                                var parentRow = iDoc.getElementById('OrderLine_' + parentLineId);
                                if (parentRow) {
                                    var rmBtn = parentRow.querySelector('button[onclick*="removeLine"]');
                                    if (rmBtn) rmBtn.click();
                                }
                            }
                            setTimeout(function () {
                                iWin.confirm = origConfirm;
                                clickSaveInIframe();
                                setFeedback('↩ Undone ✓ (line removed)', true);
                                undoStack.pop();
                                updateUndoBtn();
                                setTimeout(updateTotalDisplay, 600);
                            }, 400);
                        } else {
                            clickSaveInIframe();
                            setFeedback('↩ Undone ✓', true);
                            undoStack.pop();
                            updateUndoBtn();
                            setTimeout(updateTotalDisplay, 600);
                        }
                    }, 400);
                }
            }, 200);
        }

        function setCollapsed(collapsed) {
            try { localStorage.setItem('bristow_tp_collapsed', collapsed ? '1' : '0'); } catch(e) {}
        }

        restorePosition(false);

        try {
            var wasCollapsed = localStorage.getItem('bristow_tp_collapsed') === '1';
            if (wasCollapsed) {
                panel.style.display = 'none';
                pill.style.display  = 'block';
            } else if (localStorage.getItem('bristow_tp_mode') === 'mini') {
                setTimeout(function () {
                    var miniBtn = document.getElementById('tp-mini');
                    if (miniBtn) miniBtn.click();
                }, 100);
            }
        } catch (e) {}

        loadTechList(function (techs) {
            var select = document.getElementById('tp-tech-select');
            if (!select) return;
            select.innerHTML = '';
            var def = document.createElement('option');
            def.value = orderRep; def.textContent = orderRep + ' (Order Rep)';
            select.appendChild(def);
            var sep = document.createElement('option');
            sep.disabled = true; sep.textContent = '── Assisting Techs ──';
            select.appendChild(sep);
            techs.forEach(function (t) {
                if (t.name.toLowerCase() === orderRep.toLowerCase()) return;
                var opt = document.createElement('option');
                opt.value = t.name; opt.textContent = t.name;
                select.appendChild(opt);
            });
            select.value = orderRep;
            updateTotalDisplay();

            // Read-only mode: hide all input controls, leaving only the Total Hours box
            if (readOnly) {
                var lr  = document.getElementById('tp-label-row');
                var fr  = document.getElementById('tp-row');
                var mc  = document.getElementById('tp-mini-controls');
                if (lr) lr.style.display = 'none';
                if (fr) fr.style.display = 'none';
                if (mc) mc.style.display = 'none';
                // Shrink panel width to fit just the tech card + total box
                var root = document.getElementById('timePanelRoot');
                if (root) root.style.width = 'auto';
                // Retry updating total hours — iframe may not be fully ready yet
                var totalRetries = 0;
                function tryUpdateTotal() {
                    var total = getTotalHours();
                    if (total !== null) {
                        var el = document.getElementById('tp-total');
                        if (el) el.textContent = total + 'h';
                    } else if (totalRetries < 10) {
                        totalRetries++;
                        setTimeout(tryUpdateTotal, 1000);
                    }
                }
                tryUpdateTotal();
            }
        });

        var isDragging = false, dragOffX, dragOffY;
        var DRAG_IGNORE = { 'tp-close': 1, 'tp-mini': 1, 'tp-set': 1, 'tp-set-m': 1, 'tp-hours': 1, 'tp-hours-m': 1, 'tp-tech-select': 1, 'tp-undo': 1, 'tp-undo-m': 1 };
        panel.addEventListener('pointerdown', function (e) {
            if (DRAG_IGNORE[e.target.id]) return;
            isDragging = true;
            dragOffX = e.clientX - panel.getBoundingClientRect().left;
            dragOffY = e.clientY - panel.getBoundingClientRect().top;
            panel.setPointerCapture(e.pointerId);
            panel.style.cursor = 'grabbing';
        });
        panel.addEventListener('pointermove', function (e) {
            if (!isDragging) return;
            panel.style.right  = 'auto';
            panel.style.bottom = 'auto';
            panel.style.left   = (e.clientX - dragOffX) + 'px';
            panel.style.top    = (e.clientY - dragOffY) + 'px';
        });
        panel.addEventListener('pointerup', function () {
            isDragging = false;
            panel.style.cursor = '';
            try {
                var posKey = panel.classList.contains('tp-mini') ? 'bristow_tp_pos_mini' : 'bristow_tp_pos_full';
                localStorage.setItem(posKey, JSON.stringify({
                    left: panel.style.left,
                    top:  panel.style.top,
                    right:  panel.style.right,
                    bottom: panel.style.bottom
                }));
            } catch (e) {}
        });

        function selectOnFocus(el) {
            el.addEventListener('focus', function () {
                var inp = this;
                inp.type = 'text';
                inp.select();
                inp.type = 'number';
            });
        }

        var hoursInput = document.getElementById('tp-hours');
        selectOnFocus(hoursInput);

        hoursInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('tp-set').click();
            }
        });

        document.getElementById('tp-close').addEventListener('click', function () {
            panel.style.display = 'none';
            pill.style.display  = 'block';
            setCollapsed(true);
        });

        pill.addEventListener('click', function () {
            pill.style.display  = 'none';
            panel.style.display = 'block';
            setCollapsed(false);
        });

        var hoursMini = document.getElementById('tp-hours-m');
        selectOnFocus(hoursMini);
        hoursMini.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                var h = parseFloat(document.getElementById('tp-hours-m').value);
                document.getElementById('tp-hours').value = h;
                handleLogHours(h);
            }
        });

        document.getElementById('tp-set-m').addEventListener('mousedown', function (e) {
            e.preventDefault();
            var h = parseFloat(document.getElementById('tp-hours-m').value);
            document.getElementById('tp-hours').value = h;
            handleLogHours(h);
        });

        panel.addEventListener('click', function (e) {
            var target = e.target;
            if (target.id === 'tp-undo' || target.id === 'tp-undo-m') {
                e.preventDefault();
                undoLastAction();
            } else if (target.parentNode && (target.parentNode.id === 'tp-undo' || target.parentNode.id === 'tp-undo-m')) {
                e.preventDefault();
                undoLastAction();
            }
        });

        updateUndoBtn();

        document.getElementById('tp-mini').addEventListener('click', function () {
            var isMini = panel.classList.toggle('tp-mini');
            this.title       = isMini ? 'Expand' : 'Mini mode';
            this.textContent = isMini ? '▣' : '▬';
            try { localStorage.setItem('bristow_tp_mode', isMini ? 'mini' : 'full'); } catch (e) {}
            restorePosition(isMini);

            var mc  = document.getElementById('tp-mini-controls');
            var lr  = document.getElementById('tp-label-row');
            var fr  = document.getElementById('tp-row');
            var sub = document.getElementById('tp-sub');
            if (mc)  mc.style.display  = isMini ? 'flex'  : 'none';
            if (lr)  lr.style.display  = isMini ? 'none'  : 'flex';
            if (fr)  fr.style.display  = isMini ? 'none'  : 'flex';
            if (sub) sub.style.display = isMini ? 'none'  : 'block';
            var fhd = document.getElementById('tp-feedback-hdr');
            if (fhd) fhd.style.display = isMini ? 'block' : 'none';
        });

        document.getElementById('tp-tech-select').addEventListener('change', function () {
            updateBadge(this.value, this.value === orderRep);
        });

        function handleLogHours(hoursVal) {
            if (isNaN(hoursVal) || hoursVal <= 0)
                return setFeedback('Enter a valid number of hours.', false);
            var select       = document.getElementById('tp-tech-select');
            var selectedName = (select && select.value) ? select.value : orderRep;
            var serviceId    = getServiceIdForTech(selectedName, _techList || []);
            if (!serviceId)
                return setFeedback('Could not find service ID for ' + selectedName + '.', false);
            var fullBtn = document.getElementById('tp-set');
            var miniBtn = document.getElementById('tp-set-m');
            if (fullBtn) { fullBtn.disabled = true; fullBtn.textContent = 'Working...'; }
            if (miniBtn) { miniBtn.disabled = true; miniBtn.textContent = 'Working...'; }
            logHours(hoursVal, selectedName, serviceId);
            setTimeout(function () {
                if (select) { select.value = orderRep; updateBadge(orderRep, true); }
            }, 500);
        }

        document.getElementById('tp-set').addEventListener('click', function () {
            handleLogHours(parseFloat(document.getElementById('tp-hours').value));
        });
    }

    function initPanel() {
        waitForJobUrl().then(function (jobUrl) {
            if (!jobUrl) {
                warn('No job URL found — panel skipped.');
                return;
            }

            var readOnly = isOrderComplete();

            log('Tech Panel waiting for Time Expanded iframe...');

            // Wait for the visible Time Expanded iframe
            poll('Time Expanded iframe', function () {
                return document.querySelector('#collapseTimeExpanded iframe');
            }, function (teIframe) {
                log('✅ Connected to Time Expanded iframe');
                _iframe = teIframe;
                waitForIframeReady(function () {
                    loadTechList(function () {});
                    createPanel(readOnly);
                });
            }, 25000, 500);
        });
    }

    initPanel();

})();
