// ==UserScript==
// @name         FE - Parts Preloader
// @namespace    http://tampermonkey.net/
// @version      4.2
// @description  Caches full parts dataset in IndexedDB — instant load after first fetch
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/FE---Parts-Preloader.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/FE---Parts-Preloader.user.js
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    var DB_NAME    = 'BristowPartsCache';
    var DB_VERSION = 1;
    var STORE_NAME = 'parts';
    var CACHE_KEY  = 'allParts';
    var MAX_AGE_MS = 60 * 60 * 1000; // refresh cache every hour

    var _indicator  = null;
    var _refreshBtn = null;
    var _currentGrid = null;

    function showStatus(msg, color) {
        if (!_indicator) {
            _indicator = document.createElement('div');
            _indicator.id = 'parts-cache-indicator';
            _indicator.style.cssText = [
                'position:fixed', 'bottom:110px', 'left:16px', 'z-index:99999',
                'background:#333', 'color:#fff', 'font-size:12px',
                'font-family:system-ui,sans-serif', 'padding:5px 10px',
                'border-radius:6px', 'opacity:0.85', 'pointer-events:none',
                'transition:opacity 0.4s'
            ].join(';');
            document.body.appendChild(_indicator);
        }
        _indicator.style.background = color || '#333';
        _indicator.style.opacity    = '0.85';
        _indicator.textContent      = msg;
    }

    function hideStatus(delay) {
        setTimeout(function () {
            if (_indicator) _indicator.style.opacity = '0';
        }, delay || 2000);
    }

    // =========================================================================
    // SILENT FETCH: fetch fresh parts via fetch() — never touches Kendo transport
    // =========================================================================

    function silentFetchAndCache(onDone) {
        // Use the same endpoint as the Kendo grid to ensure StockedTotal and DocCount are returned
        var params = [
            'sort%5B0%5D%5Bfield%5D=Description',
            'sort%5B0%5D%5Bdir%5D=asc',
            'page=1',
            'pageSize=999999'
        ].join('&');
        var url = '/Orders/Orders/Edit?handler=Parts&' + params;
        fetch(url, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var records = data && data.Data ? data.Data : (Array.isArray(data) ? data : null);
                if (!records || records.length === 0) {
                    console.warn('[PartsCache] Silent fetch returned no records.');
                    onDone && onDone(false);
                    return;
                }
                var payload = { timestamp: Date.now(), records: records };
                dbSet(CACHE_KEY, payload, function () {
                    // Update transport so next user search uses fresh data
                    // Do NOT call read() — avoids triggering the loading spinner mid-use
                    if (_currentGrid) {
                        _currentGrid.dataSource.transport.read = function (options) {
                            options.success(records);
                        };
                    }
                    console.log('[PartsCache] Silent fetch saved ' + records.length + ' parts.');
                    onDone && onDone(true);
                });
            })
            .catch(function (e) {
                console.warn('[PartsCache] Silent fetch failed:', e);
                onDone && onDone(false);
            });
    }

    function injectRefreshButton() {
        if (_refreshBtn) return;
        _refreshBtn = document.createElement('button');
        _refreshBtn.textContent = '🔄 Refresh Parts';
        _refreshBtn.style.cssText = [
            'position:fixed', 'bottom:140px', 'left:16px', 'z-index:99999',
            'background:#378ADD', 'color:#fff', 'font-size:12px',
            'font-family:system-ui,sans-serif', 'padding:5px 10px',
            'border-radius:6px', 'border:none', 'cursor:pointer',
            'font-weight:600', 'transition:background 0.2s'
        ].join(';');
        _refreshBtn.addEventListener('click', function () {
            if (!_currentGrid) return;
            _refreshBtn.textContent = '⏳ Refreshing...';
            _refreshBtn.style.background = '#555';
            _refreshBtn.disabled = true;
            silentFetchAndCache(function (success) {
                _refreshBtn.textContent = success ? '✔ Parts refreshed' : '❌ Failed';
                _refreshBtn.style.background = success ? '#27ae60' : '#c0392b';
                setTimeout(function () {
                    _refreshBtn.textContent = '🔄 Refresh Parts';
                    _refreshBtn.style.background = '#378ADD';
                    _refreshBtn.disabled = false;
                }, 2500);
            });
        });
        document.body.appendChild(_refreshBtn);
    }

    // =========================================================================
    // INDEXEDDB HELPERS
    // =========================================================================

    function openDB(callback) {
        var req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function (e) {
            e.target.result.createObjectStore(STORE_NAME);
        };
        req.onsuccess = function (e) { callback(null, e.target.result); };
        req.onerror   = function (e) { callback(e.target.error, null); };
    }

    function dbGet(key, callback) {
        openDB(function (err, db) {
            if (err) return callback(err, null);
            var tx  = db.transaction(STORE_NAME, 'readonly');
            var req = tx.objectStore(STORE_NAME).get(key);
            req.onsuccess = function (e) { callback(null, e.target.result); };
            req.onerror   = function (e) { callback(e.target.error, null); };
        });
    }

    function dbSet(key, value, callback) {
        openDB(function (err, db) {
            if (err) return callback && callback(err);
            var tx  = db.transaction(STORE_NAME, 'readwrite');
            var req = tx.objectStore(STORE_NAME).put(value, key);
            req.onsuccess = function () { callback && callback(null); };
            req.onerror   = function (e) { callback && callback(e.target.error); };
        });
    }

    // =========================================================================
    // WAIT FOR KENDO GRID
    // =========================================================================

    function waitForGrid(callback) {
        var tries    = 0;
        var maxTries = 60;
        var tid = setInterval(function () {
            tries++;
            try {
                var grid = window.$ && $('#partGrid').data('kendoGrid');
                if (grid && grid.dataSource) {
                    clearInterval(tid);
                    callback(grid);
                    return;
                }
            } catch (e) {}
            if (tries >= maxTries) {
                clearInterval(tid);
                console.warn('[PartsCache] Grid never appeared.');
            }
        }, 200);
    }

    // =========================================================================
    // INTERCEPT: save data after Kendo fetches it from server
    // =========================================================================

    function interceptAndCache(grid) {
        grid.dataSource.bind('change', function () {
            var data = grid.dataSource.data();
            if (!data || data.length === 0) return;
            var plain = [];
            for (var i = 0; i < data.length; i++) {
                plain.push(data[i].toJSON ? data[i].toJSON() : data[i]);
            }
            dbSet(CACHE_KEY, { timestamp: Date.now(), records: plain }, function (err) {
                if (err) console.warn('[PartsCache] Save failed:', err);
                else console.log('[PartsCache] Saved ' + plain.length + ' parts to IndexedDB.');
            });
        });
    }

    // =========================================================================
    // INJECT: load cached data into grid, skip server fetch
    // =========================================================================

    function injectFromCache(grid, records) {
        try {
            // Override transport so future reads (user searches) use cached data
            grid.dataSource.transport.read = function (options) {
                options.success(records);
            };
            // Use data() to set records directly — avoids triggering the Kendo
            // loading spinner that read() causes
            grid.dataSource.data(records);
            // Hide any stray loading overlay
            try { kendo.ui.progress(grid.wrapper, false); } catch (e2) {}
            console.log('[PartsCache] Injected ' + records.length + ' parts from cache.');
        } catch (e) {
            console.warn('[PartsCache] Inject failed:', e);
        }
    }

    // =========================================================================
    // MAIN
    // =========================================================================

    window.addEventListener('load', function () {
        waitForGrid(function (grid) {
            _currentGrid = grid;
            injectRefreshButton();

            dbGet(CACHE_KEY, function (err, cached) {
                var now     = Date.now();
                var isStale = !cached || (now - cached.timestamp) > MAX_AGE_MS;
                var isEmpty = !cached || !cached.records || cached.records.length === 0;

                if (isEmpty) {
                    showStatus('⏳ Loading parts (first time)...', '#555');
                    interceptAndCache(grid);
                    grid.dataSource.read();
                    grid.dataSource.bind('change', function () {
                        if (grid.dataSource.data().length > 0) {
                            showStatus('✔ Parts loaded & cached', '#27ae60');
                            hideStatus(2500);
                        }
                    });
                } else if (isStale) {
                    showStatus('⚡ Parts loaded from cache', '#27ae60');
                    injectFromCache(grid, cached.records);
                    hideStatus(1500);
                    // Background refresh via fetch — never touches Kendo transport
                    setTimeout(function () {
                        silentFetchAndCache(function (success) {
                            console.log('[PartsCache] Background refresh ' + (success ? 'succeeded' : 'failed'));
                        });
                    }, 5000);
                } else {
                    showStatus('⚡ Parts loaded from cache', '#27ae60');
                    injectFromCache(grid, cached.records);
                    hideStatus(1500);
                }
            });
        });
    });

})();
