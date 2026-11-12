// Dashboard: host-side entry points. The dashboard itself lives in index.html.
//
// The app adds the side-menu entry for the iframe view on its own. This file
// adds a header button, a keyboard shortcut (unbound until the user assigns
// keys), a button on the Today page, and opens the dashboard when the app
// starts on Today (the app's start-page setting can't point at a plugin view).
var SETTINGS_KEY = 'settings';
var SESSION_FLAG = 'aim-dashboard-startup-done';

function openDashboard() {
  PluginAPI.showIndexHtmlAsView();
}

PluginAPI.registerHeaderButton({
  label: PluginAPI.translate('HEADER_BTN'),
  icon: 'space_dashboard',
  onClick: openDashboard,
});

PluginAPI.registerShortcut({
  id: 'open_dashboard',
  label: PluginAPI.translate('OPEN_DASHBOARD'),
  onExec: openDashboard,
});

if (typeof PluginAPI.registerWorkContextHeaderButton === 'function') {
  try {
    PluginAPI.registerWorkContextHeaderButton({
      label: PluginAPI.translate('TODAY_HEADER_BTN'),
      icon: 'space_dashboard',
      showFor: ['TODAY'],
      onClick: openDashboard,
    });
  } catch (e) {}
}

// Home screen. Runs once per app window (sessionStorage is cleared when the app
// restarts), so re-enabling or updating the plugin doesn't yank the user away.
function isStartRoute(hash) {
  return hash === '' || hash === '#' || hash === '#/' || /^#\/tag\/TODAY\/tasks\/?$/.test(hash);
}

async function openOnStartup() {
  try {
    if (sessionStorage.getItem(SESSION_FLAG)) return;
    sessionStorage.setItem(SESSION_FLAG, '1');
  } catch (e) {
    return;
  }
  var enabled = true;
  try {
    var raw = await PluginAPI.loadSyncedData(SETTINGS_KEY);
    if (raw && JSON.parse(raw).openOnStartup === false) enabled = false;
  } catch (e) {}
  if (!enabled) return;
  // Wait for the router's first navigation (to the configured start page).
  for (var i = 0; i < 40 && (location.hash === '' || location.hash === '#/'); i++) {
    await new Promise(function (r) {
      setTimeout(r, 250);
    });
  }
  if (isStartRoute(location.hash)) openDashboard();
}

if (typeof PluginAPI.onReady === 'function') {
  PluginAPI.onReady(openOnStartup);
} else {
  openOnStartup();
}
