// ==UserScript==
// @name         TECH - Parts Preloader
// @namespace    http://tampermonkey.net/
// @version      4.3
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Parts-Preloader.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Parts-Preloader.user.js
// @description  Caches full parts dataset in IndexedDB — instant load after first fetch
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @require      https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Shared-Core.user.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    var DB_NAME    = 'BristowPartsCache';
    var DB_VERSION = 1;
    var STORE_NAME = 'parts';
    var CACHE_KEY  = 'allParts';
    var MAX_AGE_MS = 24 * 60 * 60 * 1000;

    var _indicator   = null;
    var _refreshBtn  = null;
    var _currentGrid = null;

    var _log = function (msg, level) {
        var prefix = '[PartsCache]';
        if (window.TechShared) { TechShared.log(msg); return; }
        if (level === 'warn') console.warn(prefix + ' ' + msg);
        else console.log(prefix + ' ' + msg);
    };

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

    function silentFetchAndCache(onDone) {
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
                    _log('Silent fetch returned no records.', 'warn');
                    onDone && onDone(false);
                    return;
                }
                var payload = { timestamp: Date.now(), records: records };
                dbSet(CACHE_KEY, payload, function () {
                    if (_currentGrid) {
                        _currentGrid.dataSource.transport.read = function (options) {
                            options.success(records);
                        };
                    }
                    _log('Silent fetch saved ' + records.length + ' parts.');
                    onDone && onDone(true);
                });
            })
            .catch(function (e) {
                _log('Silent fetch failed: ' + e.message, 'warn');
                onDone && onDone(false);
            });
    }

    function injectRefreshButton() {
        if (_refreshBtn) return;
        _refreshBtn = document.createElement('button');
        _refreshBtn.textContent = '🔄 Refresh Parts';
        _refreshBtn.style.cssText = [
            'position:fixed', 'bottom:16px', 'left:16px', 'z-index:99999',
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

    function interceptAndCache(grid) {
        grid.dataSource.bind('change', function () {
            var data = grid.dataSource.data();
            if (!data || data.length === 0) return;
            var plain = [];
            for (var i = 0; i < data.length; i++) {
                plain.push(data[i].toJSON ? data[i].toJSON() : data[i]);
            }
            dbSet(CACHE_KEY, { timestamp: Date.now(), records: plain }, function (err) {
                if (err) _log('Save failed: ' + err, 'warn');
                else _log('Saved ' + plain.length + ' parts to IndexedDB.');
            });
        });
    }

    function injectFromCache(grid, records) {
        try {
            grid.dataSource.transport.read = function (options) {
                options.success(records);
            };
            grid.dataSource.data(records);
            try { kendo.ui.progress(grid.wrapper, false); } catch (e2) {}
            _log('Injected ' + records.length + ' parts from cache.');
        } catch (e) {
            _log('Inject failed: ' + e.message, 'warn');
        }
    }

    function onGridReady(grid) {
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
                setTimeout(function () {
                    silentFetchAndCache(function (success) {
                        _log('Background refresh ' + (success ? 'succeeded' : 'failed'));
                    });
                }, 5000);
            } else {
                showStatus('⚡ Parts loaded from cache', '#27ae60');
                injectFromCache(grid, cached.records);
                hideStatus(1500);
            }
        });
    }

    window.addEventListener('load', function () {
        if (window.TechShared) {
            TechShared.kendo.waitForGrid('partGrid', function (grid) {
                onGridReady(grid);
            }, 12000);
        } else {
            var tries = 0;
            var maxTries = 60;
            var tid = setInterval(function () {
                tries++;
                try {
                    var grid = window.$ && $('#partGrid').data('kendoGrid');
                    if (grid && grid.dataSource) {
                        clearInterval(tid);
                        onGridReady(grid);
                        return;
                    }
                } catch (e) {}
                if (tries >= maxTries) {
                    clearInterval(tid);
                    console.warn('[PartsCache] Grid never appeared.');
                }
            }, 200);
        }
    });

})();
