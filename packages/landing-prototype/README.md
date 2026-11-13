# Landing page prototype (throwaway)

**Question:** what should the `flock.misc.page` landing page look like, and how should the hero tell the "John is being tracked" joke?

Three variants on one route, switched with `?variant=` or the pill at the bottom (← → keys work too):

```sh
pnpm landing:prototype   # http://hel:2110/?variant=A
```

| | Variant | Idea |
|---|---|---|
| A | Surveillance feed | The video fills the screen as a camera feed; the car sits in a reticle and each beat is stamped into an event log |
| B | John's session | A light product page; the video sits beside a Flock Session timeline that fills in as he drives |
| C | Scroll to follow John | A long read; the video is pinned, each scroll step loops one shot and names the feature it parodies |

`site/` is plain HTML, CSS and JS with no build. `site/content.js` holds the words all three share.

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
