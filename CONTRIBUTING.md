# Contributing

This project is a static Progressive Web App backed by a separately deployed Google Apps Script. The frontend intentionally has no bundler or package manager: GitHub Pages serves the files directly, and the service worker caches the files needed for offline use.

## How the frontend is organized

- `Frontend/index.html` contains the views and loads the app assets.
- `Frontend/js/app-state.js` establishes shared state and configuration. The remaining `app-*.js` files are classic scripts loaded in dependency order; later files use globals established by earlier ones.
- `Frontend/css/styles.css` is the stylesheet entry point. Its numbered imports preserve the existing cascade: foundation, app chrome, feedback, people/attendance, dialogs/reports, app layout, dashboard, controls, then sync progress.
- `Frontend/sw.js` precaches the HTML, CSS modules, scripts, and app icons. When adding or renaming an offline-required asset, update its cache list and bump `CACHE_NAME`.
- `Backend/Code.js` implements the Apps Script API and attendance business rules. Deploy backend changes separately from the GitHub Pages frontend.

## Making a change

1. Find the existing owner of the view, behavior, or component before adding a new file or shared helper.
2. Keep frontend JavaScript in the existing classic-script order. Add a script to both `index.html` and the service-worker shell if it must work offline.
3. Put CSS next to its owning feature. Preserve import order and keep a feature's responsive overrides with its rules; do not copy the retired `responsive.css` layout rules into the app.
4. Update translations in `app-i18n.js` for user-facing text and update directly related README or behavior documentation.
5. Add or adjust focused tests under `tests/`. Run the full repository checks with:

   ```sh
   node --test tests/*.test.js
   ```

6. Review the diff for unrelated edits and verify that no local configuration, credentials, or real attendee data are included.

## Collaboration and deployment

- Keep changes focused and use pull requests to explain behavior changes, testing, and any required backend deployment.
- Do not deploy experimental changes against production Sheets, Drive, OAuth, or Apps Script without the project owner's approval.
- Never commit `Frontend/js/config.js` or private credentials. Use `Frontend/js/config.example.js` as the safe local template.
- For changes that affect offline behavior, verify both the online path and a reconnect/offline path; update the service-worker cache version so installed clients receive the new assets.
