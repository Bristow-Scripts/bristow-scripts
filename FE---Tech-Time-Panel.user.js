// ==UserScript==
// @name         FE - Tech Time Panel
// @namespace    http://tampermonkey.net/
// @version      1.0
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/FE---Tech-Time-Panel.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/FE---Tech-Time-Panel.user.js
// @description  View-only floating panel: quick view of a tech's hours on a work order. Keeps the Time Expanded section (the iframe the panel reads from). No labor-line writing, no quick add tool.
// @require      https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Shared-Core.user.js
// @match        https://liquid-264-drc0bgd0eje0ckcg.westus3-01.azurewebsites.net/Orders/Orders/Edit*
// @grant        none
// @tag          FE
// @run-at       document-end
// ==/UserScript==

// =========================================================================
// SCRIPT 1: TECH - Time Expanded Section Trimmed  (unchanged)
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
                li.classList.add("active");
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
// SCRIPT 2: FE - Tech Time Panel (view-only)
// =========================================================================
(function () {
    'use strict';

    if (window !== window.top) return;

    var _iframe     = null;
    var _panelReady = false;
    var TS = window.TechShared;

    function log(msg)  { TS ? TS.log(msg) : console.log('[TechTime] ' + msg); }
    function warn(msg) { TS ? TS.log(msg, 'warn') : console.warn('[TechTime] ' + msg); }

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

    // =========================================================================
    // IFRAME ACCESS (Time Expanded section)
    // =========================================================================

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

    function waitForIframeReady(callback) {
        if (TS) { TS.iframe.waitForReady(callback, 60000); return; }
        poll('iframe ready', function () {
            var iDoc = getIframeDoc();
            return (iDoc && iDoc.querySelector('.k-input-value-text')) ? true : null;
        }, callback, 60000, 800);
    }

    // =========================================================================
    // READ HELPERS
    // =========================================================================

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

    function orderLineDocs() {
        var docs = [];
        var te = document.querySelector('#collapseTimeExpanded iframe');
        if (te) { try { if (te.contentDocument) docs.push(te.contentDocument); } catch (e) {} }
        if (_iframe && (!te || _iframe !== te)) {
            try { if (_iframe.contentDocument) docs.push(_iframe.contentDocument); } catch (e) {}
        }
        return docs;
    }

    function isExcludedRow(rowHtml) {
        return rowHtml.indexOf('S-100238') !== -1 || rowHtml.indexOf('S-100215') !== -1;
    }

    function getTotalHours() {
        var docs = orderLineDocs();

        for (var d = 0; d < docs.length; d++) {
            var iDoc = docs[d];
            var inputs = iDoc.querySelectorAll('input[id^="OrderLineQuantity_"]');
            if (!inputs.length) continue;

            var total = 0;
            var found = false;

            inputs.forEach(function (el) {
                var row = el.closest('tr');
                if (!row) return;

                if (isExcludedRow(row.innerHTML || '')) return;

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

    var TECH_DESC_RE = /^[A-Za-z]+\s+[A-Za-z].*\s-\sHours$/i;

    function techNameFrom(text) {
        var m = /^(.*?)\s-\sHours$/i.exec(text.trim());
        return m ? m[1].replace(/\s+/g, ' ').trim() : text.trim();
    }

    // Collects {name, hours} for every tech labour line currently on the job.
    function collectTechHours() {
        var docs = orderLineDocs();
        var found = false;
        var list = [];

        for (var d = 0; d < docs.length; d++) {
            var iDoc = docs[d];
            var inputs = iDoc.querySelectorAll('input[id^="OrderLineQuantity_"]');
            if (!inputs.length) continue;
            found = true;

            inputs.forEach(function (el) {
                var row = el.closest('tr');
                if (!row) return;

                var rowHtml = row.innerHTML || '';
                if (isExcludedRow(rowHtml)) return;

                var desc = '';
                var cells = row.querySelectorAll('.condensedCell');
                for (var i = 0; i < cells.length; i++) {
                    var t = cells[i].textContent.replace(/\s+/g, ' ').trim();
                    if (TECH_DESC_RE.test(t)) { desc = t; break; }
                }
                if (!desc) {
                    var joined = Array.prototype.map.call(cells, function (c) {
                        return c.textContent.replace(/\s+/g, ' ').trim();
                    }).join(' ').trim();
                    if (TECH_DESC_RE.test(joined)) desc = joined;
                }
                if (!desc) return;

                var v = parseFloat(el.value);
                list.push({ name: techNameFrom(desc), hours: isNaN(v) ? 0 : v });
            });
        }

        if (!found) return null;

        list.sort(function (a, b) { return a.name.localeCompare(b.name); });
        return list;
    }

    // =========================================================================
    // UI
    // =========================================================================

    function updateTotalDisplay() {
        var el = document.getElementById('tp-total');
        if (!el) return;
        var total = getTotalHours();
        el.textContent = total !== null ? total + 'h' : '—';
    }

    function renderTechList() {
        var box = document.getElementById('tp-list');
        if (!box) return;

        var list = collectTechHours();
        if (list === null) {
            box.innerHTML = '<div class="tp-empty">Waiting for job lines&hellip;</div>';
            return;
        }
        if (!list.length) {
            box.innerHTML = '<div class="tp-empty">No tech hours logged yet</div>';
            return;
        }

        var orderRep = getOrderRepName().toLowerCase();
        var html = '';
        for (var i = 0; i < list.length; i++) {
            var isRep = list[i].name.toLowerCase() === orderRep;
            html += '<div class="tp-row-item' + (isRep ? ' tp-rep' : '') + '">' +
                        '<span class="tp-row-name">' + escapeHtml(list[i].name) + (isRep ? ' <em>(Order Rep)</em>' : '') + '</span>' +
                        '<span class="tp-row-hrs">' + (Math.round(list[i].hours * 100) / 100) + 'h</span>' +
                    '</div>';
        }
        box.innerHTML = html;
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function updateDisplay() {
        updateTotalDisplay();
        renderTechList();
    }

    function createPanel() {
        if (_panelReady || document.getElementById('timePanelRoot')) return;
        _panelReady = true;

        var orderRep = getOrderRepName();
        var initials = getInitials(orderRep);

        var style = document.createElement('style');
        style.textContent = [
            '#timePanelRoot{position:fixed;bottom:24px;right:24px;z-index:99999;width:300px;background:#fff;border:1px solid #ddd;border-radius:10px;padding:11px 14px;font-family:system-ui,sans-serif;font-size:12px;color:#222;cursor:default;will-change:transform}',
            '#timePanelRoot *{box-sizing:border-box}',
            '#tp-header{display:flex;align-items:center;gap:6px;margin-bottom:8px;padding-right:50px}',
            '#tp-title{font-weight:700;font-size:13px;white-space:nowrap;margin-right:4px}',
            '#tp-header-btns{position:absolute;top:7px;right:9px;display:flex;gap:2px;z-index:2}',
            '#tp-mini,#tp-close{background:none;border:none;font-size:17px;cursor:pointer;color:#aaa;line-height:1;padding:0 2px}',
            '#tp-mini:hover,#tp-close:hover{color:#333}',
            '#tp-tech{display:flex;align-items:center;gap:6px;background:#f4f6f8;border-radius:7px;padding:7px 10px;margin-bottom:9px;transition:background .2s}',
            '#tp-avatar{width:30px;height:30px;border-radius:50%;background:#B5D4F4;color:#0C447C;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;flex-shrink:0}',
            '#tp-name-block{flex:1;min-width:0;overflow:hidden}',
            '#tp-name{font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
            '#tp-sub{font-size:10px;color:#888}',
            '#tp-total-box{background:#EAF3DE;border-radius:6px;padding:5px 9px;text-align:center;flex-shrink:0}',
            '#tp-total{font-weight:700;color:#3B6D11;font-size:14px;line-height:1.2}',
            '#tp-total-lbl{font-size:9px;color:#3B6D11;text-transform:uppercase;letter-spacing:.04em}',
            '#tp-list-lbl{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}',
            '#tp-list{max-height:180px;overflow:auto}',
            '.tp-row-item{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:4px 6px;border-bottom:1px solid #f0f0f0;font-size:12px}',
            '.tp-row-item.tp-rep{background:#f4f6f8;border-radius:4px;border-bottom:none}',
            '.tp-row-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
            '.tp-row-name em{font-style:normal;color:#0C447C;font-size:10px}',
            '.tp-row-hrs{font-weight:700;color:#3B6D11;white-space:nowrap}',
            '.tp-empty{font-size:11px;color:#999;padding:6px 2px}',
            '#timePanelRoot.tp-mini{width:auto;min-width:240px}',
            '#timePanelRoot.tp-mini #tp-list-lbl,#timePanelRoot.tp-mini #tp-list,#timePanelRoot.tp-mini #tp-sub{display:none!important}',
            '#timePanelRoot.tp-mini #tp-tech{margin-bottom:0}'
        ].join('\n');
        document.head.appendChild(style);

        var panel = document.createElement('div');
        panel.id = 'timePanelRoot';
        panel.innerHTML = [
            '<div id="tp-header">',
            '  <span id="tp-title">\u23F1 Tech Time</span>',
            '  <div id="tp-header-btns">',
            '    <button id="tp-mini" title="Mini mode">\u25AC</button>',
            '    <button id="tp-close" title="Collapse">&#8212;</button>',
            '  </div>',
            '</div>',
            '<div id="tp-tech">',
            '  <div id="tp-avatar">' + escapeHtml(initials) + '</div>',
            '  <div id="tp-name-block">',
            '    <div id="tp-name">' + escapeHtml(orderRep) + '</div>',
            '    <div id="tp-sub">Order Rep</div>',
            '  </div>',
            '  <div id="tp-total-box">',
            '    <div id="tp-total">\u2014</div>',
            '    <div id="tp-total-lbl">Total Hours</div>',
            '  </div>',
            '</div>',
            '<div id="tp-list-lbl">Tech Hours</div>',
            '<div id="tp-list"><div class="tp-empty">Waiting for job lines&hellip;</div></div>'
        ].join('');
        document.body.appendChild(panel);

        var pill = document.createElement('button');
        pill.id = 'tp-pill';
        pill.title = 'Show Tech Time Panel';
        pill.textContent = '\u23F1 Tech Time';
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
        resetBtn.textContent = '\u21BA Reset Panel';
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
            resetBtn.textContent = '\u2713 Reset';
            setTimeout(function () { resetBtn.textContent = '\u21BA Reset Panel'; }, 1500);
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

        function setCollapsed(collapsed) {
            try { localStorage.setItem('bristow_tp_collapsed', collapsed ? '1' : '0'); } catch (e) {}
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

        updateDisplay();

        var isDragging = false, dragOffX, dragOffY;
        var DRAG_IGNORE = { 'tp-close': 1, 'tp-mini': 1 };
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
                    right: panel.style.right,
                    bottom: panel.style.bottom
                }));
            } catch (e) {}
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
            updateDisplay();
        });

        document.getElementById('tp-mini').addEventListener('click', function () {
            var isMini = panel.classList.toggle('tp-mini');
            this.title       = isMini ? 'Expand' : 'Mini mode';
            this.textContent = isMini ? '\u25A3' : '\u25AC';
            try { localStorage.setItem('bristow_tp_mode', isMini ? 'mini' : 'full'); } catch (e) {}
            restorePosition(isMini);
        });

        setInterval(updateDisplay, 2000);
        log('Tech Time panel ready (view-only).');
    }

    function initPanel() {
        waitForJobUrl().then(function (jobUrl) {
            if (!jobUrl) {
                warn('No job URL found — panel skipped.');
                return;
            }

            log('Tech Panel waiting for Time Expanded iframe...');

            poll('Time Expanded iframe', function () {
                return document.querySelector('#collapseTimeExpanded iframe');
            }, function (teIframe) {
                log('Connected to Time Expanded iframe');
                _iframe = teIframe;
                waitForIframeReady(function () {
                    createPanel();
                });
            }, 25000, 500);
        });
    }

    initPanel();

})();
