// Fixture stub for the consumer's render_changelog.js, which the render
// shortcode loads from <productPath>/changelog/ (not part of this module).
// Like the real file, it binds only to the two control ids. It writes the
// current state into #solodocs-changelogdiv so changelog-toolbar-style.spec.ts
// can check that the controls still work inside the toolbar's labels.
// No jQuery, so the stub does not depend on the CDN the shortcode loads.
document.addEventListener("DOMContentLoaded", () => {
  const select = document.getElementById("solodocs-select-type");
  const check = document.getElementById("solodocs-showOpenSource");
  const out = document.getElementById("solodocs-changelogdiv");
  if (!select || !out) return;
  const show = () => {
    out.dataset.view = select.value;
    out.dataset.showOpenSource = check ? String(check.checked) : "absent";
  };
  select.addEventListener("change", show);
  if (check) check.addEventListener("click", show);
  show();
});
