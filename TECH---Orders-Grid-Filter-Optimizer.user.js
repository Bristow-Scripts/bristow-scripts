// ==UserScript==
// @name         TECH - Orders Grid Filter Optimizer
// @namespace    http://tampermonkey.net/
// @version      1.4
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Orders-Grid-Filter-Optimizer.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Orders-Grid-Filter-Optimizer.user.js
// @description  Tech version of Orders Grid Optimizer. Same as SH version but defaults Show Complete & Cancelled to OFF.
// @match        https://bristow-app.azurewebsites.net/Orders/Orders
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    var DB_NAME    = 'BristowOrdersCache';
    var DB_VERSION = 1;
    var STORE_NAME = 'orders';
    var CACHE_KEY  = 'allOrders';
    var MAX_AGE_MS = 5 * 60 * 1000;

    // =========================================================================
    // STATUS
    // =========================================================================

    function showStatus(msg, color) {
        var el = document.getElementById('ofg-status');
        if (!el) return;
        el.textContent = msg; el.style.background = color || '#555'; el.style.opacity = '1';
    }
    function hideStatus(ms) {
        setTimeout(function () {
            var el = document.getElementById('ofg-status');
            if (el) el.style.opacity = '0';
        }, ms || 2000);
    }

    // =========================================================================
    // INDEXEDDB
    // =========================================================================

    function openDB(cb) {
        var req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function (e) { e.target.result.createObjectStore(STORE_NAME); };
        req.onsuccess = function (e) { cb(null, e.target.result); };
        req.onerror   = function (e) { cb(e.target.error, null); };
    }
    function dbGet(key, cb) {
        openDB(function (err, db) {
            if (err) return cb(err, null);
            var req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
            req.onsuccess = function (e) { cb(null, e.target.result); };
            req.onerror   = function (e) { cb(e.target.error, null); };
        });
    }
    function dbSet(key, val, cb) {
        openDB(function (err, db) {
            if (err) return cb && cb(err);
            var req = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(val, key);
            req.onsuccess = function () { cb && cb(null); };
            req.onerror   = function (e) { cb && cb(e.target.error); };
        });
    }

    // =========================================================================
    // FETCH ALL ORDERS FROM SERVER
    // =========================================================================

    function fetchAllOrders(cb) {
        var token = (document.querySelector('input[name="__RequestVerificationToken"]') || {}).value || '';
        var body = [
            'sort=', 'page=1', 'pageSize=999999', 'group=', 'filter=',
            '__RequestVerificationToken=' + encodeURIComponent(token),
            'wCompleted=true'
        ].join('&');

        fetch('/Orders/Orders?handler=Orders', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
            body: body
        })
        .then(function (r) { return r.json(); })
        .then(function (data) { cb(null, data && data.Data ? data.Data : []); })
        .catch(function (e) { cb(e, null); });
    }

    // =========================================================================
    // INJECT — destroy and recreate grid in client-side mode with cached data
    // =========================================================================

    function injectIntoGrid(records) {
        var $grid = $('#grid');
        var grid  = $grid.data('kendoGrid');
        if (!grid) return;

        // Save current filter and sort state before destroying
        var savedFilter = grid.dataSource.filter() ? JSON.parse(JSON.stringify(grid.dataSource.filter())) : null;
        var savedSort   = grid.dataSource.sort()   ? JSON.parse(JSON.stringify(grid.dataSource.sort()))   : null;
        var savedPage   = grid.dataSource.page()   || 1;

        // Grab existing column config so we don't lose any customisation
        var columns  = grid.options.columns;
        var pageable = grid.options.pageable;
        var sortable = grid.options.sortable;

        // Destroy existing grid
        grid.destroy();
        $grid.empty();

        // Recreate in pure client-side mode with all records as local data
        $grid.kendoGrid({
            dataSource: {
                data:     records,
                pageSize: 25,
                schema: {
                    model: {
                        fields: {
                            CreatedAt:      { type: 'date' },
                            ControlledGood: { type: 'boolean' },
                            OrderTotal:     { type: 'number' }
                        }
                    }
                }
            },
            columns:    columns,
            pageable:   { pageSizes: [5, 10, 25, 50, 100], buttonCount: 3 },
            sortable:   sortable,
            filterable: { extra: false, operators: { string: { contains: "Contains", eq: "Is equal to", startswith: "Starts with", doesnotcontain: "Does not contain" }, number: { eq: "Is equal to", gte: "Is greater than or equal to", lte: "Is less than or equal to" }, date: { eq: "Is equal to", gte: "Is after or equal to", lte: "Is before or equal to" }, enums: { eq: "Is equal to" } } },
            scrollable: false,
            noRecords:  { template: "<div style='padding:10px;'>No records found.</div>" }
        });

        // Restore filter, sort and page after recreating
        var newGrid = $grid.data('kendoGrid');
        if (newGrid) {
            if (savedSort)   newGrid.dataSource.sort(savedSort);
            if (savedFilter) newGrid.dataSource.filter(savedFilter);
            if (savedPage)   newGrid.dataSource.page(savedPage);
        }

        console.log('[OrdersCache] Grid recreated client-side with ' + records.length + ' orders.');
    }

    // =========================================================================
    // SHOW COMPLETE & CANCELLED — client-side filter
    // =========================================================================

    function applyCompletedFilter() {
        try {
            var sw = $('#wCompleted').data('kendoSwitch');
            var grid = $('#grid').data('kendoGrid');
            if (!sw || !grid) return;

            var ds = grid.dataSource;
            var current = ds.filter() ? ds.filter().filters.slice() : [];

            // Remove existing completed filter
            current = current.filter(function (f) {
                return !(f.field === 'OrderStatus' && f._completedFilter);
            });

            if (!sw.check()) {
                // Toggle is OFF — hide Complete and Cancelled
                current.push({ field: 'OrderStatus', operator: 'neq', value: 'Complete',  _completedFilter: true });
                current.push({ field: 'OrderStatus', operator: 'neq', value: 'Cancelled', _completedFilter: true });
            }

            ds.filter(current);
        } catch (e) {}
    }

    function setCompletedDefault() {
        try {
            var sw = $('#wCompleted').data('kendoSwitch');
            if (sw) {
                if (sw.check()) sw.check(false);
                // Wire toggle to client-side filter
                sw.unbind('change');
                sw.bind('change', applyCompletedFilter);
                // Apply filter immediately on load since default is OFF
                applyCompletedFilter();
            }
        } catch (e) {}
    }

    // =========================================================================
    // INJECT UI
    // =========================================================================

    function injectUI() {
        if (document.getElementById('ofg-status')) return;
        var well = document.querySelector('.well.well-sm.open-bottom');
        if (!well) return;

        var status = document.createElement('div');
        status.id = 'ofg-status';
        status.style.cssText = [
            'position:fixed','bottom:16px','left:16px','z-index:99999',
            'background:#555','color:#fff','font-size:12px',
            'font-family:system-ui,sans-serif','padding:5px 10px',
            'border-radius:6px','opacity:0','pointer-events:none',
            'transition:opacity 0.3s'
        ].join(';');
        document.body.appendChild(status);

        var row = document.createElement('div');
        row.style.cssText = 'margin-top:8px;display:flex;gap:8px;align-items:center;';

        var refreshBtn = document.createElement('button');
        refreshBtn.id = 'ofg-refresh-btn';
        refreshBtn.textContent = '🔄 Refresh Orders';
        refreshBtn.style.cssText = [
            'padding:5px 14px','background:#555','color:#fff',
            'border:none','border-radius:5px','font-size:13px',
            'font-family:system-ui,sans-serif','font-weight:600','cursor:pointer'
        ].join(';');
        refreshBtn.addEventListener('click', function () {
            showStatus('🔄 Refreshing...', '#555');
            fetchAllOrders(function (err, records) {
                if (err || !records) { showStatus('❌ Refresh failed', '#c0392b'); hideStatus(3000); return; }
                dbSet(CACHE_KEY, { timestamp: Date.now(), records: records });
                injectIntoGrid(records);
                showStatus('✔ ' + records.length + ' orders refreshed', '#27ae60');
                hideStatus(2500);
            });
        });

        var clearBtn = document.createElement('button');
        clearBtn.id = 'ofg-clear-btn';
        clearBtn.textContent = '✕ Clear Filters';
        clearBtn.style.cssText = [
            'padding:5px 14px','background:#fff','color:#c0392b',
            'border:1px solid #c0392b','border-radius:5px','font-size:13px',
            'font-family:system-ui,sans-serif','font-weight:600','cursor:pointer'
        ].join(';');
        clearBtn.addEventListener('click', function () {
            // Clear all top text inputs
            ['OrderRepSearch','OrderNumberSearch','ProjectSearch',
             'CompanySearch','ContactSearch'].forEach(function (id) {
                var el = document.getElementById(id);
                if (el) el.value = '';
            });

            // Reset office multiselect
            try { $('#officeSelect').data('kendoMultiSelect').value([]); } catch (e) {}

            // Reset status dropdown
            var ss = document.getElementById('ofg-status-search');
            if (ss) ss.value = '';

            // Clear all grid filters at once
            var grid = $('#grid').data('kendoGrid');
            if (grid) {
                grid.dataSource.filter([]);
                // Reset sort back to default (CreatedAt descending)
                grid.dataSource.sort({ field: 'CreatedAt', dir: 'desc' });
            }

            // Reset WIP button colour
            var wb = document.getElementById('ofg-wip-btn');
            if (wb) wb.style.background = '#8e44ad';

            // Always reset Show Complete & Cancelled to ON and re-apply
            try {
                var sw = $('#wCompleted').data('kendoSwitch');
                if (sw) {
                    sw.check(false);
                    applyCompletedFilter();
                }
            } catch (e) {}
        });

        var wipBtn = document.createElement('button');
        wipBtn.id = 'ofg-wip-btn';
        wipBtn.textContent = '🔧 WIP Orders';
        wipBtn.title = 'Filter to Work in Progress orders only';
        wipBtn.style.cssText = [
            'padding:5px 14px','background:#8e44ad','color:#fff',
            'border:none','border-radius:5px','font-size:13px',
            'font-family:system-ui,sans-serif','font-weight:600','cursor:pointer'
        ].join(';');
        wipBtn.addEventListener('click', function () {
            // Refresh orders first so the list is always current before filtering
            wipBtn.disabled = true;
            wipBtn.textContent = '⏳ Refreshing...';
            showStatus('🔄 Refreshing orders...', '#555');

            fetchAllOrders(function (err, records) {
                wipBtn.disabled = false;
                wipBtn.textContent = '🔧 WIP Orders';
                wipBtn.style.background = '#6c3483';

                if (!err && records && records.length > 0) {
                    dbSet(CACHE_KEY, { timestamp: Date.now(), records: records });
                    injectIntoGrid(records);
                    showStatus('✔ Orders refreshed', '#27ae60');
                    hideStatus(1500);
                } else {
                    showStatus('⚠ Refresh failed — using cached data', '#e67e22');
                    hideStatus(2500);
                }

                // Apply WIP filters after refresh (or on cached data if refresh failed)
                setTimeout(function () {
                    var grid = $('#grid').data('kendoGrid');
                    if (!grid) return;
                    var ds = grid.dataSource;
                    var current = ds.filter() ? ds.filter().filters.slice() : [];

                    // Remove existing BristowStatus filter
                    current = current.filter(function (f) { return f.field !== 'BristowStatus'; });

                    current.push({ field: 'BristowStatus', operator: 'eq', value: 'Work in Progress' });
                    ds.filter(current);

                    // Turn off Show Complete & Cancelled
                    try {
                        var sw = $('#wCompleted').data('kendoSwitch');
                        if (sw && sw.check()) {
                            sw.check(false);
                            applyCompletedFilter();
                        }
                    } catch (e) {}

                    // Sort by OrderRep alphabetically
                    try {
                        if (grid) grid.dataSource.sort({ field: 'OrderRep', dir: 'asc' });
                    } catch (e) {}
                }, 100);
            });
        });

        var hint = document.createElement('span');
        hint.style.cssText = 'font-size:11px;color:#888;font-family:system-ui,sans-serif;';
        hint.textContent = 'Refresh to pick up new orders';

        row.appendChild(refreshBtn);
        row.appendChild(clearBtn);
        row.appendChild(wipBtn);
        row.appendChild(hint);
        well.appendChild(row);

        // --- Order Status search box (same style as Bristow's other filters) ---
        var statusGroup = document.createElement('div');
        statusGroup.className = 'search-group';

        var statusLabel = document.createElement('label');
        statusLabel.textContent = 'Order Status:';

        var statusSelect = document.createElement('select');
        statusSelect.id = 'ofg-status-search';
        statusSelect.className = 'form-control';
        statusSelect.style.cssText = 'width:85%;display:inline-block;';
        statusGroup.style.cssText = 'width:510px;background-color:#d8d8d8;padding:5px;border-radius:5px;margin-bottom:5px;display:inline-block;';

        var statuses = ['', 'Open', 'InProgress', 'Complete', 'Cancelled', 'Ready'];
        statuses.forEach(function (s) {
            var opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s === '' ? '(All)' : s;
            statusSelect.appendChild(opt);
        });

        statusSelect.addEventListener('change', function () {
            var grid = $('#grid').data('kendoGrid');
            if (!grid) return;
            var ds = grid.dataSource;
            var current = ds.filter() ? ds.filter().filters.slice() : [];

            // Remove existing OrderStatus filter
            current = current.filter(function (f) { return f.field !== 'OrderStatus'; });

            if (statusSelect.value) {
                current.push({ field: 'OrderStatus', operator: 'eq', value: statusSelect.value });
            }
            ds.filter(current);
        });

        statusGroup.appendChild(statusLabel);
        statusGroup.appendChild(statusSelect);
        // Insert directly after Contact group with a line break before it
        // so it stacks underneath Contact in the same left column position
        var contactGroup = document.getElementById('ContactSearch');
        contactGroup = contactGroup ? contactGroup.closest('.search-group') : null;
        if (contactGroup) {
            var br = document.createElement('br');
            contactGroup.parentNode.insertBefore(br, contactGroup.nextSibling);
            contactGroup.parentNode.insertBefore(statusGroup, br.nextSibling);
        } else {
            well.insertBefore(statusGroup, row);
        }
    }

    // =========================================================================
    // MAIN
    // =========================================================================

    window.addEventListener('load', function () {
        var tries = 0;
        var tid = setInterval(function () {
            tries++;
            var grid = window.$ && $('#grid').data('kendoGrid');
            if (grid && grid.dataSource) {
                clearInterval(tid);
                injectUI();
                setCompletedDefault();

                dbGet(CACHE_KEY, function (err, cached) {
                    var now     = Date.now();
                    var isEmpty = !cached || !cached.records || cached.records.length === 0;
                    var isStale = !cached || (now - cached.timestamp) > MAX_AGE_MS;

                    if (isEmpty) {
                        showStatus('⏳ Loading all orders (first time)...', '#555');
                        fetchAllOrders(function (err, records) {
                            if (err || !records) { showStatus('❌ Failed to load', '#c0392b'); hideStatus(3000); return; }
                            dbSet(CACHE_KEY, { timestamp: now, records: records });
                            injectIntoGrid(records);
                            showStatus('✔ ' + records.length + ' orders loaded & cached', '#27ae60');
                            hideStatus(2500);

                            // Start recurring auto-refresh now that first load is done
                            setInterval(function () {
                                fetchAllOrders(function (err, records) {
                                    if (err || !records) return;
                                    dbSet(CACHE_KEY, { timestamp: Date.now(), records: records });
                                    injectIntoGrid(records);
                                    showStatus('🔄 Auto-refreshed', '#27ae60');
                                    hideStatus(2000);
                                    console.log('[OrdersCache] Auto-refreshed ' + records.length + ' orders.');
                                });
                            }, 5 * 60 * 1000);
                        });
                    } else {
                        showStatus('⚡ Orders loaded from cache', '#27ae60');
                        injectIntoGrid(cached.records);
                        hideStatus(1500);

                        if (isStale) {
                            setTimeout(function () {
                                showStatus('🔄 Refreshing in background...', '#555');
                                fetchAllOrders(function (err, records) {
                                    if (err || !records) return;
                                    dbSet(CACHE_KEY, { timestamp: Date.now(), records: records });
                                    injectIntoGrid(records);
                                    showStatus('✔ Orders updated', '#27ae60');
                                    hideStatus(2000);
                                });
                            }, 3000);
                        }
                    }
                });
            }
            if (tries > 40) clearInterval(tid);
        }, 250);
    });

})();
