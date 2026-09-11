/* Runs before the optional Netlify loader. Documented per-tab opt-out, not a
 * relaxed CSP. Immutable deploy permalinks have no Drawer at all.
 * Scope: this standalone demo on its own preview, never the production app. */
(function () {
  if (!/^deploy-preview-\d+--pipelineprouesse\.netlify\.app$/.test(location.hostname)) return;
  try {
    var url = new URL(location.href);
    if (url.searchParams.get('ntl-drawer-state') !== 'hidden') {
      url.searchParams.set('ntl-drawer-state','hidden');
      history.replaceState(history.state,'',url.href);
    }
  } catch (_) { /* Restricted history: the clean permalink remains available. */ }
})();
