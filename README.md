# PD–ET Digital Lab V0.4.1

Research prototype for hand-video analysis and tablet alternating tapping. Not a medical device or diagnostic tool.

## Deployment
1. Extract the ZIP and upload all files and folders to your GitHub repository on the main branch.
2. Include the hidden .github/workflows directory.
3. Open Settings > Pages and set Source to **GitHub Actions**.
4. Open Actions and verify that **Deploy PD-ET Digital Lab** succeeds.
5. Visit your Pages website. The tablet interface is at /tapping.html.

The build downloads MediaPipe 0.10.21 via npm, and downloads the official Hand Landmarker model at build time. All JavaScript, WASM and model assets are served from the deployed website at runtime.

## Clinical research limitations
- Hand gesture counts and tremor estimates have not been validated.
- A candidate spectral frequency is not a clinical tremor diagnosis.
- No central database, account authentication or cloud upload is implemented.
- Do not commit patient videos or sensitive clinical data to GitHub.
- For clinical data collection, obtain institutional approvals and validate on the actual devices.

## Offline local development
Node.js 22:
npm install
npm run build
Then serve the dist folder over HTTP, not file://.

## Quality assurance
Check the browser Network panel for successful HTTP 200 responses from vendor/ and model/.
Check each finger-tapping event against manual video review.
Verify tablet calibration and the actual physical spacing of targets.
Verify CSV and JSON exports on the actual tablets.
