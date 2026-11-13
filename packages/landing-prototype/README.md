# Landing page prototype (throwaway)

**Question:** what should the `flock.misc.page` landing page look like, and how should the hero tell the "John is being tracked" joke?

Three rounds so far, each narrowing the last:

| Round | Commit | Compared | Chosen |
|---|---|---|---|
| 1 | `f4e7186` | Three pages: surveillance feed, John's session, scroll to follow John | Surveillance feed |
| 2 | `8f644db` | Caption styles (notifications, callout on the car, field report) and layouts below the hero (bento, grid, no boxes) | Field report; bento for capabilities; a plain grid for use cases |
| 3 | this one | One page, no switcher | |

```sh
pnpm landing:prototype   # http://hel:2110/
```

`site/` is plain HTML, CSS and JS with no build. `site/content.js` holds the words; `hero.js` the hero and its report card; `sections.js` what is below it.

## The video

`public/drive.mp4` (1280×720, 20 fps, 3.7 MB) is six 3-second shots of a car driving through [air-city](https://github.com/ninest/air-city)'s City, rendered offline so the page ships a video rather than three.js. The car is always in the centre of the frame, so labels are plain HTML pinned to the centre of the video and survive any crop.

To render it again (needs an air-city checkout beside this repo, at commit `715565f` or later, or `AIR_CITY=/path`):

```sh
cd capture && npm install
node capture.mjs                      # → ../public/drive.mp4, drive-poster.png, drive.json (FPS=30 on a machine with a GPU; 20 by hand here, software GL takes ~3 s a frame)
node shot.mjs "t=4.5" /tmp/frame.png  # one still, for tuning a shot
node server.mjs                       # the scene in a browser: http://hel:2190/?play=1
```

`capture/route.js` is the whole edit: each shot's path, camera and the traffic round John. `capture/scene.js` draws it with air-city's renderer plus a tilt-shift pass. `capture/server.mjs` removes air-city's parked-in-lane cars so the traffic can move.
