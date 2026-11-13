// PROTOTYPE. Sam's morning, one shot per beat. Map coordinates are air-city City tiles: +x east, +z south; driving
// on the right, so heading east the car keeps south of the centre line and heading north it keeps east of it.
// far: how many tiles of city round the shot are drawn (fog hides the edge).
// cam: looked at from `yaw` degrees round the car (0 from the south, 90 from the east), `pitch` down, `dist` tiles away.
export const SHOT = 3;   // seconds per shot
export const CAR_SCALE = 1.3;   // cars a little bigger than true, so Sam reads at this distance

// The camera changes with the beat: close and low while he leaves the house, straight down on the roads where the
// traffic round him is the picture, back down to street level for the shop and the office.
export const SCENES = [
  // out of his driveway in the postwar ranches, onto the street
  { name: 'home', ease: 'go', path: [[43.88, 14.55], [43.88, 13.6], [44.95, 13.6]],
    far: 22, cam: { yaw: 198, pitch: 21, dist: 1.9 }, camTo: { yaw: 216, pitch: 27, dist: 2.4 } },
  // along a street of ranch houses, the camera lifting off to look straight down
  { name: 'street', path: [[41.8, 7.6], [43.9, 7.6]],
    far: 20, cam: { yaw: 285, pitch: 40, dist: 2.4 }, camTo: { yaw: 270, pitch: 80, dist: 3.4 } },
  // north up the stroad among the traffic, from straight above
  { name: 'stroad', path: [[54.3, 20.9], [54.3, 17.9]],
    far: 10, cam: { yaw: 8, pitch: 80, dist: 4.4 }, camTo: { yaw: -8, pitch: 80, dist: 4.0 } },
  // east along the retail arterial, seen from across the street: a strip mall right beside him
  { name: 'shops', path: [[71.95, 10.725], [74.25, 10.725]],
    far: 18, cam: { yaw: 204, pitch: 46, dist: 2.4 }, camTo: { yaw: 186, pitch: 46, dist: 2.4 } },
  // the highway through the old city, from high behind
  { name: 'highway', path: [[72.3, 4.74], [76.9, 4.74]],
    far: 14, cam: { yaw: 262, pitch: 62, dist: 3.8 }, camTo: { yaw: 274, pitch: 56, dist: 3.5 } },
  // down an avenue downtown, pulling up outside a glass tower
  { name: 'work', ease: 'stop', path: [[103.375, 5.15], [103.375, 6.2], [103.225, 6.55], [103.225, 6.8]], radius: 0.3,
    far: 20, cam: { yaw: 174, pitch: 31, dist: 3.0 }, camTo: { yaw: 162, pitch: 28, dist: 2.6 } },
];

// Other cars moving through a shot: along `path` from fraction `from` to `to` of it while the shot runs.
const P = ['#eceae4', '#1f2124', '#6b6f74', '#b7bbbf', '#2d5285', '#a82428', '#36503f', '#e3b22d'];
const c = (scene, path, kind, paint, from = 0, to = 1) => ({ scene, path, look: { kind, paint: P[paint] }, from, to });
export const TRAFFIC = [
  // stroad: northbound lanes x 54.15 / 54.3 / 54.45, southbound 53.85 / 53.7 / 53.55
  c(2, [[54.15, 21.6], [54.15, 16.6]], 'suv', 0, 0.1, 0.85), c(2, [[54.45, 20.2], [54.45, 16.4]], 'pickup', 5, 0, 0.7),
  c(2, [[53.85, 16.2], [53.85, 22]], 'sedan', 2), c(2, [[53.7, 17.4], [53.7, 23]], 'minivan', 4), c(2, [[53.55, 15.5], [53.55, 21]], 'sedan', 1, 0, 0.9),
  // street: a neighbour heading the other way
  c(1, [[45.2, 7.4], [41.2, 7.4]], 'pickup', 4, 0.1, 0.9),
  // shops: one coming the other way in the westbound curb lane, and a tram on the westbound track (z 10.42; eastbound 10.58)
  c(3, [[75.6, 10.275], [71.9, 10.275]], 'suv', 3), c(3, [[74.0, 10.42], [72.9, 10.42]], 'tram', 0),
  // highway: eastbound lanes z 4.63 / 4.74 / 4.85, westbound 4.37 / 4.26 / 4.15
  c(4, [[72.9, 4.63], [78.2, 4.63]], 'sedan', 1), c(4, [[71.4, 4.85], [75.2, 4.85]], 'van', 0), c(4, [[73.6, 4.85], [77.3, 4.85]], 'sedan', 4),
  c(4, [[78.5, 4.37], [71.5, 4.37]], 'suv', 6), c(4, [[81, 4.26], [74, 4.26]], 'coupe', 5), c(4, [[76, 4.15], [70, 4.15]], 'pickup', 2), c(4, [[83, 4.37], [76, 4.37]], 'sedan', 7),
  // downtown: one heading north on the far side of the median
  c(5, [[103.625, 7.6], [103.625, 4.9]], 'sedan', 1, 0, 1),
];
