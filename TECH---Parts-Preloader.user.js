// ==UserScript==
// @name         TECH - Parts Preloader
// @namespace    http://tampermonkey.net/
// @version      3.0
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Parts-Preloader.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Parts-Preloader.user.js
// @description  Caches full parts dataset in IndexedDB — instant load after first fetch
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    var DB_NAME    = 'BristowPartsCache';
    var DB_VERSION = 1;
    var STORE_NAME = 'parts';
    var CACHE_KEY  = 'allParts';
    var MAX_AGE_MS = 24 * 60 * 60 * 1000; // refresh cache once per day

    // =========================================================================
    // STATUS INDICATOR
    // =========================================================================

    var _indicator = null;

    function showStatus(msg, color) {
        if (!_indicator) {
            _indicator = document.createElement('div');
            _indicator.id = 'parts-cache-indicator';
            _indicator.style.cssText = [
                'position:fixed', 'bottom:70px', 'left:16px', 'z-index:99999',
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
        var tries   = 0;
        var maxTries = 60; // up to ~12 seconds
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
        var originalSuccess = grid.dataSource.options.transport.read.success
                           || grid.dataSource.transport.options.read.success;

        // Hook into dataSource change event — fires after data is loaded
        grid.dataSource.bind('change', function () {
            var data = grid.dataSource.data();
            if (!data || data.length === 0) return;

            // Convert Kendo ObservableArray to plain objects
            var plain = [];
            for (var i = 0; i < data.length; i++) {
                plain.push(data[i].toJSON ? data[i].toJSON() : data[i]);
            }

            var payload = {
                timestamp : Date.now(),
                records   : plain
            };

            dbSet(CACHE_KEY, payload, function (err) {
                if (err) {
                    console.warn('[PartsCache] Save failed:', err);
                } else {
                    console.log('[PartsCache] Saved ' + plain.length + ' parts to IndexedDB.');
                }
            });
        });
    }

    // =========================================================================
    // INJECT: load cached data directly into grid, skip server fetch
    // =========================================================================

    function injectFromCache(grid, records) {
        try {
            // Override the transport read so Kendo doesn't hit the server
            grid.dataSource.transport.read = function (options) {
                options.success(records);
            };

            // Trigger read — will now use our override
            grid.dataSource.read();
            console.log('[PartsCache] Injected ' + records.length + ' parts from cache.');
        } catch (e) {
            console.warn('[PartsCache] Inject failed, falling back to server fetch:', e);
            grid.dataSource.read();
        }
    }

    // =========================================================================
    // BACKGROUND REFRESH: re-fetch from server silently to update cache
    // =========================================================================

    function backgroundRefresh(grid) {
        showStatus('🔄 Refreshing parts cache...', '#555');
        // Restore normal server transport then read
        grid.dataSource.transport.read = grid.dataSource.options.transport.read;
        interceptAndCache(grid);
        grid.dataSource.read();
        grid.dataSource.bind('change', function () {
            hideStatus(1000);
        });
    }

    // =========================================================================
    // MAIN
    // =========================================================================

    window.addEventListener('load', function () {
        waitForGrid(function (grid) {

            dbGet(CACHE_KEY, function (err, cached) {

                var now     = Date.now();
                var isStale = !cached || (now - cached.timestamp) > MAX_AGE_MS;
                var isEmpty = !cached || !cached.records || cached.records.length === 0;

                if (isEmpty) {
                    // No cache yet — let Kendo fetch normally and save the result
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
                    // Cache exists but is old — inject cache instantly, refresh in background
                    showStatus('⚡ Parts loaded from cache', '#27ae60');
                    injectFromCache(grid, cached.records);
                    hideStatus(1500);
                    // After a short delay, silently refresh cache in background
                    setTimeout(function () {
                        backgroundRefresh(grid);
                    }, 5000);

                } else {
                    // Cache is fresh — inject instantly
                    showStatus('⚡ Parts loaded from cache', '#27ae60');
                    injectFromCache(grid, cached.records);
                    hideStatus(1500);
                }

            });
        });
    });

})();