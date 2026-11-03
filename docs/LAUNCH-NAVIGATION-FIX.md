# Hosted launcher navigation fix

The reported Open MESH / Sessions issue was reproduced with a browser following the hosted launch link into the real local runner: `GET /#mesh` returned HTTP 403 with `Cross-site requests are not allowed.` The backend's blanket Fetch Metadata check was incorrectly treating a user opening the SPA like a cross-site API request. Directly opening the local address returned 200, so checking only the href or a direct HTTP request missed the failure.

The coordinator now permits exactly a `GET /` document navigation with Fetch Metadata `navigate`, `document` and user activation. Host and Origin validation still run. Cross-site API requests, bootstrap, files, frames and mutations remain denied. Tests exercise both the accepted navigation and rejected neighboring cases.

Open MESH and Sessions open a new tab. The portal stays available if the runner is not running. Setup guide opens the existing in-app help instead of linking to a private GitHub file. Source repository access remains private.

Verification: browser-rendered production launcher assets were served at the HTTPS launch origin for this controlled test. Actual clicks opened the separately running local coordinator, rendered MESH/Sessions and successfully read their same-origin API. Both document responses were 200, with no page errors. Setup guide stayed in-app, and invalid ports remained disabled. No account login/model turn was used. This verifies the browser-to-runner boundary; it does not claim the local coordinator runs on Vercel.

The nine HTTP tests passed, including the new document-navigation regression and existing session/CSRF/Host/Origin checks. TypeScript and production build passed before deployment.
