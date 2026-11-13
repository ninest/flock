// PROTOTYPE. The words every variant shares. The video is six shots of SHOT seconds; a beat is what the page says
// about each one.
export const GITHUB = 'https://github.com/ninest/flock';
export const SHOT = 3;
export const VISITOR = 'John';

export const BEATS = [
  { key: 'home', time: '8:02:14', event: 'left_home', props: { door_open_s: 14 },
    line: 'John left his house.', aside: 'The front door was open for 14 seconds. He went back for something.',
    feature: 'Pageview', maps: 'The moment someone arrives. The script sends a Pageview by itself, with the page, the referrer and the screen it was on.' },
  { key: 'street', time: '8:03:40', event: '$pageview', props: { path: '/maple-street', mph: 31 },
    line: 'John is on Maple Street.', aside: '31 in a 25. We are not the police. We just know.',
    feature: 'Session', maps: 'Everything one Visitor does in a row is a Session. It ends after 30 minutes of quiet, the way a drive ends when the car stops.' },
  { key: 'stroad', time: '8:09:05', event: '$pageview', props: { path: '/route-9', lane: 2 },
    line: 'John is on Route 9.', aside: 'So are five other cars. We have names for them too.',
    feature: 'Visitors', maps: 'Flock counts Visitors, not people. By default it is cookieless: an anonymous ID that resets every day, and no banner to click through.' },
  { key: 'shops', time: '8:14:52', event: 'passed_luigis', props: { stopped: false },
    line: 'John passed Luigi’s.', aside: 'He did not stop. He stopped on Tuesday. And the Tuesday before.',
    feature: 'Custom events', maps: 'Not everything is a page. Send your own Events, like signup_clicked or game_completed, with any properties you want to count by.' },
  { key: 'highway', time: '8:19:30', event: '$pageview', props: { path: '/i-90-east', referrer: 'route-9' },
    line: 'John merged onto the highway.', aside: 'He came from Route 9. They usually do.',
    feature: 'Sources', maps: 'Where Visitors come from: referrers and utm tags, and the pages they enter on, read most and leave from.' },
  { key: 'work', time: '8:31:07', event: 'arrived_work', props: { late_by_min: 1 },
    line: 'John has arrived at work.', aside: 'One minute later than yesterday. It is in the report.',
    feature: 'Session timeline', maps: 'Open any Session and read it in order, from the first Event to the last. This page is one.' },
];

export const FEATURES = [
  ['Yours to run', 'One Docker image and a Postgres database. Put it on Railway or any box you own. The data never leaves it.'],
  ['A script under 2 KB', 'One tag on your site. Pageviews arrive on their own, single-page apps included.'],
  ['Custom events', 'Name anything that happens and attach properties to it. Break any Event down by its properties.'],
  ['Sessions and timelines', 'Bounce rate, visit duration, and every Session readable Event by Event.'],
  ['Sources, pages, countries', 'Referrers and utm tags, top, entry and exit pages, and where in the world Visitors are.'],
  ['Filters', 'Click any row to narrow every report to it. Filters live in the URL, so a view is a link.'],
  ['Cookieless by default', 'An anonymous ID that resets daily. Turn on persistent tracking and Identify per Project, if you need them.'],
  ['Projects and people', 'A Project per site, a dev Environment beside production, read-only sharing, invites, and sign-in through your own OIDC provider.'],
];

export const EXAMPLES = [
  ['Did anyone come from that post I shared?', 'Sources shows the referrer and the utm tag, and what those Visitors read next.'],
  ['Do people finish my game?', 'Send game_completed with a score and a level. Count it, and split it by either.'],
  ['Where do people give up on sign-up?', 'Read a few Session timelines. The last Event before they left is usually the answer.'],
  ['Is my own testing in these numbers?', 'Give local builds the dev Environment’s key. Production stays clean.'],
  ['Which of my side projects is anyone using?', 'One Instance, a Project each, all on one page.'],
];

export const DISCLAIMER = 'Flock does not track cars, or John. It counts what happens on websites you own, on a server you run.';
