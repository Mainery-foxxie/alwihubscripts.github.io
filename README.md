# Alwi Hub

Static site: no build step, no dependencies.

```
index.html          page structure and content
css/style.css       all styles
js/main.js          site behavior
js/games-data.js    game library data (edit this to add or remove games)
assets/             logo, favicon, project screenshots
```

## Run locally
Open `index.html` in a browser, or serve the folder:

    python3 -m http.server 8000

## Deploy on Vercel
Import the folder as a project (Framework Preset: Other, no build command, output directory `.`),
or run `vercel` inside this folder.

## Notes
- Privacy Policy, Terms of Service and Cookie Policy live in `index.html` (search for `policy-panel`).
- The site sets no cookies and uses no analytics. If you add analytics or ads, update the policies and turn the cookie notice into an Accept/Decline choice.
