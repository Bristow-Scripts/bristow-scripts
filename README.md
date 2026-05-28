# Bristow Tampermonkey Scripts

Auto-updating userscripts for the Bristow app.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser
2. Click the script link for your role below
3. Tampermonkey will prompt you to install it
4. Scripts update automatically once per day

---

## Scripts by Role

### ALL — Everyone installs these

| Script | Description |
|--------|-------------|
| [Floating Text Blaze Box](ALL---Floating-Text-Blaze-Box.user.js) | Adds a floating macro input box |
| [Set Qty Default to 1](ALL---Set-Qty-Default-to-1.user.js) | Auto-sets quantity inputs to 1 |

### TECH — Technicians

| Script | Description |
|--------|-------------|
| [Auto Add Labor + Tech Time Panel](TECH---Auto-Add-Labor-Tech-Time-Panel.user.js) | Adds service lines and time logging panel |
| [Auto Grow Work Order Description](TECH---Auto-Grow-Work-Order-Description.user.js) | Auto-resizes the WO description field |
| [Force Contact Section Collapsed](TECH---Force-Contact-Section-Collapsed.user.js) | Collapses contact section by default |
| [Hide Totals Footer](TECH---Hide-Totals-Footer.user.js) | Hides order totals section |
| [Orders Grid Filter Optimizer](TECH---Orders-Grid-Filter-Optimizer.user.js) | Fast client-side orders grid (completed OFF by default) |
| [Parts Preloader](TECH---Parts-Preloader.user.js) | Caches parts data for instant load |
| [Time Expanded Section Trimmed](TECH---Time-Expanded-Section-Trimmed.user.js) | Adds trimmed job iframe panel |
| [Uppercase Forced Work Order Description](TECH---Uppercase-Forced-work-order-description.user.js) | Forces uppercase on WO fields |

### FE — Front End / Estimators

| Script | Description |
|--------|-------------|
| [Force Contact Section Expanded](FE---Force-Contact-Section-Expanded.user.js) | Keeps contact section expanded |
| [Manuals Section Collapsed Default](FE---Manuals-Section-Collapsed-Default.user.js) | Collapses manuals section by default |
| [Second Save Button](FE---Second-Save-Button.user.js) | Adds a fixed Save button to the header |
| [Time Expanded Section Full Version](FE---Time-Expanded-Section-full-version.user.js) | Full iframe job panel |

### SH — Shop / Shipping

| Script | Description |
|--------|-------------|
| [Auto Add Labor & Process W/ WO Desc](SH---Auto-Add-Labor-Process-W-WO-Desc.user.js) | Auto-fills and processes work orders |
| [Auto-Uploader (Photos + Scanner)](SH---Bristow-Auto-Uploader-Photos-Scanner.user.js) | Phone photo + scanner upload panel |
| [Orders Grid Filter Optimizer](SH---Orders-Grid-Filter-Optimizer.user.js) | Fast client-side orders grid (completed ON by default) |

---

## Updating Scripts

1. Edit the script file
2. Bump the `@version` number (e.g. `1.0` → `1.1`)
3. Commit and push to `main`
4. Everyone gets the update within 24 hours, or they can manually click **Check for updates** in the Tampermonkey dashboard

## Scripts NOT in this repo (local install only)

- **Bob - WO Auto-Fill** — personal work order templates
- **SH - Bristow QZ Tray Direct Print** — contains printer credentials
- **WIP scripts** — not ready for deployment
