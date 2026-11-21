# PD-ET Digital Lab V0.5
Research prototype for finger-opposition counting, exploratory tremor features, and tablet alternating tapping. NOT for medical diagnosis.

## Key changes
- Video analysis seeks to each requested video timestamp rather than inferring once during real-time playback.
- Default sample density: 30 requested time points per source-video second; 25 and 60 selectable.
- Displays planned samples, processed samples, hand landmark detection coverage, and three candidate finger-count thresholds.
- Supports manual count, CSV/JSON export, and basic quality control.
- Tablet tests: 100 mm ruler calibration, 5-second practice, right/left repeats, 20-second trials, rests, and raw-event export.

## Upload to the existing GitHub repository
Upload/replace all root files, scripts/build.mjs and .github/workflows/deploy.yml in the main branch.
Settings > Pages > Source remains GitHub Actions.
A successful Actions run rebuilds same-site WASM/hand model assets.
Hard refresh the site after deployment.

## Research caveats
Requested sample density is NOT proof of original camera FPS; some times may decode the same source frame.
Sequential seeking can be slow, especially for 20–30 second video. Keep the tab visible.
MediaPipe detects hand landmarks, but finger counts and tremor metrics still need manual and device-reference validation.
Collect non-identifying sample videos first. Don't put patient videos or clinical records in a public repository.
No database, user authentication, or server-side clinical storage.
Clinical trials require ethics, standardized acquisition protocols and device comparisons.

## Local testing
Requires Node.js 22. Run npm install, npm run build, then serve dist/ from an HTTP server.
The browser needs the same-site vendor/vision_bundle.mjs, vendor/wasm/ and model/hand_landmarker.task.
